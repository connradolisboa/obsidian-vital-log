// ============================================================
// Vital Log — Tracker Modal
// Quick-log UI for mood, energy, and other trackers.
// Shows value buttons for fast selection + optional note.
// ============================================================

import { App, Modal, Notice } from 'obsidian';
import type { VitalLogSettings, TrackerConfig } from './types';
import { resolveDailyNote } from './dailyNoteResolver';
import * as tm from './trackerManager';

// moment is bundled with Obsidian
declare const moment: (date?: Date | string) => { format: (fmt: string) => string };

export class TrackerModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;
  private onSwitchToSupplements?: () => void;

  // State
  private selectedTrackerId = '';
  private selectedValue: number | null = null;
  private timeValue = '';
  private noteValue = '';

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    initialTrackerId?: string,
    onSwitchToSupplements?: () => void
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.timeValue = moment().format('HH:mm');
    this.onSwitchToSupplements = onSwitchToSupplements;
    if (initialTrackerId) {
      this.selectedTrackerId = initialTrackerId;
    } else if (settings.trackers.length > 0) {
      this.selectedTrackerId = settings.trackers[0].id;
    }
  }

  onOpen(): void {
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private get tracker(): TrackerConfig | undefined {
    return this.settings.trackers.find((t) => t.id === this.selectedTrackerId);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vital-log-modal');
    const header = contentEl.createDiv('vital-log-modal-header');
    header.createEl('h2', { text: 'Log Tracker' });
    if (this.onSwitchToSupplements) {
      const switchBtn = header.createEl('button', {
        cls: 'vital-log-switch-btn',
        attr: { 'aria-label': 'Switch to Supplements' },
      });
      switchBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/></svg>';
      switchBtn.addEventListener('click', () => {
        this.close();
        this.onSwitchToSupplements!();
      });
    }

    if (this.settings.trackers.length === 0) {
      contentEl.createDiv({
        cls: 'vital-log-no-data',
        text: 'No trackers configured. Add some in Settings → Vital Log.',
      });
      return;
    }

    // ── Tracker selector (type buttons) ─────────────────────
    const typeSel = contentEl.createDiv('vital-log-type-selector');
    for (const t of this.settings.trackers) {
      const btn = typeSel.createEl('button', {
        text: t.displayName,
        cls: 'vital-log-type-btn' + (this.selectedTrackerId === t.id ? ' is-active' : ''),
      });
      btn.addEventListener('click', () => {
        this.selectedTrackerId = t.id;
        this.selectedValue = null;
        this.render();
      });
    }

    const tracker = this.tracker;
    if (!tracker) return;

    // ── Value selector (grid of buttons) ────────────────────
    const valueSection = contentEl.createDiv('vital-log-modal-section');
    valueSection.createEl('label', {
      text: `${tracker.displayName} (${tracker.min}–${tracker.max})`,
    });

    const valueGrid = valueSection.createDiv('vital-log-tracker-grid');
    const count = tracker.max - tracker.min + 1;
    for (let v = tracker.min; v <= tracker.max; v++) {
      const vBtn = valueGrid.createEl('button', {
        text: String(v),
        cls: 'vital-log-tracker-value-btn' +
          (this.selectedValue === v ? ' is-selected' : ''),
      });
      // Scale button size based on range
      if (count <= 5) {
        vBtn.addClass('vital-log-tracker-value-btn--large');
      } else if (count <= 10) {
        vBtn.addClass('vital-log-tracker-value-btn--medium');
      }
      vBtn.addEventListener('click', () => {
        this.selectedValue = v;
        this.render();
      });
    }

    // ── Time field ───────────────────────────────────────────
    const timeSection = contentEl.createDiv('vital-log-modal-section');
    timeSection.createEl('label', { text: 'Time (HH:mm)' });
    const timeInput = timeSection.createEl('input', { type: 'text', value: this.timeValue });
    timeInput.style.width = '100%';
    timeInput.addEventListener('input', () => {
      this.timeValue = timeInput.value;
    });

    const timeError = timeSection.createDiv({ cls: 'vital-log-error' });
    timeError.style.display = 'none';

    // ── Note field ───────────────────────────────────────────
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

    // ── Action buttons ──────────────────────────────────────
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
      if (this.selectedValue === null) {
        new Notice(`Please select a ${tracker.displayName.toLowerCase()} value.`);
        return;
      }
      timeError.style.display = 'none';
      await this.doLog();
    });
  }

  private async doLog(): Promise<void> {
    const tracker = this.tracker;
    if (!tracker || this.selectedValue === null) return;

    try {
      const file = await resolveDailyNote(this.app, this.settings);
      if (!file) {
        new Notice('Vital Log: Could not resolve daily note.');
        return;
      }

      await tm.logTracker(this.app, file, tracker, {
        time: this.timeValue,
        value: this.selectedValue,
        note: this.noteValue || undefined,
      });

      new Notice(`Logged ${tracker.displayName}: ${this.selectedValue} at ${this.timeValue}`);
      this.selectedValue = null;
      this.noteValue = '';
      this.timeValue = moment().format('HH:mm');
      this.render();
    } catch (err) {
      console.error('Vital Log trackerModal:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        new Notice(`Vital Log: Error logging — ${err.message}`);
      }
    }
  }
}
