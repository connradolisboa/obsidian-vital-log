// ============================================================
// Vital Log — Settings Tab
// ============================================================

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { CustomModalConfig, CustomField, CustomFieldType } from './types';
import { CUSTOM_FIELD_TYPES } from './types';
import { ManageModal } from './manageModal';

function slugify(name: string): string {
  return name
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase()) // camelCase
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

export class VitalLogSettingTab extends PluginSettingTab {
  private plugin: VitalLogPlugin;

  constructor(app: App, plugin: VitalLogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Vital Log Settings' });

    // ── Daily note path ────────────────────────────────────
    new Setting(containerEl)
      .setName('Daily Note Path Template')
      .setDesc(
        'Path template for your daily note. Tokens: {{YYYY}}, {{Q}}, {{YYYY-MM-DD dddd}}'
      )
      .addText((text) =>
        text
          .setPlaceholder('Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}')
          .setValue(this.plugin.settings.dailyNotePath)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotePath = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl('p', {
      text: 'Supported tokens: {{YYYY}} = year, {{YY}} = 2-digit year, {{MM}} = month, {{DD}} = day, {{dddd}} = weekday, {{ddd}} = short weekday, {{Q}} = quarter, {{WW}} = ISO week, {{MMMM}} = month name, {{YYYY-MM-DD dddd}} = full date',
      cls: 'vital-log-settings-helper',
    });

    // ── Log format ─────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Log Format' });

    new Setting(containerEl)
      .setName('Log mode')
      .setDesc(
        'perVitamin: each supplement gets its own frontmatter key. ' +
        'substances: all supplements are written into a single substances[] list with name/amount/unit/time.'
      )
      .addDropdown((dd) =>
        dd
          .addOption('perVitamin', 'Per-vitamin keys')
          .addOption('substances', 'Flat substances list')
          .setValue(this.plugin.settings.logMode ?? 'perVitamin')
          .onChange(async (value) => {
            this.plugin.settings.logMode = value as 'perVitamin' | 'substances';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Include source field')
      .setDesc('Record where each entry came from (manual, pack name, stack name).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logSource !== false)
          .onChange(async (value) => {
            this.plugin.settings.logSource = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Log pack entries')
      .setDesc('Write a packs[] record in the daily note when logging a pack.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logPackEntries !== false)
          .onChange(async (value) => {
            this.plugin.settings.logPackEntries = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Log stack entries')
      .setDesc('Write a stacks[] record in the daily note when logging a stack.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logStackEntries !== false)
          .onChange(async (value) => {
            this.plugin.settings.logStackEntries = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Trackers ──────────────────────────────────────────
    containerEl.createEl('h3', { text: 'Trackers' });

    containerEl.createEl('p', {
      text: 'Configure trackers like Mood and Energy. Each tracker gets its own frontmatter key and value range.',
      cls: 'vital-log-settings-helper',
    });

    const trackerList = containerEl.createDiv('vital-log-item-list');
    for (const tracker of this.plugin.settings.trackers) {
      const row = trackerList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: tracker.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `Key: ${tracker.propertyKey} · Value: ${tracker.valueName} · Range: ${tracker.min}–${tracker.max}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        this.renderTrackerEditForm(containerEl, tracker, trackerList);
      });

      const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', async () => {
        this.plugin.settings.trackers = this.plugin.settings.trackers.filter((t) => t.id !== tracker.id);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText('Add Tracker')
          .setCta()
          .onClick(() => {
            this.renderTrackerAddForm(containerEl, trackerList);
          })
      );

    // ── Custom Modals ──────────────────────────────────────
    containerEl.createEl('h3', { text: 'Custom Modals' });

    containerEl.createEl('p', {
      text: 'Create custom modals that write properties to any periodic note. Each modal has its own path template and configurable fields.',
      cls: 'vital-log-settings-helper',
    });

    const modalList = containerEl.createDiv('vital-log-item-list');
    for (const modal of this.plugin.settings.customModals) {
      const row = modalList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: modal.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${modal.fields.length} field${modal.fields.length !== 1 ? 's' : ''} · ${modal.notePath || '(no path)'}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        this.renderModalEditForm(containerEl, modal, modalList);
      });

      const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', async () => {
        this.plugin.settings.customModals = this.plugin.settings.customModals.filter((m) => m.id !== modal.id);
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      });
    }

    new Setting(containerEl)
      .addButton((btn) =>
        btn
          .setButtonText('Add Custom Modal')
          .setCta()
          .onClick(() => {
            this.renderModalAddForm(containerEl, modalList);
          })
      );

    // ── Manager shortcuts ──────────────────────────────────
    containerEl.createEl('h3', { text: 'Manage Data' });

    new Setting(containerEl)
      .setName('Vitamins')
      .setDesc('Add, edit, or remove vitamins.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Vitamin Manager')
          .setCta()
          .onClick(() => {
            new ManageModal(
              this.app,
              this.plugin.settings,
              () => this.plugin.saveSettings(),
              'vitamins'
            ).open();
          })
      );

    new Setting(containerEl)
      .setName('Packs')
      .setDesc('Add, edit, or remove supplement packs.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Pack Manager')
          .setCta()
          .onClick(() => {
            new ManageModal(
              this.app,
              this.plugin.settings,
              () => this.plugin.saveSettings(),
              'packs'
            ).open();
          })
      );

    new Setting(containerEl)
      .setName('Stacks')
      .setDesc('Add, edit, or remove supplement stacks.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Stack Manager')
          .setCta()
          .onClick(() => {
            new ManageModal(
              this.app,
              this.plugin.settings,
              () => this.plugin.saveSettings(),
              'stacks'
            ).open();
          })
      );
  }

  // ── Tracker forms ─────────────────────────────────────────

  private renderTrackerAddForm(containerEl: HTMLElement, insertBefore: HTMLElement): void {
    const form = containerEl.createDiv('vital-log-inline-form');
    insertBefore.parentElement?.insertBefore(form, insertBefore.nextSibling);
    form.createEl('h4', { text: 'New Tracker' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Mood' });

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', placeholder: 'e.g. moodLog' });

    const valRow = form.createDiv('vital-log-form-row');
    valRow.createEl('label', { text: 'Value Name' });
    const valInput = valRow.createEl('input', { type: 'text', placeholder: 'e.g. mood' });

    const minRow = form.createDiv('vital-log-form-row');
    minRow.createEl('label', { text: 'Min' });
    const minInput = minRow.createEl('input', { type: 'number', value: '1' });

    const maxRow = form.createDiv('vital-log-form-row');
    maxRow.createEl('label', { text: 'Max' });
    const maxInput = maxRow.createEl('input', { type: 'number', value: '5' });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      const val = valInput.value.trim();
      if (!name || !key || !val) return;

      this.plugin.settings.trackers.push({
        id: crypto.randomUUID(),
        displayName: name,
        propertyKey: key,
        valueName: val,
        min: parseInt(minInput.value) || 1,
        max: parseInt(maxInput.value) || 5,
        icon: 'activity',
      });
      await this.plugin.saveSettings();
      this.display();
    });
  }

  private renderTrackerEditForm(
    containerEl: HTMLElement,
    tracker: import('./types').TrackerConfig,
    insertBefore: HTMLElement
  ): void {
    const form = containerEl.createDiv('vital-log-inline-form');
    insertBefore.parentElement?.insertBefore(form, insertBefore.nextSibling);
    form.createEl('h4', { text: `Edit: ${tracker.displayName}` });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', value: tracker.displayName });

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', value: tracker.propertyKey });

    const valRow = form.createDiv('vital-log-form-row');
    valRow.createEl('label', { text: 'Value Name' });
    const valInput = valRow.createEl('input', { type: 'text', value: tracker.valueName });

    const minRow = form.createDiv('vital-log-form-row');
    minRow.createEl('label', { text: 'Min' });
    const minInput = minRow.createEl('input', { type: 'number', value: String(tracker.min) });

    const maxRow = form.createDiv('vital-log-form-row');
    maxRow.createEl('label', { text: 'Max' });
    const maxInput = maxRow.createEl('input', { type: 'number', value: String(tracker.max) });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      const val = valInput.value.trim();
      if (!name || !key || !val) return;

      tracker.displayName = name;
      tracker.propertyKey = key;
      tracker.valueName = val;
      tracker.min = parseInt(minInput.value) || 1;
      tracker.max = parseInt(maxInput.value) || 5;
      await this.plugin.saveSettings();
      this.display();
    });
  }

  // ── Custom Modal forms ────────────────────────────────────

  private renderModalAddForm(containerEl: HTMLElement, insertBefore: HTMLElement): void {
    const modal: CustomModalConfig = {
      id: crypto.randomUUID(),
      displayName: '',
      icon: 'file-text',
      notePath: this.plugin.settings.dailyNotePath,
      useTemplater: false,
      templatePath: '',
      fields: [],
    };
    this.renderModalForm(containerEl, insertBefore, modal, false);
  }

  private renderModalEditForm(containerEl: HTMLElement, modal: CustomModalConfig, insertBefore: HTMLElement): void {
    this.renderModalForm(containerEl, insertBefore, modal, true);
  }

  private renderModalForm(
    containerEl: HTMLElement,
    insertBefore: HTMLElement,
    modal: CustomModalConfig,
    isEdit: boolean
  ): void {
    const form = containerEl.createDiv('vital-log-inline-form vital-log-modal-editor');
    insertBefore.parentElement?.insertBefore(form, insertBefore.nextSibling);
    form.createEl('h4', { text: isEdit ? `Edit: ${modal.displayName}` : 'New Custom Modal' });

    // ── Modal metadata ──
    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Daily Review',
      value: modal.displayName,
    });

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = iconRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. file-text, heart, star',
      value: modal.icon,
    });

    const pathRow = form.createDiv('vital-log-form-row');
    pathRow.createEl('label', { text: 'Note Path Template' });
    const pathInput = pathRow.createEl('input', {
      type: 'text',
      placeholder: 'Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}',
      value: modal.notePath,
    });

    form.createEl('p', {
      text: 'Tokens: {{YYYY}}, {{YY}}, {{MM}}, {{DD}}, {{dddd}}, {{ddd}}, {{Q}}, {{WW}}, {{MMMM}}, {{YYYY-MM-DD}}, {{YYYY-MM-DD dddd}}, {{YYYY-MM}}',
      cls: 'vital-log-settings-helper',
    });

    const templaterRow = form.createDiv('vital-log-form-row');
    templaterRow.createEl('label', { text: 'Use Templater' });
    const templaterCheckbox = templaterRow.createEl('input', { type: 'checkbox' });
    templaterCheckbox.checked = modal.useTemplater;

    const templatePathRow = form.createDiv('vital-log-form-row');
    templatePathRow.createEl('label', { text: 'Template File Path' });
    const templatePathInput = templatePathRow.createEl('input', {
      type: 'text',
      placeholder: 'Templates/Daily.md',
      value: modal.templatePath,
    });
    templatePathRow.style.display = modal.useTemplater ? '' : 'none';

    templaterCheckbox.addEventListener('change', () => {
      templatePathRow.style.display = templaterCheckbox.checked ? '' : 'none';
    });

    // ── Fields section ──
    form.createEl('h4', { text: 'Fields', cls: 'vital-log-fields-header' });

    const fieldListEl = form.createDiv('vital-log-item-list');
    this.renderFieldList(fieldListEl, modal, form);

    // ── Actions ──
    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save Modal', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) return;

      modal.displayName = name;
      modal.icon = iconInput.value.trim() || 'file-text';
      modal.notePath = pathInput.value.trim();
      modal.useTemplater = templaterCheckbox.checked;
      modal.templatePath = templatePathInput.value.trim();

      if (isEdit) {
        // Already mutated in-place
      } else {
        this.plugin.settings.customModals.push(modal);
      }

      await this.plugin.saveSettings();
      this.plugin.registerCustomModalCommands();
      this.display();
    });
  }

  private renderFieldList(
    fieldListEl: HTMLElement,
    modal: CustomModalConfig,
    formContainer: HTMLElement
  ): void {
    fieldListEl.empty();

    for (let i = 0; i < modal.fields.length; i++) {
      const field = modal.fields[i];
      const row = fieldListEl.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: field.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${field.propertyKey} · ${field.fieldType}${this.getFieldMeta(field)}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      // Move up
      if (i > 0) {
        const upBtn = actions.createEl('button', { text: '↑', cls: 'vital-log-btn' });
        upBtn.addEventListener('click', () => {
          [modal.fields[i - 1], modal.fields[i]] = [modal.fields[i], modal.fields[i - 1]];
          this.renderFieldList(fieldListEl, modal, formContainer);
        });
      }

      // Move down
      if (i < modal.fields.length - 1) {
        const downBtn = actions.createEl('button', { text: '↓', cls: 'vital-log-btn' });
        downBtn.addEventListener('click', () => {
          [modal.fields[i], modal.fields[i + 1]] = [modal.fields[i + 1], modal.fields[i]];
          this.renderFieldList(fieldListEl, modal, formContainer);
        });
      }

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        this.renderFieldEditForm(fieldListEl, modal, field, formContainer);
      });

      const delBtn = actions.createEl('button', { text: '×', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', () => {
        modal.fields = modal.fields.filter((f) => f.id !== field.id);
        this.renderFieldList(fieldListEl, modal, formContainer);
      });
    }

    // Add field button
    const addRow = fieldListEl.createDiv('vital-log-field-add-row');
    const addBtn = addRow.createEl('button', { text: '+ Add Field', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      this.renderFieldAddForm(fieldListEl, modal, formContainer);
    });
  }

  private getFieldMeta(field: CustomField): string {
    const parts: string[] = [];
    if (field.fieldType === 'slider' || field.fieldType === 'rating') {
      parts.push(`${field.min ?? 0}–${field.max ?? 10}`);
    }
    if (field.fieldType === 'dropdown' && field.options?.length) {
      parts.push(`${field.options.length} options`);
    }
    return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
  }

  private renderFieldAddForm(
    fieldListEl: HTMLElement,
    modal: CustomModalConfig,
    formContainer: HTMLElement
  ): void {
    const newField: CustomField = {
      id: crypto.randomUUID(),
      propertyKey: '',
      displayName: '',
      description: '',
      fieldType: 'text',
    };
    this.renderFieldForm(fieldListEl, modal, newField, false, formContainer);
  }

  private renderFieldEditForm(
    fieldListEl: HTMLElement,
    modal: CustomModalConfig,
    field: CustomField,
    formContainer: HTMLElement
  ): void {
    this.renderFieldForm(fieldListEl, modal, field, true, formContainer);
  }

  private renderFieldForm(
    fieldListEl: HTMLElement,
    modal: CustomModalConfig,
    field: CustomField,
    isEdit: boolean,
    formContainer: HTMLElement
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? `Edit: ${field.displayName}` : 'New Field' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Day Review',
      value: field.displayName,
    });

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. dayReview',
      value: field.propertyKey,
    });

    // Auto-slugify display name → property key (only on add)
    if (!isEdit) {
      nameInput.addEventListener('input', () => {
        keyInput.value = slugify(nameInput.value);
      });
    }

    const descRow = form.createDiv('vital-log-form-row');
    descRow.createEl('label', { text: 'Description' });
    const descInput = descRow.createEl('input', {
      type: 'text',
      placeholder: 'Helper text shown below the label',
      value: field.description,
    });

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Field Type' });
    const typeSelect = typeRow.createEl('select');
    for (const t of CUSTOM_FIELD_TYPES) {
      const opt = typeSelect.createEl('option', { value: t, text: t });
      if (t === field.fieldType) opt.selected = true;
    }

    // Type-specific options container
    const typeOptionsEl = form.createDiv('vital-log-type-options');
    const renderTypeOptions = (type: CustomFieldType) => {
      typeOptionsEl.empty();

      if (type === 'slider' || type === 'rating' || type === 'number') {
        const minRow = typeOptionsEl.createDiv('vital-log-form-row');
        minRow.createEl('label', { text: 'Min' });
        const minInput = minRow.createEl('input', {
          type: 'number',
          value: String(field.min ?? (type === 'slider' ? 0 : 1)),
        });
        minInput.dataset.field = 'min';

        const maxRow = typeOptionsEl.createDiv('vital-log-form-row');
        maxRow.createEl('label', { text: 'Max' });
        const maxInput = maxRow.createEl('input', {
          type: 'number',
          value: String(field.max ?? (type === 'slider' ? 10 : 5)),
        });
        maxInput.dataset.field = 'max';

        if (type === 'slider') {
          const stepRow = typeOptionsEl.createDiv('vital-log-form-row');
          stepRow.createEl('label', { text: 'Step' });
          const stepInput = stepRow.createEl('input', {
            type: 'number',
            value: String(field.step ?? 1),
          });
          stepInput.dataset.field = 'step';
        }
      }

      if (type === 'dropdown') {
        const optRow = typeOptionsEl.createDiv('vital-log-form-row');
        optRow.createEl('label', { text: 'Options' });
        const optInput = optRow.createEl('input', {
          type: 'text',
          placeholder: 'Comma-separated: sunny, cloudy, rainy',
          value: (field.options ?? []).join(', '),
        });
        optInput.dataset.field = 'options';
      }
    };

    renderTypeOptions(field.fieldType);
    typeSelect.addEventListener('change', () => {
      renderTypeOptions(typeSelect.value as CustomFieldType);
    });

    // Actions
    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save Field', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      if (!name || !key) return;

      field.displayName = name;
      field.propertyKey = key;
      field.description = descInput.value.trim();
      field.fieldType = typeSelect.value as CustomFieldType;

      // Read type-specific options
      const minEl = typeOptionsEl.querySelector('[data-field="min"]') as HTMLInputElement | null;
      const maxEl = typeOptionsEl.querySelector('[data-field="max"]') as HTMLInputElement | null;
      const stepEl = typeOptionsEl.querySelector('[data-field="step"]') as HTMLInputElement | null;
      const optionsEl = typeOptionsEl.querySelector('[data-field="options"]') as HTMLInputElement | null;

      field.min = minEl ? parseFloat(minEl.value) : undefined;
      field.max = maxEl ? parseFloat(maxEl.value) : undefined;
      field.step = stepEl ? parseFloat(stepEl.value) : undefined;
      field.options = optionsEl
        ? optionsEl.value.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

      if (!isEdit) {
        modal.fields.push(field);
      }

      form.remove();
      this.renderFieldList(fieldListEl, modal, formContainer);
    });
  }
}
