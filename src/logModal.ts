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
  // Per-log amount overrides (keyed by vitaminId for packs; "v:<vitaminId>" or "p:<packId>:<vitaminId>" for stacks)
  private packItemAmounts: Record<string, number> = {};
  private stackItemAmounts: Record<string, number> = {};

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
      if (this.selectedPackId) this.renderPackPreview(pickerSection);
    } else {
      this.renderStackPicker(pickerSection);
      if (this.selectedStackId) this.renderStackPreview(pickerSection);
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
      this.packItemAmounts = {};
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
      this.stackItemAmounts = {};
      this.render();
    });
  }

  private renderPackPreview(container: HTMLElement): void {
    const pack = this.settings.packs.find((p) => p.id === this.selectedPackId);
    if (!pack || pack.items.length === 0) return;

    const preview = container.createDiv({ cls: 'vital-log-preview' });
    preview.createEl('label', { text: 'Contents (amounts editable)' });
    const list = preview.createDiv({ cls: 'vital-log-pack-items' });

    for (const item of pack.items) {
      const vitamin = this.settings.vitamins.find((v) => v.id === item.vitaminId);
      if (!vitamin) continue;

      const row = list.createDiv({ cls: 'vital-log-pack-item-row' });
      row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });
      const amtInput = row.createEl('input', {
        type: 'number',
        value: String(this.packItemAmounts[item.vitaminId] ?? item.amount),
      });
      row.createEl('span', { text: vitamin.unit, cls: 'vital-log-preview-unit' });

      amtInput.addEventListener('input', () => {
        const val = parseFloat(amtInput.value);
        if (!isNaN(val)) this.packItemAmounts[item.vitaminId] = val;
      });
    }
  }

  private renderStackPreview(container: HTMLElement): void {
    const stack = this.settings.stacks.find((s) => s.id === this.selectedStackId);
    if (!stack || stack.items.length === 0) return;

    const preview = container.createDiv({ cls: 'vital-log-preview' });
    preview.createEl('label', { text: 'Contents (amounts editable)' });

    for (const item of stack.items) {
      if (item.type === 'vitamin') {
        const vitamin = this.settings.vitamins.find((v) => v.id === item.vitaminId);
        if (!vitamin) continue;

        const key = `v:${item.vitaminId}`;
        const list = preview.createDiv({ cls: 'vital-log-pack-items' });
        const row = list.createDiv({ cls: 'vital-log-pack-item-row' });
        row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });
        const amtInput = row.createEl('input', {
          type: 'number',
          value: String(this.stackItemAmounts[key] ?? (item.amount ?? vitamin.defaultAmount)),
        });
        row.createEl('span', { text: vitamin.unit, cls: 'vital-log-preview-unit' });

        amtInput.addEventListener('input', () => {
          const val = parseFloat(amtInput.value);
          if (!isNaN(val)) this.stackItemAmounts[key] = val;
        });
      } else {
        const pack = this.settings.packs.find((p) => p.id === item.packId);
        if (!pack) continue;

        const packBlock = preview.createDiv({ cls: 'vital-log-preview-pack-block' });
        packBlock.createEl('div', { text: `Pack: ${pack.displayName}`, cls: 'vital-log-preview-pack-name' });
        const list = packBlock.createDiv({ cls: 'vital-log-pack-items' });

        for (const packItem of pack.items) {
          const vitamin = this.settings.vitamins.find((v) => v.id === packItem.vitaminId);
          if (!vitamin) continue;

          const key = `p:${pack.id}:${packItem.vitaminId}`;
          const row = list.createDiv({ cls: 'vital-log-pack-item-row vital-log-pack-item-row--nested' });
          row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });
          const amtInput = row.createEl('input', {
            type: 'number',
            value: String(this.stackItemAmounts[key] ?? packItem.amount),
          });
          row.createEl('span', { text: vitamin.unit, cls: 'vital-log-preview-unit' });

          amtInput.addEventListener('input', () => {
            const val = parseFloat(amtInput.value);
            if (!isNaN(val)) this.stackItemAmounts[key] = val;
          });
        }
      }
    }
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
        const packWithOverrides = {
          ...pack,
          items: pack.items.map((item) => ({
            ...item,
            amount: this.packItemAmounts[item.vitaminId] ?? item.amount,
          })),
        };
        await vm.logPack(this.app, file, packWithOverrides, this.settings, { time: this.timeValue, source: 'manual' });
        new Notice(`Logged pack "${pack.displayName}" at ${this.timeValue}`);
      } else {
        const stack = this.settings.stacks.find((s) => s.id === this.selectedStackId);
        if (!stack) { new Notice('Vital Log: Please select a stack.'); return; }
        // Build modified stack items with amount overrides for standalone vitamins
        const stackWithOverrides = {
          ...stack,
          items: stack.items.map((item) => {
            if (item.type === 'vitamin') {
              const key = `v:${item.vitaminId}`;
              return key in this.stackItemAmounts
                ? { ...item, amount: this.stackItemAmounts[key] }
                : item;
            }
            return item;
          }),
        };
        // Build modified settings with overridden pack item amounts
        const settingsWithOverrides = {
          ...this.settings,
          packs: this.settings.packs.map((p) => ({
            ...p,
            items: p.items.map((pi) => {
              const key = `p:${p.id}:${pi.vitaminId}`;
              return key in this.stackItemAmounts
                ? { ...pi, amount: this.stackItemAmounts[key] }
                : pi;
            }),
          })),
        };
        await vm.logStack(this.app, file, stackWithOverrides, settingsWithOverrides, { time: this.timeValue });
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
