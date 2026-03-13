// ============================================================
// Vital Log — Custom Log Modal
// Dynamic modal that renders user-configured fields and
// writes/updates top-level frontmatter properties on any note.
// ============================================================

import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { VitalLogSettings, CustomModalConfig, CustomField } from './types';
import { resolveNote, getNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';

// moment is bundled with Obsidian
declare const moment: (date?: Date | string) => {
  format: (fmt: string) => string;
  toDate: () => Date;
};

export class CustomLogModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;
  private config: CustomModalConfig;

  // State
  private selectedDate: Date;
  private fieldValues: Map<string, unknown> = new Map();
  private loading = false;

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    config: CustomModalConfig,
    initialDate?: Date
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.config = config;
    this.selectedDate = initialDate ?? new Date();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('vital-log-modal');
    await this.loadAndRender();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── Load frontmatter values then render ───────────────────

  private async loadAndRender(): Promise<void> {
    this.loading = true;
    this.render();

    const file = getNoteIfExists(this.app, this.config.notePath, this.selectedDate);
    if (file) {
      const fm = await yaml.readAllFrontmatter(this.app, file);
      for (const field of this.config.fields) {
        const val = fm[field.propertyKey];
        if (val !== undefined && val !== null) {
          this.fieldValues.set(field.id, val);
        } else {
          this.fieldValues.delete(field.id);
        }
      }
    } else {
      // No note yet — clear pre-fill
      this.fieldValues.clear();
    }

    this.loading = false;
    this.render();
  }

  // ── Render ────────────────────────────────────────────────

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vital-log-modal');

    // Header
    const header = contentEl.createDiv('vital-log-modal-header');
    header.createEl('h2', { text: this.config.displayName });

    if (this.loading) {
      contentEl.createDiv({ cls: 'vital-log-no-data', text: 'Loading...' });
      return;
    }

    // Date picker
    const dateSection = contentEl.createDiv('vital-log-custom-date-row');
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

    // Note status indicator
    const noteExists = getNoteIfExists(this.app, this.config.notePath, this.selectedDate);
    const statusEl = dateSection.createDiv({ cls: 'vital-log-note-status' });
    if (noteExists) {
      statusEl.setText('Note exists');
      statusEl.addClass('vital-log-note-status--exists');
    } else {
      statusEl.setText('New note will be created');
      statusEl.addClass('vital-log-note-status--new');
    }

    if (this.config.fields.length === 0) {
      contentEl.createDiv({
        cls: 'vital-log-no-data',
        text: 'No fields configured for this modal. Add some in Settings → Vital Log.',
      });
      return;
    }

    // Fields
    const fieldsContainer = contentEl.createDiv('vital-log-custom-fields');
    for (const field of this.config.fields) {
      this.renderField(fieldsContainer, field);
    }

    // Action buttons
    const btnRow = contentEl.createDiv({ cls: 'vital-log-inline-form-actions' });
    const cancelBtn = btnRow.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', () => this.doSave());
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

    // Empty option
    const emptyOpt = select.createEl('option', { value: '', text: '— Select —' });

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

    // Render existing tags as chips
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

    // Input for adding new tags
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

  // ── Save ──────────────────────────────────────────────────

  private async doSave(): Promise<void> {
    try {
      // Resolve or create the note
      let file = getNoteIfExists(this.app, this.config.notePath, this.selectedDate);
      const isNewNote = !file;

      if (!file) {
        file = await resolveNote(this.app, this.config.notePath, this.selectedDate);
        if (!file) {
          new Notice('Vital Log: Could not create note.');
          return;
        }

        // Trigger Templater if configured
        if (isNewNote && this.config.useTemplater && this.config.templatePath) {
          await this.triggerTemplater(file);
        }
      }

      // Build properties object
      const properties: Record<string, unknown> = {};
      for (const field of this.config.fields) {
        const val = this.fieldValues.get(field.id);
        if (val !== undefined) {
          properties[field.propertyKey] = val;
        }
      }

      if (Object.keys(properties).length > 0) {
        await yaml.setProperties(this.app, file, properties);
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

  // ── Templater integration ─────────────────────────────────

  private async triggerTemplater(file: TFile): Promise<void> {
    try {
      // Access Templater plugin via Obsidian's plugin registry
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

      // Use Templater's API to apply the template
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
