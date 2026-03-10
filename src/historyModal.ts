// ============================================================
// Vital Log — History Modal
// Dose history viewer with date picker, inline edit, and delete.
// Delegates all file I/O to yamlManager.
// ============================================================

import { App, Modal, Notice } from 'obsidian';
import type {
  VitalLogSettings,
  VitaminEntry,
  PackEntry,
  StackEntry,
} from './types';
import { isVitaminEntry, isPackEntry, isStackEntry, isArray } from './types';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';

// moment is bundled with Obsidian
declare const moment: (date?: Date | string) => { format: (fmt: string) => string };

// Keys that Vital Log writes at the root frontmatter level
const SYSTEM_KEYS = new Set(['packs', 'stacks']);

export class HistoryModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;
  private selectedDate: Date;

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.selectedDate = new Date();
  }

  onOpen(): void {
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Vital Log — History' });

    // ── Date picker ────────────────────────────────────────
    const dateRow = contentEl.createDiv('vital-log-history-date-row');
    dateRow.createEl('label', { text: 'Date:' });
    const dateInput = dateRow.createEl('input', { type: 'date' });
    dateInput.value = moment(this.selectedDate).format('YYYY-MM-DD');
    dateInput.addEventListener('change', async () => {
      if (dateInput.value) {
        this.selectedDate = new Date(dateInput.value + 'T12:00:00');
        await this.render();
      }
    });

    // ── Load data ──────────────────────────────────────────
    const file = getDailyNoteIfExists(this.app, this.settings, this.selectedDate);
    if (!file) {
      contentEl.createDiv({ cls: 'vital-log-no-data', text: 'No data for this date.' });
      return;
    }

    let fm: Record<string, unknown>;
    try {
      fm = await yaml.readAllFrontmatter(this.app, file);
    } catch (err) {
      console.error('Vital Log historyModal:', err);
      contentEl.createDiv({ cls: 'vital-log-no-data', text: 'Could not read frontmatter.' });
      return;
    }

    // ── Vitamins section ───────────────────────────────────
    const vitaminSection = contentEl.createDiv('vital-log-history-section');
    vitaminSection.createDiv({ cls: 'vital-log-history-section-title', text: 'Vitamins' });

    const vitaminKeysInFm = Object.keys(fm).filter((k) => !SYSTEM_KEYS.has(k));
    let anyVitaminShown = false;

    for (const key of vitaminKeysInFm) {
      const rawEntries = fm[key];
      if (!isArray(rawEntries)) continue;

      const vitaminDef = this.settings.vitamins.find((v) => v.propertyKey === key);
      const groupTitle = vitaminDef
        ? `${vitaminDef.displayName} (${key})`
        : `${key} (deleted vitamin)`;
      const unitLabel = vitaminDef ? vitaminDef.unit : '';

      const groupEl = vitaminSection.createDiv();
      groupEl.createDiv({
        cls: 'vital-log-history-group-title',
        text: `${groupTitle}  ${unitLabel}`,
      });

      rawEntries.forEach((raw, idx) => {
        if (isVitaminEntry(raw)) {
          anyVitaminShown = true;
          this.renderVitaminEntryRow(groupEl, raw, idx, key);
        }
      });
    }

    if (!anyVitaminShown) {
      vitaminSection.createDiv({ cls: 'vital-log-no-data', text: 'No vitamin entries.' });
    }

    // ── Packs section ──────────────────────────────────────
    const packsSection = contentEl.createDiv('vital-log-history-section');
    packsSection.createDiv({ cls: 'vital-log-history-section-title', text: 'Packs' });

    const packEntries = fm['packs'];
    if (isArray(packEntries) && packEntries.length > 0) {
      packEntries.forEach((raw, idx) => {
        if (isPackEntry(raw)) {
          this.renderPackEntryRow(packsSection, raw, idx);
        }
      });
    } else {
      packsSection.createDiv({ cls: 'vital-log-no-data', text: 'No pack entries.' });
    }

    // ── Stacks section ─────────────────────────────────────
    const stacksSection = contentEl.createDiv('vital-log-history-section');
    stacksSection.createDiv({ cls: 'vital-log-history-section-title', text: 'Stacks' });

    const stackEntries = fm['stacks'];
    if (isArray(stackEntries) && stackEntries.length > 0) {
      stackEntries.forEach((raw, idx) => {
        if (isStackEntry(raw)) {
          this.renderStackEntryRow(stacksSection, raw, idx);
        }
      });
    } else {
      stacksSection.createDiv({ cls: 'vital-log-no-data', text: 'No stack entries.' });
    }
  }

  // ── Row renderers ────────────────────────────────────────

  private renderVitaminEntryRow(
    container: HTMLElement,
    entry: VitaminEntry,
    idx: number,
    propertyKey: string
  ): void {
    const row = container.createDiv('vital-log-history-entry');

    const info = row.createDiv('vital-log-history-entry-info');
    let infoText = `${entry.time}  —  ${entry.amount} ${entry.unit}`;
    if (entry.source) infoText += `  —  source: ${entry.source}`;
    if (entry.note) infoText += `  — `;
    info.createSpan({ text: infoText });
    if (entry.note) {
      info.createEl('em', { cls: 'vital-log-history-entry-note', text: `"${entry.note}"` });
    }

    const actions = row.createDiv('vital-log-history-entry-actions');
    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
    const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });

    editBtn.addEventListener('click', () => {
      row.remove();
      this.renderVitaminEditForm(container, entry, idx, propertyKey);
    });

    delBtn.addEventListener('click', () => {
      this.renderDeleteConfirm(row, async () => {
        await this.deleteEntry(propertyKey, idx);
      });
    });
  }

  private renderVitaminEditForm(
    container: HTMLElement,
    entry: VitaminEntry,
    idx: number,
    propertyKey: string
  ): void {
    const form = container.createDiv('vital-log-inline-edit');

    const timeRow = form.createDiv('vital-log-inline-edit-row');
    timeRow.createEl('label', { text: 'Time' });
    const timeInput = timeRow.createEl('input', { type: 'text', value: entry.time });

    const amtRow = form.createDiv('vital-log-inline-edit-row');
    amtRow.createEl('label', { text: 'Amount' });
    const amtInput = amtRow.createEl('input', { type: 'number', value: String(entry.amount) });

    const noteRow = form.createDiv('vital-log-inline-edit-row');
    noteRow.createEl('label', { text: 'Note' });
    const noteInput = noteRow.createEl('input', { type: 'text', value: entry.note ?? '' });

    const actions = form.createDiv('vital-log-inline-edit-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    cancelBtn.addEventListener('click', () => { form.remove(); this.render(); });

    saveBtn.addEventListener('click', async () => {
      const updated: VitaminEntry = {
        time: timeInput.value,
        amount: parseFloat(amtInput.value) || entry.amount,
        unit: entry.unit,
        source: entry.source,
        ...(noteInput.value ? { note: noteInput.value } : {}),
      };
      await this.editEntry(propertyKey, idx, updated);
      form.remove();
      await this.render();
    });
  }

  private renderPackEntryRow(container: HTMLElement, entry: PackEntry, idx: number): void {
    const row = container.createDiv('vital-log-history-entry');
    const info = row.createDiv('vital-log-history-entry-info');
    let infoText = `${entry.time}  —  ${entry.name}`;
    if (entry.source) infoText += `  —  source: ${entry.source}`;
    info.createSpan({ text: infoText });

    const actions = row.createDiv('vital-log-history-entry-actions');
    const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
    delBtn.addEventListener('click', () => {
      this.renderDeleteConfirm(row, async () => { await this.deleteEntry('packs', idx); });
    });
  }

  private renderStackEntryRow(container: HTMLElement, entry: StackEntry, idx: number): void {
    const row = container.createDiv('vital-log-history-entry');
    const info = row.createDiv('vital-log-history-entry-info');
    info.createSpan({ text: `${entry.time}  —  ${entry.name}` });

    const actions = row.createDiv('vital-log-history-entry-actions');
    const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
    delBtn.addEventListener('click', () => {
      this.renderDeleteConfirm(row, async () => { await this.deleteEntry('stacks', idx); });
    });
  }

  private renderDeleteConfirm(row: HTMLElement, onConfirm: () => Promise<void>): void {
    const confirm = row.createDiv('vital-log-confirm-row');
    confirm.createEl('span', { text: 'Remove this entry?' });
    const cancelBtn = confirm.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const removeBtn = confirm.createEl('button', { text: 'Remove', cls: 'vital-log-btn mod-warning' });

    cancelBtn.addEventListener('click', () => confirm.remove());
    removeBtn.addEventListener('click', async () => {
      try {
        await onConfirm();
        await this.render();
      } catch (err) {
        console.error('Vital Log historyModal delete:', err);
        new Notice('Vital Log: Failed to delete entry.');
      }
    });
  }

  // ── Data operations ──────────────────────────────────────

  private async deleteEntry(propertyKey: string, idx: number): Promise<void> {
    const file = getDailyNoteIfExists(this.app, this.settings, this.selectedDate);
    if (!file) return;
    await yaml.removeEntry(this.app, file, propertyKey, idx);
  }

  private async editEntry(propertyKey: string, idx: number, updated: VitaminEntry): Promise<void> {
    const file = getDailyNoteIfExists(this.app, this.settings, this.selectedDate);
    if (!file) return;
    await yaml.editEntry(this.app, file, propertyKey, idx, updated);
  }
}
