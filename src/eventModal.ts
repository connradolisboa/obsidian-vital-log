// ============================================================
// Vital Log — Event Modal
// UI for logging life events (sick, traveling, etc.) with a
// severity rating (1–5) and optional note.
// ============================================================

import { App, Modal, Notice, setIcon } from 'obsidian';
import type { VitalLogSettings } from './types';
import { SEVERITY_LABELS } from './types';
import { resolveDailyNote } from './dailyNoteResolver';
import { logEvent, ensureEventType } from './eventManager';
import { createAppendToggle } from './formUI';

declare const moment: (date?: Date | string) => { format: (fmt: string) => string };

export class EventModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;

  private nameValue = '';
  private selectedSeverity: number | null = null;
  private timeValue = '';
  private noteValue = '';
  private appendToNote: boolean;

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.timeValue = moment().format('HH:mm');
    this.appendToNote = settings.appendToNoteDefault_events === true;
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

    const header = contentEl.createDiv('vital-log-modal-header');
    const titleEl = header.createEl('h2', { text: 'Log Event' });
    const calendarIcon = titleEl.createSpan({ cls: 'vital-log-modal-title-icon' });
    calendarIcon.style.marginRight = '8px';
    setIcon(calendarIcon, 'calendar-clock');
    titleEl.prepend(calendarIcon);

    const activeTypes = this.settings.eventTypes.filter((t) => !t.archived);

    // ── Saved event type quick-select ────────────────────────
    if (activeTypes.length > 0) {
      const typeSel = contentEl.createDiv('vital-log-type-selector');
      for (const et of activeTypes) {
        const btn = typeSel.createEl('button', {
          cls: 'vital-log-type-btn' + (this.nameValue === et.displayName ? ' is-active' : ''),
        });
        if (et.icon) {
          const iconSpan = btn.createSpan({ cls: 'vital-log-type-btn-icon' });
          setIcon(iconSpan, et.icon);
        }
        btn.createSpan({ text: et.displayName });
        btn.addEventListener('click', () => {
          this.nameValue = et.displayName;
          this.render();
        });
      }
    }

    // ── Event name field ─────────────────────────────────────
    const nameSection = contentEl.createDiv('vital-log-modal-section');
    nameSection.createEl('label', { text: 'Event name' });
    const nameInput = nameSection.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Sick, Traveling, Rest day…',
      value: this.nameValue,
    });
    nameInput.style.width = '100%';
    nameInput.addEventListener('input', () => {
      this.nameValue = nameInput.value;
      // Deselect type buttons when typing manually
      const btns = contentEl.querySelectorAll('.vital-log-type-btn');
      btns.forEach((b) => b.removeClass('is-active'));
    });
    if (activeTypes.length === 0) nameInput.focus();

    // ── Severity selector ────────────────────────────────────
    const sevSection = contentEl.createDiv('vital-log-modal-section');
    const sevLabelText = this.selectedSeverity !== null
      ? `Severity — ${this.selectedSeverity} · ${SEVERITY_LABELS[this.selectedSeverity]}`
      : 'Severity';
    sevSection.createEl('label', { text: sevLabelText });
    const sevGrid = sevSection.createDiv('vital-log-tracker-grid');
    for (let s = 1; s <= 5; s++) {
      const btn = sevGrid.createEl('button', {
        cls: 'vital-log-tracker-value-btn vital-log-tracker-value-btn--large vital-log-event-severity-btn' +
          (this.selectedSeverity === s ? ' is-selected' : ''),
        attr: { title: SEVERITY_LABELS[s] },
      });
      btn.createDiv({ text: String(s), cls: 'vital-log-severity-num' });
      btn.createDiv({ text: SEVERITY_LABELS[s], cls: 'vital-log-severity-label' });
      btn.addEventListener('click', () => {
        this.selectedSeverity = s;
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
      placeholder: 'Any details…',
      value: this.noteValue,
    });
    noteInput.style.width = '100%';
    noteInput.addEventListener('input', () => {
      this.noteValue = noteInput.value;
    });

    // ── Append to note toggle ────────────────────────────────
    const appendSection = contentEl.createDiv('vital-log-modal-section vital-log-append-section');
    createAppendToggle(appendSection, {
      label: 'Also add to note content',
      value: this.appendToNote,
      onChange: (value) => { this.appendToNote = value; },
    });

    // ── Action buttons ───────────────────────────────────────
    const btnRow = contentEl.createDiv({ cls: 'vital-log-inline-form-actions' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => this.close());

    const logBtn = btnRow.createEl('button', { text: 'Log', cls: 'vital-log-btn mod-cta' });
    logBtn.addEventListener('click', async () => {
      if (!this.nameValue.trim()) {
        new Notice('Please enter an event name.');
        return;
      }
      if (this.selectedSeverity === null) {
        new Notice('Please select a severity level.');
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(this.timeValue)) {
        timeError.textContent = 'Time must be in HH:mm format (e.g. 08:30)';
        timeError.style.display = 'block';
        return;
      }
      timeError.style.display = 'none';
      await this.doLog();
    });
  }

  private async doLog(): Promise<void> {
    if (!this.nameValue.trim() || this.selectedSeverity === null) return;

    try {
      const file = await resolveDailyNote(this.app, this.settings);
      if (!file) {
        new Notice('Vital Log: Could not resolve daily note.');
        return;
      }

      await logEvent(
        this.app,
        file,
        {
          time: this.timeValue,
          name: this.nameValue.trim(),
          severity: this.selectedSeverity,
          note: this.noteValue || undefined,
        },
        this.settings,
        this.appendToNote
      );

      const added = ensureEventType(this.settings, this.nameValue.trim());
      if (added) await this.saveSettings();

      new Notice(`Logged event: ${this.nameValue.trim()} (severity ${this.selectedSeverity})`);

      // Reset for next entry
      this.nameValue = '';
      this.selectedSeverity = null;
      this.noteValue = '';
      this.timeValue = moment().format('HH:mm');
      this.render();
    } catch (err) {
      console.error('Vital Log eventModal:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        new Notice(`Vital Log: Error logging event — ${err.message}`);
      }
    }
  }
}
