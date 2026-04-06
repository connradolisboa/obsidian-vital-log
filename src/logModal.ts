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
declare const moment: (date?: Date | string) => { format: (fmt: string) => string; toDate: () => Date };

type LogType = 'vitamin' | 'pack' | 'stack';

export class LogModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;
  private onSwitchToTracker?: () => void;

  // State
  private logType: LogType;
  private selectedVitaminId = '';
  private selectedPackId = '';
  private selectedStackId = '';
  private dateValue = '';
  private timeValue = '';
  private amountValue = 0;
  private noteValue = '';
  private appendToNote: boolean;
  // Per-log amount overrides (keyed by vitaminId for packs; "v:<vitaminId>" or "p:<packId>:<vitaminId>" for stacks)
  private packItemAmounts: Record<string, number> = {};
  private stackItemAmounts: Record<string, number> = {};
  // Per-log exclusions: vitaminId for pack items; "v:<vitaminId>", "p:<packId>", "p:<packId>:<vitaminId>" for stacks
  private packItemExcluded: Set<string> = new Set();
  private stackItemExcluded: Set<string> = new Set();

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    initialType: LogType = 'vitamin',
    onSwitchToTracker?: () => void
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.logType = initialType;
    this.dateValue = moment().format('YYYY-MM-DD');
    this.timeValue = moment().format('HH:mm');
    this.appendToNote = settings.appendToNoteDefault_supplements === true;
    this.onSwitchToTracker = onSwitchToTracker;
  }

  onOpen(): void {
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
    this.appendToNote = this.settings.appendToNoteDefault_supplements === true;
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vital-log-modal');
    const header = contentEl.createDiv('vital-log-modal-header');
    header.createEl('h2', { text: 'Log Supplement' });
    if (this.onSwitchToTracker) {
      const switchBtn = header.createEl('button', {
        cls: 'vital-log-switch-btn',
        attr: { 'aria-label': 'Switch to Tracker' },
      });
      switchBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
      switchBtn.addEventListener('click', () => {
        this.close();
        this.onSwitchToTracker!();
      });
    }

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

    // ── Date field ─────────────────────────────────────────
    const dateSection = contentEl.createDiv('vital-log-modal-section');
    dateSection.createEl('label', { text: 'Date' });
    const dateInput = dateSection.createEl('input', { type: 'date', value: this.dateValue });
    dateInput.style.width = '100%';
    dateInput.addEventListener('change', () => {
      this.dateValue = dateInput.value;
    });

    // ── Time field ─────────────────────────────────────────
    const timeSection = contentEl.createDiv('vital-log-modal-section');
    timeSection.createEl('label', { text: 'Time' });
    const timeInput = timeSection.createEl('input', { type: 'time', value: this.timeValue });
    timeInput.style.width = '100%';
    timeInput.addEventListener('change', () => {
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

    // ── Append to note toggle ──────────────────────────────
    const appendSection = contentEl.createDiv('vital-log-modal-section vital-log-append-section');
    const appendLabel = appendSection.createEl('label', { cls: 'vital-log-append-label' });
    const appendCheckbox = appendLabel.createEl('input', { type: 'checkbox' });
    appendCheckbox.checked = this.appendToNote;
    appendLabel.createSpan({ text: ' Also add to note content' });
    appendCheckbox.addEventListener('change', () => {
      this.appendToNote = appendCheckbox.checked;
    });

    // ── Log button ─────────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: 'vital-log-inline-form-actions' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => this.close());

    const logBtn = btnRow.createEl('button', { text: 'Log', cls: 'vital-log-btn mod-cta' });
    logBtn.addEventListener('click', async () => {
      if (!this.timeValue || !/^\d{2}:\d{2}$/.test(this.timeValue)) {
        timeError.textContent = 'Please select a valid time.';
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
      this.packItemExcluded = new Set();
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
      this.stackItemExcluded = new Set();
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

      const excluded = this.packItemExcluded.has(item.vitaminId);
      const row = list.createDiv({ cls: 'vital-log-pack-item-row' + (excluded ? ' vital-log-excluded' : '') });
      row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });

      if (!excluded) {
        const amtInput = row.createEl('input', {
          type: 'number',
          value: String(this.packItemAmounts[item.vitaminId] ?? item.amount),
        });
        row.createEl('span', { text: vitamin.unit, cls: 'vital-log-preview-unit' });
        amtInput.addEventListener('input', () => {
          const val = parseFloat(amtInput.value);
          if (!isNaN(val)) this.packItemAmounts[item.vitaminId] = val;
        });
      } else {
        row.createEl('span', { text: '(skipped)', cls: 'vital-log-preview-unit' });
      }

      const rmBtn = row.createEl('button', {
        text: excluded ? 'Restore' : '✕',
        cls: 'vital-log-btn mod-compact' + (excluded ? '' : ' mod-warning'),
      });
      rmBtn.addEventListener('click', () => {
        if (excluded) {
          this.packItemExcluded.delete(item.vitaminId);
        } else {
          this.packItemExcluded.add(item.vitaminId);
          delete this.packItemAmounts[item.vitaminId];
        }
        this.render();
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
        const excluded = this.stackItemExcluded.has(key);
        const list = preview.createDiv({ cls: 'vital-log-pack-items' });
        const row = list.createDiv({ cls: 'vital-log-pack-item-row' + (excluded ? ' vital-log-excluded' : '') });
        row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });

        if (!excluded) {
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
          row.createEl('span', { text: '(skipped)', cls: 'vital-log-preview-unit' });
        }

        const rmBtn = row.createEl('button', {
          text: excluded ? 'Restore' : '✕',
          cls: 'vital-log-btn mod-compact' + (excluded ? '' : ' mod-warning'),
        });
        rmBtn.addEventListener('click', () => {
          if (excluded) {
            this.stackItemExcluded.delete(key);
          } else {
            this.stackItemExcluded.add(key);
            delete this.stackItemAmounts[key];
          }
          this.render();
        });
      } else {
        const pack = this.settings.packs.find((p) => p.id === item.packId);
        if (!pack) continue;

        const packKey = `p:${pack.id}`;
        const packExcluded = this.stackItemExcluded.has(packKey);
        const packBlock = preview.createDiv({ cls: 'vital-log-preview-pack-block' + (packExcluded ? ' vital-log-excluded' : '') });
        const packHeader = packBlock.createDiv({ cls: 'vital-log-preview-pack-name' });
        packHeader.createEl('span', { text: `Pack: ${pack.displayName}` });

        const packRmBtn = packHeader.createEl('button', {
          text: packExcluded ? 'Restore' : '✕',
          cls: 'vital-log-btn mod-compact' + (packExcluded ? '' : ' mod-warning'),
        });
        packRmBtn.addEventListener('click', () => {
          if (packExcluded) {
            this.stackItemExcluded.delete(packKey);
            // also restore any individually excluded items in this pack
            pack.items.forEach((pi) => this.stackItemExcluded.delete(`${packKey}:${pi.vitaminId}`));
          } else {
            this.stackItemExcluded.add(packKey);
          }
          this.render();
        });

        if (!packExcluded) {
          const list = packBlock.createDiv({ cls: 'vital-log-pack-items' });
          for (const packItem of pack.items) {
            const vitamin = this.settings.vitamins.find((v) => v.id === packItem.vitaminId);
            if (!vitamin) continue;

            const key = `${packKey}:${packItem.vitaminId}`;
            const excluded = this.stackItemExcluded.has(key);
            const row = list.createDiv({ cls: 'vital-log-pack-item-row vital-log-pack-item-row--nested' + (excluded ? ' vital-log-excluded' : '') });
            row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });

            if (!excluded) {
              const amtInput = row.createEl('input', {
                type: 'number',
                value: String(this.stackItemAmounts[key] ?? packItem.amount),
              });
              row.createEl('span', { text: vitamin.unit, cls: 'vital-log-preview-unit' });
              amtInput.addEventListener('input', () => {
                const val = parseFloat(amtInput.value);
                if (!isNaN(val)) this.stackItemAmounts[key] = val;
              });
            } else {
              row.createEl('span', { text: '(skipped)', cls: 'vital-log-preview-unit' });
            }

            const rmBtn = row.createEl('button', {
              text: excluded ? 'Restore' : '✕',
              cls: 'vital-log-btn mod-compact' + (excluded ? '' : ' mod-warning'),
            });
            rmBtn.addEventListener('click', () => {
              if (excluded) {
                this.stackItemExcluded.delete(key);
              } else {
                this.stackItemExcluded.add(key);
                delete this.stackItemAmounts[key];
              }
              this.render();
            });
          }
        }
      }
    }
  }

  private resetAfterLog(): void {
    this.selectedVitaminId = '';
    this.selectedPackId = '';
    this.selectedStackId = '';
    this.amountValue = 0;
    this.noteValue = '';
    this.packItemAmounts = {};
    this.stackItemAmounts = {};
    this.packItemExcluded = new Set();
    this.stackItemExcluded = new Set();
    this.dateValue = moment().format('YYYY-MM-DD');
    this.timeValue = moment().format('HH:mm');
    this.render();
  }

  private async doLog(): Promise<void> {
    try {
      const targetDate = this.dateValue ? moment(this.dateValue).toDate() : new Date();
      const file = await resolveDailyNote(this.app, this.settings, targetDate);
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
          appendToNote: this.appendToNote,
        }, this.settings);
        new Notice(`Logged ${vitamin.displayName} at ${this.timeValue}`);
        this.resetAfterLog();
        return;
      } else if (this.logType === 'pack') {
        const pack = this.settings.packs.find((p) => p.id === this.selectedPackId);
        if (!pack) { new Notice('Vital Log: Please select a pack.'); return; }
        const packWithOverrides = {
          ...pack,
          items: pack.items
            .filter((item) => !this.packItemExcluded.has(item.vitaminId))
            .map((item) => ({
              ...item,
              amount: this.packItemAmounts[item.vitaminId] ?? item.amount,
            })),
        };
        await vm.logPack(this.app, file, packWithOverrides, this.settings, { time: this.timeValue, source: 'manual', appendToNote: this.appendToNote });
        new Notice(`Logged pack "${pack.displayName}" at ${this.timeValue}`);
        this.resetAfterLog();
        return;
      } else {
        const stack = this.settings.stacks.find((s) => s.id === this.selectedStackId);
        if (!stack) { new Notice('Vital Log: Please select a stack.'); return; }
        // Build modified stack items with amount overrides and exclusions for standalone vitamins
        const stackWithOverrides = {
          ...stack,
          items: stack.items
            .filter((item) =>
              item.type === 'vitamin'
                ? !this.stackItemExcluded.has(`v:${item.vitaminId}`)
                : !this.stackItemExcluded.has(`p:${item.packId}`)
            )
            .map((item) => {
              if (item.type === 'vitamin') {
                const key = `v:${item.vitaminId}`;
                return key in this.stackItemAmounts
                  ? { ...item, amount: this.stackItemAmounts[key] }
                  : item;
              }
              return item;
            }),
        };
        // Build modified settings with overridden and excluded pack item amounts
        const settingsWithOverrides = {
          ...this.settings,
          packs: this.settings.packs.map((p) => ({
            ...p,
            items: p.items
              .filter((pi) => !this.stackItemExcluded.has(`p:${p.id}:${pi.vitaminId}`))
              .map((pi) => {
                const key = `p:${p.id}:${pi.vitaminId}`;
                return key in this.stackItemAmounts
                  ? { ...pi, amount: this.stackItemAmounts[key] }
                  : pi;
              }),
          })),
        };
        await vm.logStack(this.app, file, stackWithOverrides, settingsWithOverrides, { time: this.timeValue, appendToNote: this.appendToNote });
        new Notice(`Logged stack "${stack.displayName}" at ${this.timeValue}`);
        this.resetAfterLog();
        return;
      }
    } catch (err) {
      console.error('Vital Log logModal:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        new Notice(`Vital Log: Error logging — ${err.message}`);
      }
    }
  }
}
