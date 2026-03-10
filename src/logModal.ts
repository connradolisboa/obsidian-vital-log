// ============================================================
// Vital Log — Log Modal
// UI for logging vitamins, packs, and stacks.
// Delegates all file I/O to vitaminManager.
// ============================================================

import { App, Modal, Notice } from 'obsidian';
import type { VitalLogSettings } from './types';
import { resolveDailyNote } from './dailyNoteResolver';
import * as vm from './vitaminManager';

// moment is bundled with Obsidian
declare const moment: (date?: Date | string) => { format: (fmt: string) => string };

type LogType = 'vitamin' | 'pack' | 'stack';

export class LogModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;

  // State
  private logType: LogType;
  private selectedVitaminId = '';
  private selectedPackId = '';
  private selectedStackId = '';
  private timeValue = '';
  private amountValue = 0;
  private noteValue = '';

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    initialType: LogType = 'vitamin'
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.logType = initialType;
    this.timeValue = moment().format('HH:mm');
  }

  onOpen(): void {
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vital-log-modal');
    contentEl.createEl('h2', { text: 'Log Supplement' });

    // ── Type selector ──────────────────────────────────────
    const typeSel = contentEl.createDiv('vital-log-type-selector');
    (['vitamin', 'pack', 'stack'] as LogType[]).forEach((t) => {
      const btn = typeSel.createEl('button', {
        text: t.charAt(0).toUpperCase() + t.slice(1),
        cls: 'vital-log-type-btn' + (this.logType === t ? ' is-active' : ''),
      });
      btn.addEventListener('click', () => {
        this.logType = t;
        this.selectedVitaminId = '';
        this.selectedPackId = '';
        this.selectedStackId = '';
        this.amountValue = 0;
        this.render();
      });
    });

    // ── Item picker ────────────────────────────────────────
    const pickerSection = contentEl.createDiv('vital-log-modal-section');

    if (this.logType === 'vitamin') {
      this.renderVitaminPicker(pickerSection);
    } else if (this.logType === 'pack') {
      this.renderPackPicker(pickerSection);
    } else {
      this.renderStackPicker(pickerSection);
    }

    // ── Time field ─────────────────────────────────────────
    const timeSection = contentEl.createDiv('vital-log-modal-section');
    timeSection.createEl('label', { text: 'Time (HH:mm)' });
    const timeInput = timeSection.createEl('input', { type: 'text', value: this.timeValue });
    timeInput.style.width = '100%';
    timeInput.addEventListener('input', () => {
      this.timeValue = timeInput.value;
    });

    const timeError = timeSection.createDiv({ cls: 'vital-log-error' });
    timeError.style.display = 'none';

    // ── Amount override (vitamin only, after pick) ─────────
    const amountSection = contentEl.createDiv('vital-log-modal-section');
    if (this.logType === 'vitamin' && this.selectedVitaminId) {
      const vit = this.settings.vitamins.find((v) => v.id === this.selectedVitaminId);
      if (vit) {
        if (this.amountValue === 0) this.amountValue = vit.defaultAmount;
        amountSection.createEl('label', { text: `Amount (${vit.unit})` });
        const amtInput = amountSection.createEl('input', {
          type: 'number',
          value: String(this.amountValue),
        });
        amtInput.style.width = '100%';
        amtInput.addEventListener('input', () => {
          this.amountValue = parseFloat(amtInput.value) || 0;
        });
      }
    }

    // ── Note field ─────────────────────────────────────────
    const noteSection = contentEl.createDiv('vital-log-modal-section');
    noteSection.createEl('label', { text: 'Note (optional)' });
    const noteInput = noteSection.createEl('input', {
      type: 'text',
      placeholder: 'Add a note (optional)',
      value: this.noteValue,
    });
    noteInput.style.width = '100%';
    noteInput.addEventListener('input', () => {
      this.noteValue = noteInput.value;
    });

    // ── Log button ─────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: 'vital-log-inline-form-actions' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => this.close());

    const logBtn = btnRow.createEl('button', { text: 'Log', cls: 'vital-log-btn mod-cta' });
    logBtn.addEventListener('click', async () => {
      if (!/^\d{2}:\d{2}$/.test(this.timeValue)) {
        timeError.textContent = 'Time must be in HH:mm format (e.g. 08:30)';
        timeError.style.display = 'block';
        return;
      }
      timeError.style.display = 'none';
      await this.doLog();
    });
  }

  private renderVitaminPicker(container: HTMLElement): void {
    container.createEl('label', { text: 'Select Vitamin' });
    if (this.settings.vitamins.length === 0) {
      container.createEl('p', {
        text: 'No vitamins configured. Add some in Settings → Vital Log.',
        cls: 'vital-log-no-data',
      });
      return;
    }
    const sel = container.createEl('select');
    sel.style.width = '100%';
    sel.createEl('option', { value: '', text: '— choose vitamin —' });
    for (const v of this.settings.vitamins) {
      const opt = sel.createEl('option', { value: v.id, text: v.displayName });
      if (this.selectedVitaminId === v.id) opt.selected = true;
    }
    sel.addEventListener('change', () => {
      this.selectedVitaminId = sel.value;
      this.amountValue = 0;
      this.render();
    });
  }

  private renderPackPicker(container: HTMLElement): void {
    container.createEl('label', { text: 'Select Pack' });
    if (this.settings.packs.length === 0) {
      container.createEl('p', { text: 'No packs configured.', cls: 'vital-log-no-data' });
      return;
    }
    const sel = container.createEl('select');
    sel.style.width = '100%';
    sel.createEl('option', { value: '', text: '— choose pack —' });
    for (const p of this.settings.packs) {
      const opt = sel.createEl('option', { value: p.id, text: p.displayName });
      if (this.selectedPackId === p.id) opt.selected = true;
    }
    sel.addEventListener('change', () => {
      this.selectedPackId = sel.value;
      this.render();
    });
  }

  private renderStackPicker(container: HTMLElement): void {
    container.createEl('label', { text: 'Select Stack' });
    if (this.settings.stacks.length === 0) {
      container.createEl('p', { text: 'No stacks configured.', cls: 'vital-log-no-data' });
      return;
    }
    const sel = container.createEl('select');
    sel.style.width = '100%';
    sel.createEl('option', { value: '', text: '— choose stack —' });
    for (const s of this.settings.stacks) {
      const opt = sel.createEl('option', {
        value: s.id,
        text: `${s.displayName} (${s.schedulingHint})`,
      });
      if (this.selectedStackId === s.id) opt.selected = true;
    }
    sel.addEventListener('change', () => {
      this.selectedStackId = sel.value;
      this.render();
    });
  }

  private async doLog(): Promise<void> {
    try {
      const file = await resolveDailyNote(this.app, this.settings);
      if (!file) {
        new Notice('Vital Log: Could not resolve daily note.');
        return;
      }

      if (this.logType === 'vitamin') {
        const vitamin = this.settings.vitamins.find((v) => v.id === this.selectedVitaminId);
        if (!vitamin) { new Notice('Vital Log: Please select a vitamin.'); return; }
        await vm.logVitamin(this.app, file, vitamin, {
          time: this.timeValue,
          amount: this.amountValue || vitamin.defaultAmount,
          note: this.noteValue || undefined,
          source: 'manual',
        });
        new Notice(`Logged ${vitamin.displayName} at ${this.timeValue}`);
      } else if (this.logType === 'pack') {
        const pack = this.settings.packs.find((p) => p.id === this.selectedPackId);
        if (!pack) { new Notice('Vital Log: Please select a pack.'); return; }
        await vm.logPack(this.app, file, pack, this.settings, { time: this.timeValue, source: 'manual' });
        new Notice(`Logged pack "${pack.displayName}" at ${this.timeValue}`);
      } else {
        const stack = this.settings.stacks.find((s) => s.id === this.selectedStackId);
        if (!stack) { new Notice('Vital Log: Please select a stack.'); return; }
        await vm.logStack(this.app, file, stack, this.settings, { time: this.timeValue });
        new Notice(`Logged stack "${stack.displayName}" at ${this.timeValue}`);
      }

      this.close();
    } catch (err) {
      console.error('Vital Log logModal:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        new Notice(`Vital Log: Error logging — ${err.message}`);
      }
    }
  }
}
