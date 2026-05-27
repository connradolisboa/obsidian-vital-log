// ============================================================
// Vital Log — Custom Log Modal
// Dynamic modal that renders user-configured fields and tally
// counters, writing/updating frontmatter on any note.
// ============================================================

import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type {
  VitalLogSettings,
  CustomModalConfig,
  CustomModalItem,
  CustomField,
  TallyCounterConfig,
  TrackerConfig,
  CustomButtonConfig,
  MirrorConditionalPin,
} from './types';
import { resolveNote, getNoteIfExists, resolvePathTemplate, pathMatchesTemplate } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';
import * as tm from './trackerManager';

// moment is bundled with Obsidian
declare const moment: (date?: Date | string) => {
  format: (fmt: string) => string;
  toDate: () => Date;
};

export class CustomLogModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;
  private config: CustomModalConfig;

  // Custom field state
  private selectedDate: Date;
  private fieldValues: Map<string, unknown> = new Map();
  private loading = false;

  // Tally counter state
  private tallyValues: Map<string, number> = new Map();   // tallyCounterId → current value
  private tallyNotes: Map<string, string> = new Map();    // tallyCounterId → current note
  private appendTallies: boolean = false;
  private tallyNotesSaved = false;

  // Tracker state
  private trackerValues: Map<string, number | null> = new Map(); // trackerId → selected value

  // When opened from an embed, the path of the note containing the embed
  private sourceFilePath?: string;

  // Mirror mode: items visible after frontmatter filtering
  private visibleItems: CustomModalItem[] = [];
  // Mirror mode: note frontmatter keys not covered by the modal, shown in "Other Properties"
  private otherProps: Array<{key: string; value: unknown}> = [];
  private otherPropValues: Map<string, unknown> = new Map();

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    config: CustomModalConfig,
    initialDate?: Date,
    sourceFilePath?: string,
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.config = config;
    this.selectedDate = initialDate ?? new Date();
    this.appendTallies = settings.appendToNoteDefault_tallies ?? false;
    this.sourceFilePath = sourceFilePath;
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('vital-log-modal');
    await this.loadAndRender();
  }

  onClose(): void {
    // Save any unsaved tally notes (fire-and-forget safety net)
    if (!this.tallyNotesSaved) {
      const file = this.getTargetFile();
      if (file) {
        void this.persistTallyNotes(file);
      }
    }
    this.contentEl.empty();
  }

  private get isCurrentNoteMode(): boolean {
    return !this.config.notePath.trim();
  }

  // True when the modal was opened from an embed in a note that matches
  // this modal's notePath template AND the selected date still resolves to
  // that same source file. Acts as a safety net when initialDate extraction
  // succeeded (the date picker stays authoritative if the user changes it).
  private get isSourceMatchingPeriodicNote(): boolean {
    if (!this.sourceFilePath || this.isCurrentNoteMode) return false;
    if (!pathMatchesTemplate(this.sourceFilePath, this.config.notePath)) return false;
    const resolved = resolvePathTemplate(this.config.notePath, this.selectedDate) + '.md';
    return resolved === this.sourceFilePath;
  }

  // Returns the existing target file without creating it.
  // In current-note mode: the embed's source note (if opened from embed), otherwise the active editor file.
  // Otherwise: the path-template–resolved file for the selected date.
  private getTargetFile(): TFile | null {
    if (this.isCurrentNoteMode) {
      if (this.sourceFilePath) {
        const f = this.app.vault.getAbstractFileByPath(this.sourceFilePath);
        return f instanceof TFile ? f : null;
      }
      return this.app.workspace.getActiveFile();
    }
    if (this.isSourceMatchingPeriodicNote) {
      const f = this.app.vault.getAbstractFileByPath(this.sourceFilePath!);
      if (f instanceof TFile) return f;
    }
    return getNoteIfExists(this.app, this.config.notePath, this.selectedDate);
  }

  // Resolves (and creates if needed) the target file for saving.
  private async resolveTargetFile(): Promise<TFile | null> {
    if (this.isCurrentNoteMode) {
      if (this.sourceFilePath) {
        const f = this.app.vault.getAbstractFileByPath(this.sourceFilePath);
        if (!f || !(f instanceof TFile)) new Notice('Vital Log: Source note not found.');
        return f instanceof TFile ? f : null;
      }
      const file = this.app.workspace.getActiveFile();
      if (!file) new Notice('Vital Log: No note is currently open.');
      return file;
    }
    if (this.isSourceMatchingPeriodicNote) {
      const f = this.app.vault.getAbstractFileByPath(this.sourceFilePath!);
      if (f instanceof TFile) return f;
    }
    return resolveNote(this.app, this.config.notePath, this.selectedDate);
  }

  // ── Load frontmatter values then render ───────────────────

  private async loadAndRender(): Promise<void> {
    this.loading = true;
    this.tallyNotesSaved = false;
    this.render();

    const file = this.getTargetFile();
    let fm: Record<string, unknown> = {};

    if (file) {
      fm = await yaml.readAllFrontmatter(this.app, file);

      // Load custom field values
      for (const item of this.config.items) {
        if (item.type !== 'field') continue;
        const field = item.field;
        const val = field.parentKey
          ? (fm[field.parentKey] as Record<string, unknown> | undefined)?.[field.propertyKey]
          : fm[field.propertyKey];
        if (val !== undefined && val !== null) {
          this.fieldValues.set(field.id, val);
        } else {
          this.fieldValues.delete(field.id);
        }
      }

      // Load tally values and notes
      for (const item of this.config.items) {
        if (item.type !== 'tally') continue;
        const config = this.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
        if (!config) continue;
        const entry = await yaml.readTallyEntry(this.app, file, config.propertyKey);
        this.tallyValues.set(item.tallyCounterId, entry.value);
        this.tallyNotes.set(item.tallyCounterId, entry.note ?? '');
      }

      // Load tracker values (last logged entry)
      for (const item of this.config.items) {
        if (item.type !== 'tracker') continue;
        const config = this.settings.trackers?.find((t) => t.id === item.trackerId);
        if (!config) continue;
        const entries = fm[config.propertyKey];
        if (Array.isArray(entries) && entries.length > 0) {
          const last = entries[entries.length - 1] as Record<string, unknown>;
          const val = last[config.valueName];
          this.trackerValues.set(item.trackerId, typeof val === 'number' ? val : null);
        } else {
          this.trackerValues.set(item.trackerId, null);
        }
      }
    } else {
      this.fieldValues.clear();
      // Keep tally state as-is (defaults to 0 / empty note)
      for (const item of this.config.items) {
        if (item.type !== 'tally') continue;
        if (!this.tallyValues.has(item.tallyCounterId)) {
          this.tallyValues.set(item.tallyCounterId, 0);
          this.tallyNotes.set(item.tallyCounterId, '');
        }
      }
    }

    this.visibleItems = this.computeVisibleItems(fm);
    this.otherProps = this.computeOtherProps(fm);
    this.otherPropValues.clear();
    for (const prop of this.otherProps) {
      this.otherPropValues.set(prop.key, prop.value);
    }
    this.loading = false;
    this.render();
  }

  private computeVisibleItems(fm: Record<string, unknown>): CustomModalItem[] {
    if (!this.config.mirrorMode) return this.config.items;

    const pinnedIds = new Set(this.config.mirrorModePinnedIds ?? []);

    // Apply conditional pins based on the current note's tags / folder
    for (const pin of this.config.mirrorModeConditionalPins ?? []) {
      if (this.matchesConditionalPin(pin)) {
        for (const id of pin.pinnedIds) pinnedIds.add(id);
      }
    }

    return this.config.items.filter((item) => {
      if (item.type === 'field') {
        const val = item.field.parentKey
          ? (fm[item.field.parentKey] as Record<string, unknown> | undefined)?.[item.field.propertyKey]
          : fm[item.field.propertyKey];
        return (val !== undefined && val !== null) || pinnedIds.has(item.field.id);
      }
      if (item.type === 'tally') {
        const tallyConfig = this.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
        if (!tallyConfig) return false;
        const val = fm[tallyConfig.propertyKey];
        return (val !== undefined && val !== null) || pinnedIds.has(item.tallyCounterId);
      }
      if (item.type === 'tracker') {
        const trackerConfig = this.settings.trackers?.find((t) => t.id === item.trackerId);
        if (!trackerConfig) return false;
        const val = fm[trackerConfig.propertyKey];
        return (val !== undefined && val !== null) || pinnedIds.has(item.trackerId);
      }
      if (item.type === 'button') return true;
      // Structural items (header, divider, section, section-end) are skipped in mirror mode
      return false;
    });
  }

  private matchesConditionalPin(pin: MirrorConditionalPin): boolean {
    const file = this.getTargetFile();
    if (!file) return false;

    if (pin.conditionType === 'tag') {
      const cache = this.app.metadataCache.getFileCache(file);
      const allTags: string[] = [];
      const fmTags = cache?.frontmatter?.['tags'];
      if (Array.isArray(fmTags)) {
        allTags.push(...fmTags.map((t) => String(t)));
      } else if (typeof fmTags === 'string') {
        allTags.push(fmTags);
      }
      for (const t of cache?.tags ?? []) allTags.push(t.tag);
      const needle = (pin.conditionValue.startsWith('#') ? pin.conditionValue : '#' + pin.conditionValue).toLowerCase();
      return allTags.some((t) => (t.startsWith('#') ? t : '#' + t).toLowerCase() === needle);
    }

    if (pin.conditionType === 'folder') {
      const folder = pin.conditionValue.endsWith('/') ? pin.conditionValue : pin.conditionValue + '/';
      return file.path.startsWith(folder);
    }

    return false;
  }

  private computeOtherProps(fm: Record<string, unknown>): Array<{key: string; value: unknown}> {
    if (!this.config.mirrorMode || !this.config.showOtherProperties) return [];

    const excludedKeys = new Set(this.settings.mirrorExcludedKeys ?? []);

    // Collect all frontmatter keys that the modal already covers
    const coveredKeys = new Set<string>();
    for (const item of this.config.items) {
      if (item.type === 'field') {
        coveredKeys.add(item.field.parentKey ?? item.field.propertyKey);
      } else if (item.type === 'tally') {
        const tc = this.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
        if (tc) coveredKeys.add(tc.propertyKey);
      } else if (item.type === 'tracker') {
        const tc = this.settings.trackers?.find((t) => t.id === item.trackerId);
        if (tc) coveredKeys.add(tc.propertyKey);
      }
    }

    return Object.entries(fm)
      .filter(([key]) => !coveredKeys.has(key) && !excludedKeys.has(key))
      .map(([key, value]) => ({ key, value }));
  }

  // ── Render ────────────────────────────────────────────────

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vital-log-modal');

    // Header
    const header = contentEl.createDiv('vital-log-modal-header');
    header.createEl('h2', { text: this.config.displayName });
    if (this.config.mirrorMode) {
      header.createEl('span', { cls: 'vital-log-mirror-badge', text: 'Mirror' });
    }

    if (this.loading) {
      contentEl.createDiv({ cls: 'vital-log-no-data', text: 'Loading...' });
      return;
    }

    // Date picker (hidden in current-note mode)
    const dateSection = contentEl.createDiv('vital-log-custom-date-row');
    if (this.isCurrentNoteMode) {
      const displayFile = this.getTargetFile();
      const statusEl = dateSection.createDiv({ cls: 'vital-log-note-status' });
      if (displayFile) {
        statusEl.setText(displayFile.basename);
        statusEl.addClass('vital-log-note-status--exists');
      } else {
        statusEl.setText('No note open');
        statusEl.addClass('vital-log-note-status--new');
      }
    } else {
      dateSection.createEl('label', { text: 'Date' });
      const dateInput = dateSection.createEl('input', {
        type: 'date',
        value: moment(this.selectedDate).format('YYYY-MM-DD'),
      });
      dateInput.addEventListener('change', () => {
        const parsed = new Date(dateInput.value + 'T12:00:00');
        if (!isNaN(parsed.getTime())) {
          this.selectedDate = parsed;
          this.loadAndRender();
        }
      });

      const noteExists = getNoteIfExists(this.app, this.config.notePath, this.selectedDate);
      const statusEl = dateSection.createDiv({ cls: 'vital-log-note-status' });
      if (noteExists) {
        statusEl.setText('Note exists');
        statusEl.addClass('vital-log-note-status--exists');
      } else {
        statusEl.setText('New note will be created');
        statusEl.addClass('vital-log-note-status--new');
      }
    }

    if (this.config.items.length === 0) {
      contentEl.createDiv({
        cls: 'vital-log-no-data',
        text: 'No fields configured for this modal. Add some in Settings → Vital Log.',
      });
      return;
    }

    if (this.visibleItems.length === 0 && this.config.mirrorMode && this.otherProps.length === 0) {
      contentEl.createDiv({
        cls: 'vital-log-no-data',
        text: 'No matching properties found in this note. Pin fields in modal settings to always show them.',
      });
      return;
    }

    // Items (fields, tally counters, buttons, headers, dividers, sections)
    const hasTallies = this.visibleItems.some(
      (item) => item.type === 'tally' && this.settings.tallyCounters.some((t) => t.id === item.tallyCounterId)
    );

    const fieldsContainer = contentEl.createDiv('vital-log-custom-fields');
    let currentContainer: HTMLElement = fieldsContainer;

    for (const item of this.visibleItems) {
      if (item.type === 'section') {
        const sectionEl = fieldsContainer.createDiv('vital-log-modal-section-group');
        const sectionHeader = sectionEl.createDiv('vital-log-modal-section-header');
        const chevronEl = sectionHeader.createSpan({ cls: 'vital-log-modal-section-chevron' });
        setIcon(chevronEl, 'chevron-down');
        sectionHeader.createSpan({ cls: 'vital-log-modal-section-title', text: item.title });
        if (item.color) {
          sectionEl.style.setProperty('--vl-section-color', item.color);
          sectionEl.addClass('vital-log-modal-section-group--colored');
        }
        const sectionBody = sectionEl.createDiv('vital-log-modal-section-body');
        if (!item.defaultOpen) {
          sectionEl.addClass('vital-log-modal-section-group--collapsed');
          chevronEl.addClass('is-collapsed');
        }
        sectionHeader.addEventListener('click', () => {
          const isCollapsed = sectionEl.hasClass('vital-log-modal-section-group--collapsed');
          sectionEl.toggleClass('vital-log-modal-section-group--collapsed', !isCollapsed);
          chevronEl.toggleClass('is-collapsed', !isCollapsed);
        });
        currentContainer = sectionBody;
      } else if (item.type === 'header') {
        currentContainer.createEl('p', { cls: 'vital-log-modal-item-header', text: item.text });
      } else if (item.type === 'divider') {
        currentContainer.createEl('hr', { cls: 'vital-log-modal-item-divider' });
      } else if (item.type === 'field') {
        this.renderField(currentContainer, item.field);
      } else if (item.type === 'tally') {
        const config = this.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
        if (config) {
          this.renderTallyCounter(currentContainer, config);
        }
      } else if (item.type === 'tracker') {
        const config = this.settings.trackers?.find((t) => t.id === item.trackerId);
        if (config) {
          this.renderTrackerItem(currentContainer, config);
        }
      } else if (item.type === 'button') {
        this.renderButton(currentContainer, item.button);
      } else if (item.type === 'section-end') {
        currentContainer = fieldsContainer;
      }
    }

    // Other Properties section: note frontmatter keys not covered by the modal
    if (this.otherProps.length > 0) {
      this.renderOtherPropertiesSection(fieldsContainer, this.otherProps);
    }

    // Append-to-note checkbox for tallies
    if (hasTallies) {
      const appendRow = contentEl.createDiv('vital-log-append-row');
      const appendCheckbox = appendRow.createEl('input', { type: 'checkbox' });
      appendCheckbox.checked = this.appendTallies;
      appendCheckbox.id = 'vital-log-append-tallies';
      const appendLabel = appendRow.createEl('label', {
        text: 'Also add tallies to note content',
        cls: 'vital-log-append-label',
      });
      appendLabel.htmlFor = 'vital-log-append-tallies';
      appendCheckbox.addEventListener('change', () => {
        this.appendTallies = appendCheckbox.checked;
      });
    }

    // Action buttons
    const btnRow = contentEl.createDiv({ cls: 'vital-log-inline-form-actions' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', () => this.doSave());
  }

  // ── Other Properties section ─────────────────────────────

  private renderOtherPropertiesSection(
    container: HTMLElement,
    props: Array<{key: string; value: unknown}>
  ): void {
    const sectionEl = container.createDiv('vital-log-modal-section-group');
    sectionEl.addClass('vital-log-modal-section-group--collapsed');
    const sectionHeader = sectionEl.createDiv('vital-log-modal-section-header');
    const chevronEl = sectionHeader.createSpan({ cls: 'vital-log-modal-section-chevron' });
    chevronEl.addClass('is-collapsed');
    setIcon(chevronEl, 'chevron-down');
    sectionHeader.createSpan({ cls: 'vital-log-modal-section-title', text: 'Other Properties' });
    const sectionBody = sectionEl.createDiv('vital-log-modal-section-body');

    sectionHeader.addEventListener('click', () => {
      const collapsed = sectionEl.hasClass('vital-log-modal-section-group--collapsed');
      sectionEl.toggleClass('vital-log-modal-section-group--collapsed', !collapsed);
      chevronEl.toggleClass('is-collapsed', !collapsed);
    });

    for (const prop of props) {
      const row = sectionBody.createDiv('vital-log-custom-field');
      row.createEl('label', { text: prop.key });
      this.renderOtherPropInput(row, prop.key, prop.value);
    }
  }

  private renderOtherPropInput(container: HTMLElement, key: string, value: unknown): void {
    if (value === null || value === undefined) {
      const input = container.createEl('input', { type: 'text', value: '' });
      input.addClass('vital-log-custom-input');
      input.addEventListener('input', () => {
        this.otherPropValues.set(key, input.value || null);
      });
    } else if (typeof value === 'boolean') {
      const row = container.createDiv('vital-log-checkbox-row');
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = value;
      cb.addClass('vital-log-custom-checkbox');
      const lbl = row.createEl('span', { cls: 'vital-log-checkbox-label', text: value ? 'Yes' : 'No' });
      cb.addEventListener('change', () => {
        this.otherPropValues.set(key, cb.checked);
        lbl.setText(cb.checked ? 'Yes' : 'No');
      });
    } else if (typeof value === 'number') {
      const input = container.createEl('input', { type: 'number', value: String(value) });
      input.addClass('vital-log-custom-input');
      input.addEventListener('input', () => {
        this.otherPropValues.set(key, input.value !== '' ? parseFloat(input.value) : undefined);
      });
    } else if (Array.isArray(value)) {
      const strVal = value.map((v) => String(v)).join(', ');
      const input = container.createEl('input', { type: 'text', value: strVal });
      input.addClass('vital-log-custom-input');
      input.readOnly = true;
      input.title = 'Array values are read-only';
    } else if (typeof value === 'object') {
      const input = container.createEl('input', { type: 'text', value: JSON.stringify(value) });
      input.addClass('vital-log-custom-input');
      input.readOnly = true;
      input.title = 'Object values are read-only';
    } else {
      const strVal = value !== null && value !== undefined ? String(value) : '';
      const input = container.createEl('input', { type: 'text', value: strVal });
      input.addClass('vital-log-custom-input');
      input.addEventListener('input', () => {
        this.otherPropValues.set(key, input.value || undefined);
      });
    }
  }

  // ── Render tally counter ──────────────────────────────────

  private renderTallyCounter(container: HTMLElement, config: TallyCounterConfig): void {
    const section = container.createDiv('vital-log-tally-item');

    const labelEl = section.createEl('label', { cls: 'vital-log-tally-label' });
    if (config.icon) {
      const iconSpan = labelEl.createSpan({ cls: 'vital-log-tally-icon' });
      setIcon(iconSpan, config.icon);
    }
    labelEl.createSpan({ text: config.displayName });

    if (config.description) {
      section.createDiv({ cls: 'vital-log-tally-description', text: config.description });
    }

    const controls = section.createDiv('vital-log-tally-controls');

    const decBtn = controls.createEl('button', {
      text: `-${config.step}`,
      cls: 'vital-log-btn vital-log-tally-btn',
    });

    const currentValue = this.tallyValues.get(config.id) ?? 0;
    const valueEl = controls.createDiv({ cls: 'vital-log-tally-value' });
    valueEl.setText(`${currentValue} / ${config.target}`);
    if (currentValue >= config.target) valueEl.addClass('vital-log-tally-at-target');

    const incBtn = controls.createEl('button', {
      text: `+${config.step}`,
      cls: 'vital-log-btn vital-log-tally-btn',
    });

    const updateValueDisplay = (newValue: number) => {
      valueEl.setText(`${newValue} / ${config.target}`);
      if (newValue >= config.target) valueEl.addClass('vital-log-tally-at-target');
      else valueEl.removeClass('vital-log-tally-at-target');
    };

    const handleStep = async (delta: number) => {
      const prev = this.tallyValues.get(config.id) ?? 0;
      const next = prev + delta;
      this.tallyValues.set(config.id, next);
      updateValueDisplay(next);
      // Write value immediately to frontmatter
      try {
        const file = await this.resolveTargetFile();
        if (file) {
          await tally.updateTallyValue(this.app, file, config, next);
        }
      } catch (err) {
        console.error('Vital Log tally increment:', err);
      }
    };

    decBtn.addEventListener('click', () => handleStep(-config.step));
    incBtn.addEventListener('click', () => handleStep(config.step));

    // Note textarea
    const noteTextarea = section.createEl('textarea', {
      placeholder: 'Add a note…',
      cls: 'vital-log-tally-note',
    });
    noteTextarea.value = this.tallyNotes.get(config.id) ?? '';
    noteTextarea.rows = 2;
    noteTextarea.addEventListener('input', () => {
      this.tallyNotes.set(config.id, noteTextarea.value);
    });
  }

  // ── Render tracker ────────────────────────────────────────

  private renderTrackerItem(container: HTMLElement, config: TrackerConfig): void {
    const section = container.createDiv('vital-log-custom-field');

    const labelEl = section.createEl('label', { cls: 'vital-log-tally-label' });
    if (config.icon) {
      const iconSpan = labelEl.createSpan({ cls: 'vital-log-tally-icon' });
      setIcon(iconSpan, config.icon);
    }
    labelEl.createSpan({ text: config.displayName });

    const isMinutes = config.trackerType === 'minutes';
    const currentValue = this.trackerValues.get(config.id) ?? null;

    if (isMinutes) {
      const row = section.createDiv('vital-log-slider-row');
      const input = row.createEl('input', {
        type: 'number',
        attr: { min: '0', step: '1', placeholder: '0' },
      });
      input.style.width = '100%';
      input.addClass('vital-log-custom-input');
      if (currentValue !== null) input.value = String(currentValue);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        this.trackerValues.set(config.id, isNaN(v) ? null : v);
      });
    } else {
      const grid = section.createDiv('vital-log-tracker-grid');
      const count = config.max - config.min + 1;
      for (let v = config.min; v <= config.max; v++) {
        const btn = grid.createEl('button', {
          text: String(v),
          cls: 'vital-log-tracker-value-btn' + (currentValue === v ? ' is-selected' : ''),
        });
        if (count <= 5) btn.addClass('vital-log-tracker-value-btn--large');
        else if (count <= 10) btn.addClass('vital-log-tracker-value-btn--medium');
        btn.addEventListener('click', () => {
          this.trackerValues.set(config.id, v);
          this.render();
        });
      }
    }
  }

  // ── Render individual field by type ───────────────────────

  private renderField(container: HTMLElement, field: CustomField): void {
    const section = container.createDiv('vital-log-custom-field');

    const labelEl = section.createEl('label', { text: field.displayName });
    if (field.description) {
      section.createDiv({ cls: 'vital-log-custom-field-desc', text: field.description });
    }

    const currentValue = this.fieldValues.get(field.id);

    switch (field.fieldType) {
      case 'slider':
        this.renderSlider(section, field, currentValue);
        break;
      case 'text':
        this.renderTextInput(section, field, currentValue);
        break;
      case 'textarea':
        this.renderTextarea(section, field, currentValue);
        break;
      case 'number':
        this.renderNumberInput(section, field, currentValue);
        break;
      case 'date':
        this.renderDatePicker(section, field, currentValue);
        break;
      case 'checkbox':
        this.renderCheckbox(section, field, currentValue);
        break;
      case 'dropdown':
        this.renderDropdown(section, field, currentValue);
        break;
      case 'time':
        this.renderTimePicker(section, field, currentValue);
        break;
      case 'rating':
        this.renderRating(section, field, currentValue);
        break;
      case 'tags':
        this.renderTags(section, field, currentValue);
        break;
    }
  }

  // ── Slider ────────────────────────────────────────────────

  private renderSlider(container: HTMLElement, field: CustomField, value: unknown): void {
    const min = field.min ?? 0;
    const max = field.max ?? 10;
    const step = field.step ?? 1;
    const current = typeof value === 'number' ? value : min;

    const row = container.createDiv('vital-log-slider-row');
    const range = row.createEl('input', {
      type: 'range',
      attr: { min: String(min), max: String(max), step: String(step) },
      value: String(current),
    });
    range.addClass('vital-log-slider-input');

    const display = row.createDiv({ cls: 'vital-log-slider-value', text: String(current) });

    this.fieldValues.set(field.id, current);

    range.addEventListener('input', () => {
      const val = parseFloat(range.value);
      display.setText(String(val));
      this.fieldValues.set(field.id, val);
    });
  }

  // ── Text input ────────────────────────────────────────────

  private renderTextInput(container: HTMLElement, field: CustomField, value: unknown): void {
    const input = container.createEl('input', {
      type: 'text',
      value: typeof value === 'string' ? value : '',
      placeholder: field.description || '',
    });
    input.addClass('vital-log-custom-input');
    input.addEventListener('input', () => {
      this.fieldValues.set(field.id, input.value || undefined);
    });
    if (typeof value === 'string') this.fieldValues.set(field.id, value);
  }

  // ── Textarea ──────────────────────────────────────────────

  private renderTextarea(container: HTMLElement, field: CustomField, value: unknown): void {
    const textarea = container.createEl('textarea', {
      placeholder: field.description || '',
    });
    textarea.addClass('vital-log-custom-textarea');
    textarea.value = typeof value === 'string' ? value : '';
    textarea.rows = 4;
    textarea.addEventListener('input', () => {
      this.fieldValues.set(field.id, textarea.value || undefined);
    });
    if (typeof value === 'string') this.fieldValues.set(field.id, value);
  }

  // ── Number input ──────────────────────────────────────────

  private renderNumberInput(container: HTMLElement, field: CustomField, value: unknown): void {
    const input = container.createEl('input', {
      type: 'number',
      value: typeof value === 'number' ? String(value) : '',
      placeholder: field.description || '',
    });
    input.addClass('vital-log-custom-input');
    if (field.min !== undefined) input.setAttribute('min', String(field.min));
    if (field.max !== undefined) input.setAttribute('max', String(field.max));
    if (field.step !== undefined) input.setAttribute('step', String(field.step));

    input.addEventListener('input', () => {
      const val = input.value ? parseFloat(input.value) : undefined;
      this.fieldValues.set(field.id, val);
    });
    if (typeof value === 'number') this.fieldValues.set(field.id, value);
  }

  // ── Date picker ───────────────────────────────────────────

  private renderDatePicker(container: HTMLElement, field: CustomField, value: unknown): void {
    const input = container.createEl('input', {
      type: 'date',
      value: typeof value === 'string' ? value : '',
    });
    input.addClass('vital-log-custom-input');
    input.addEventListener('change', () => {
      this.fieldValues.set(field.id, input.value || undefined);
    });
    if (typeof value === 'string') this.fieldValues.set(field.id, value);
  }

  // ── Checkbox ──────────────────────────────────────────────

  private renderCheckbox(container: HTMLElement, field: CustomField, value: unknown): void {
    const row = container.createDiv('vital-log-checkbox-row');
    const checkbox = row.createEl('input', { type: 'checkbox' });
    checkbox.checked = value === true;
    checkbox.addClass('vital-log-custom-checkbox');

    const label = row.createEl('span', {
      text: checkbox.checked ? 'Yes' : 'No',
      cls: 'vital-log-checkbox-label',
    });

    this.fieldValues.set(field.id, checkbox.checked);

    checkbox.addEventListener('change', () => {
      this.fieldValues.set(field.id, checkbox.checked);
      label.setText(checkbox.checked ? 'Yes' : 'No');
    });
  }

  // ── Dropdown ──────────────────────────────────────────────

  private renderDropdown(container: HTMLElement, field: CustomField, value: unknown): void {
    const select = container.createEl('select');
    select.addClass('vital-log-custom-input');

    select.createEl('option', { value: '', text: '— Select —' });

    for (const opt of field.options ?? []) {
      const optEl = select.createEl('option', { value: opt, text: opt });
      if (value === opt) optEl.selected = true;
    }

    if (typeof value === 'string') this.fieldValues.set(field.id, value);

    select.addEventListener('change', () => {
      this.fieldValues.set(field.id, select.value || undefined);
    });
  }

  // ── Time picker ───────────────────────────────────────────

  private renderTimePicker(container: HTMLElement, field: CustomField, value: unknown): void {
    const input = container.createEl('input', {
      type: 'time',
      value: typeof value === 'string' ? value : '',
    });
    input.addClass('vital-log-custom-input');
    input.addEventListener('change', () => {
      this.fieldValues.set(field.id, input.value || undefined);
    });
    if (typeof value === 'string') this.fieldValues.set(field.id, value);
  }

  // ── Rating (button grid, like TrackerModal) ───────────────

  private renderRating(container: HTMLElement, field: CustomField, value: unknown): void {
    const min = field.min ?? 1;
    const max = field.max ?? 5;
    const current = typeof value === 'number' ? value : null;

    const grid = container.createDiv('vital-log-tracker-grid');
    const count = max - min + 1;

    for (let v = min; v <= max; v++) {
      const btn = grid.createEl('button', {
        text: String(v),
        cls: 'vital-log-tracker-value-btn' +
          (current === v ? ' is-selected' : ''),
      });
      if (count <= 5) btn.addClass('vital-log-tracker-value-btn--large');
      else if (count <= 10) btn.addClass('vital-log-tracker-value-btn--medium');

      btn.addEventListener('click', () => {
        this.fieldValues.set(field.id, v);
        this.render();
      });
    }
  }

  // ── Tags (multi-select with chips) ────────────────────────

  private renderTags(container: HTMLElement, field: CustomField, value: unknown): void {
    const tags: string[] = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
    this.fieldValues.set(field.id, tags.length > 0 ? [...tags] : undefined);

    const wrapper = container.createDiv('vital-log-tags-wrapper');

    const chipRow = wrapper.createDiv('vital-log-tags-chips');
    for (let i = 0; i < tags.length; i++) {
      const chip = chipRow.createDiv({ cls: 'vital-log-tag-chip' });
      chip.createSpan({ text: tags[i] });
      const removeBtn = chip.createEl('button', { cls: 'vital-log-tag-remove', text: '×' });
      removeBtn.addEventListener('click', () => {
        tags.splice(i, 1);
        this.fieldValues.set(field.id, tags.length > 0 ? [...tags] : undefined);
        this.render();
      });
    }

    const inputRow = wrapper.createDiv('vital-log-tags-input-row');
    const input = inputRow.createEl('input', {
      type: 'text',
      placeholder: 'Type and press Enter to add...',
    });
    input.addClass('vital-log-custom-input');

    const addTag = () => {
      const val = input.value.trim();
      if (val && !tags.includes(val)) {
        tags.push(val);
        this.fieldValues.set(field.id, [...tags]);
        input.value = '';
        this.render();
      }
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
    });

    const addBtn = inputRow.createEl('button', { text: 'Add', cls: 'vital-log-btn' });
    addBtn.addEventListener('click', addTag);
  }

  // ── Button ────────────────────────────────────────────────

  private renderButton(container: HTMLElement, button: CustomButtonConfig): void {
    const section = container.createDiv('vital-log-modal-button-item');
    const btn = section.createEl('button', {
      cls: 'vital-log-btn vital-log-modal-action-btn',
      attr: { 'aria-label': button.displayName },
    });
    if (button.icon) {
      const iconSpan = btn.createSpan({ cls: 'vital-log-modal-action-btn-icon' });
      setIcon(iconSpan, button.icon);
    }
    btn.createSpan({ cls: 'vital-log-modal-action-btn-label', text: button.displayName });
    const arrowSpan = btn.createSpan({ cls: 'vital-log-modal-action-btn-arrow' });
    setIcon(arrowSpan, button.buttonType === 'filelink' ? 'file-symlink' : 'terminal');

    btn.addEventListener('click', () => {
      if (button.buttonType === 'filelink') {
        void this.app.workspace.openLinkText(button.target, '', false);
      } else {
        (this.app as any).commands.executeCommandById(button.target);
      }
    });
  }

  // ── Save ──────────────────────────────────────────────────

  private async doSave(): Promise<void> {
    try {
      let file = this.getTargetFile();
      const isNewNote = !file;

      if (!file) {
        file = await this.resolveTargetFile();
        if (!file) {
          return; // resolveTargetFile already showed a Notice
        }

        if (isNewNote && this.config.useTemplater && this.config.templatePath) {
          await this.triggerTemplater(file);
        }
      }

      // Save custom field values
      const properties: Record<string, unknown> = {};
      for (const item of this.visibleItems) {
        if (item.type !== 'field') continue;
        const val = this.fieldValues.get(item.field.id);
        if (val === undefined) continue;
        if (item.field.parentKey) {
          if (!properties[item.field.parentKey]) properties[item.field.parentKey] = {};
          (properties[item.field.parentKey] as Record<string, unknown>)[item.field.propertyKey] = val;
        } else {
          properties[item.field.propertyKey] = val;
        }
      }
      if (Object.keys(properties).length > 0) {
        await yaml.setProperties(this.app, file, properties);
      }

      // Save other property edits (note frontmatter keys not covered by the modal)
      if (this.otherProps.length > 0) {
        const otherProperties: Record<string, unknown> = {};
        for (const prop of this.otherProps) {
          const val = this.otherPropValues.get(prop.key);
          if (val !== undefined) otherProperties[prop.key] = val;
        }
        if (Object.keys(otherProperties).length > 0) {
          await yaml.setProperties(this.app, file, otherProperties);
        }
      }

      // Save tally notes
      await this.persistTallyNotes(file);
      this.tallyNotesSaved = true;

      // Log tracker values
      for (const item of this.visibleItems) {
        if (item.type !== 'tracker') continue;
        const config = this.settings.trackers?.find((t) => t.id === item.trackerId);
        if (!config) continue;
        const val = this.trackerValues.get(item.trackerId);
        if (val === null || val === undefined) continue;
        await tm.logTracker(this.app, file, config, {
          time: moment().format('HH:mm'),
          value: val,
        }, this.settings);
      }

      // Append tallies to note body (or specific note) if requested
      if (this.appendTallies) {
        const template = this.settings.noteContentTemplate_tallies ?? '- {name}: {value}/{target}';
        const specificTemplate = this.settings.noteContentTemplate_specificNoteTally ?? '- [[{dailyNote}]] {time} : {value}/{target}';
        const dailyNotePath = resolvePathTemplate(this.settings.dailyNotePath, this.selectedDate);
        const dailyNoteBasename = dailyNotePath.split('/').pop() ?? dailyNotePath;
        const timeStr = moment().format('HH:mm');

        for (const item of this.visibleItems) {
          if (item.type !== 'tally') continue;
          const config = this.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
          if (!config) continue;
          const entry = await yaml.readTallyEntry(this.app, file, config.propertyKey);

          if (config.appendToNoteName) {
            // Find or create the target note
            let targetFile: TFile | null = null;
            const byPath = this.app.vault.getAbstractFileByPath(config.appendToNoteName + '.md');
            if (byPath instanceof TFile) {
              targetFile = byPath;
            } else {
              // Fall back to searching by basename
              targetFile = this.app.vault.getFiles().find((f) => f.basename === config.appendToNoteName) ?? null;
            }
            if (!targetFile) {
              targetFile = await this.app.vault.create(config.appendToNoteName + '.md', '---\n---\n');
            }
            if (targetFile) {
              const line = specificTemplate
                .replace('{dailyNote}', dailyNoteBasename)
                .replace('{time}', timeStr)
                .replace('{name}', config.displayName)
                .replace('{value}', String(entry.value))
                .replace('{target}', String(config.target));
              await yaml.appendLineToBody(this.app, targetFile, line);
            }
          } else {
            await tally.appendTallyToNote(this.app, file, config, entry, template);
          }
        }
      }

      new Notice(`${this.config.displayName} saved!`);
      this.close();
    } catch (err) {
      console.error('Vital Log customLogModal:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        new Notice(`Vital Log: Error saving — ${err.message}`);
      }
    }
  }

  private async persistTallyNotes(file: TFile): Promise<void> {
    for (const item of this.visibleItems) {
      if (item.type !== 'tally') continue;
      const config = this.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
      if (!config) continue;
      const note = this.tallyNotes.get(item.tallyCounterId);
      if (note !== undefined) {
        await tally.saveTallyNote(this.app, file, config, note);
      }
    }
  }

  // ── Templater integration ─────────────────────────────────

  private async triggerTemplater(file: TFile): Promise<void> {
    try {
      const templater = (this.app as any).plugins?.plugins?.['templater-obsidian'];
      if (!templater) {
        new Notice('Vital Log: Templater plugin not found. Skipping template.');
        return;
      }

      const templateFile = this.app.vault.getAbstractFileByPath(this.config.templatePath);
      if (!templateFile || !(templateFile instanceof TFile)) {
        new Notice(`Vital Log: Template file not found at "${this.config.templatePath}".`);
        return;
      }

      if (templater.templater?.overwrite_file_commands) {
        await templater.templater.overwrite_file_commands(file);
      } else if (templater.templater?.write_template_to_file) {
        await templater.templater.write_template_to_file(templateFile, file);
      }
    } catch (err) {
      console.error('Vital Log: Templater integration error:', err);
      new Notice('Vital Log: Failed to apply template. Properties will still be saved.');
    }
  }
}
