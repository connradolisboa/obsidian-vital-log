// ============================================================
// Vital Log — Settings Tab
// ============================================================

import { App, Modal, PluginSettingTab, Setting } from 'obsidian';
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

type SettingsTab = 'general' | 'trackers' | 'customModals';

export class VitalLogSettingTab extends PluginSettingTab {
  private plugin: VitalLogPlugin;
  private activeTab: SettingsTab = 'general';

  constructor(app: App, plugin: VitalLogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('vital-log-settings');

    // ── Tab bar ──────────────────────────────────────────────
    const tabBar = containerEl.createDiv('vital-log-settings-tabs');
    const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'general', label: 'General' },
      { id: 'trackers', label: 'Trackers' },
      { id: 'customModals', label: 'Custom Modals' },
    ];

    for (const tab of tabs) {
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: `vital-log-settings-tab${tab.id === this.activeTab ? ' is-active' : ''}`,
      });
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    }

    // ── Tab content ──────────────────────────────────────────
    const content = containerEl.createDiv('vital-log-settings-content');

    switch (this.activeTab) {
      case 'general':
        this.renderGeneralTab(content);
        break;
      case 'trackers':
        this.renderTrackersTab(content);
        break;
      case 'customModals':
        this.renderCustomModalsTab(content);
        break;
    }
  }

  // ── General tab ──────────────────────────────────────────────

  private renderGeneralTab(el: HTMLElement): void {
    // Daily note path
    el.createEl('h3', { text: 'Daily Note Path' });

    new Setting(el)
      .setName('Path template')
      .setDesc('Template path for your daily note.')
      .addText((text) =>
        text
          .setPlaceholder('Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}')
          .setValue(this.plugin.settings.dailyNotePath)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotePath = value;
            await this.plugin.saveSettings();
          })
      );

    const tokenDetails = el.createEl('details', { cls: 'vital-log-token-details' });
    tokenDetails.createEl('summary', { text: 'Supported tokens' });
    const tokenGrid = tokenDetails.createDiv('vital-log-token-grid');
    const tokens = [
      ['{{YYYY}}', 'Full year'],
      ['{{YY}}', '2-digit year'],
      ['{{MM}}', 'Month (01–12)'],
      ['{{DD}}', 'Day (01–31)'],
      ['{{dddd}}', 'Weekday name'],
      ['{{ddd}}', 'Short weekday'],
      ['{{Q}}', 'Quarter (1–4)'],
      ['{{WW}}', 'ISO week'],
      ['{{MMMM}}', 'Month name'],
      ['{{YYYY-MM-DD}}', 'Date'],
      ['{{YYYY-MM-DD dddd}}', 'Date + weekday'],
      ['{{YYYY-MM}}', 'Year-month'],
    ];
    for (const [token, desc] of tokens) {
      const row = tokenGrid.createDiv('vital-log-token-row');
      row.createEl('code', { text: token });
      row.createEl('span', { text: desc });
    }

    // Log format
    el.createEl('h3', { text: 'Log Format' });

    new Setting(el)
      .setName('Log mode')
      .setDesc(
        'Per-vitamin: each supplement gets its own frontmatter key. Substances: single flat list.'
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

    new Setting(el)
      .setName('Include source field')
      .setDesc('Record where each entry came from (manual, pack, stack).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logSource !== false)
          .onChange(async (value) => {
            this.plugin.settings.logSource = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Log pack entries')
      .setDesc('Write a packs[] record when logging a pack.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logPackEntries !== false)
          .onChange(async (value) => {
            this.plugin.settings.logPackEntries = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Log stack entries')
      .setDesc('Write a stacks[] record when logging a stack.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logStackEntries !== false)
          .onChange(async (value) => {
            this.plugin.settings.logStackEntries = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Manage Data ──
    el.createEl('h3', { text: 'Manage Data' });

    new Setting(el)
      .setName('Vitamins')
      .setDesc('Manage your vitamin library.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Manager')
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

    new Setting(el)
      .setName('Packs')
      .setDesc('Manage supplement packs.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Manager')
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

    new Setting(el)
      .setName('Stacks')
      .setDesc('Manage supplement stacks.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Manager')
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

  // ── Trackers tab ─────────────────────────────────────────────

  private renderTrackersTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Configure trackers like Mood and Energy. Each tracker gets its own frontmatter key and value range.',
      cls: 'vital-log-settings-helper',
    });

    const trackerList = el.createDiv('vital-log-item-list');
    for (const tracker of this.plugin.settings.trackers) {
      const row = trackerList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: tracker.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${tracker.propertyKey} · ${tracker.valueName} · ${tracker.min}–${tracker.max}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        this.renderTrackerEditForm(el, tracker, trackerList);
      });

      const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', async () => {
        this.plugin.settings.trackers = this.plugin.settings.trackers.filter((t) => t.id !== tracker.id);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    if (this.plugin.settings.trackers.length === 0) {
      trackerList.createDiv({ cls: 'vital-log-empty-state', text: 'No trackers configured yet.' });
    }

    new Setting(el)
      .addButton((btn) =>
        btn
          .setButtonText('Add Tracker')
          .setCta()
          .onClick(() => {
            this.renderTrackerAddForm(el, trackerList);
          })
      );
  }

  // ── Custom Modals tab ────────────────────────────────────────

  private renderCustomModalsTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Create custom modals that write properties to any periodic note.',
      cls: 'vital-log-settings-helper',
    });

    const modalList = el.createDiv('vital-log-item-list');
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
        new CustomModalEditorModal(this.app, this.plugin, modal, true, () => this.display()).open();
      });

      const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', async () => {
        this.plugin.settings.customModals = this.plugin.settings.customModals.filter((m) => m.id !== modal.id);
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      });
    }

    if (this.plugin.settings.customModals.length === 0) {
      modalList.createDiv({ cls: 'vital-log-empty-state', text: 'No custom modals yet.' });
    }

    new Setting(el)
      .addButton((btn) =>
        btn
          .setButtonText('Add Custom Modal')
          .setCta()
          .onClick(() => {
            const newModal: CustomModalConfig = {
              id: crypto.randomUUID(),
              displayName: '',
              icon: 'file-text',
              notePath: this.plugin.settings.dailyNotePath,
              useTemplater: false,
              templatePath: '',
              fields: [],
            };
            new CustomModalEditorModal(this.app, this.plugin, newModal, false, () => this.display()).open();
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
}

// ================================================================
// Custom Modal Editor — opens as a separate Obsidian Modal
// ================================================================

class CustomModalEditorModal extends Modal {
  private plugin: VitalLogPlugin;
  private modal: CustomModalConfig;
  private isEdit: boolean;
  private onSaved: () => void;

  constructor(
    app: App,
    plugin: VitalLogPlugin,
    modal: CustomModalConfig,
    isEdit: boolean,
    onSaved: () => void
  ) {
    super(app);
    this.plugin = plugin;
    // Work on a deep copy so cancel doesn't mutate
    this.modal = JSON.parse(JSON.stringify(modal));
    this.isEdit = isEdit;
    this.onSaved = onSaved;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('vital-log-modal-editor-modal');
    this.modalEl.addClass('vital-log-modal');

    contentEl.createEl('h2', {
      text: this.isEdit ? `Edit: ${this.modal.displayName}` : 'New Custom Modal',
    });

    // ── Metadata section ──
    const metaSection = contentEl.createDiv('vital-log-editor-section');
    metaSection.createEl('h3', { text: 'Modal Settings' });

    const nameRow = metaSection.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Daily Review',
      value: this.modal.displayName,
    });

    const iconRow = metaSection.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = iconRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. file-text, heart, star',
      value: this.modal.icon,
    });

    const pathRow = metaSection.createDiv('vital-log-form-row');
    pathRow.createEl('label', { text: 'Note Path' });
    const pathInput = pathRow.createEl('input', {
      type: 'text',
      placeholder: 'Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}',
      value: this.modal.notePath,
    });

    const tokenDetails = metaSection.createEl('details', { cls: 'vital-log-token-details' });
    tokenDetails.createEl('summary', { text: 'Supported tokens' });
    const tokenGrid = tokenDetails.createDiv('vital-log-token-grid');
    const tokens = [
      ['{{YYYY}}', 'Full year'],
      ['{{YY}}', '2-digit year'],
      ['{{MM}}', 'Month (01–12)'],
      ['{{DD}}', 'Day (01–31)'],
      ['{{dddd}}', 'Weekday name'],
      ['{{ddd}}', 'Short weekday'],
      ['{{Q}}', 'Quarter (1–4)'],
      ['{{WW}}', 'ISO week'],
      ['{{MMMM}}', 'Month name'],
      ['{{YYYY-MM-DD}}', 'Date'],
      ['{{YYYY-MM-DD dddd}}', 'Date + weekday'],
      ['{{YYYY-MM}}', 'Year-month'],
    ];
    for (const [token, desc] of tokens) {
      const row = tokenGrid.createDiv('vital-log-token-row');
      row.createEl('code', { text: token });
      row.createEl('span', { text: desc });
    }

    const templaterRow = metaSection.createDiv('vital-log-form-row');
    templaterRow.createEl('label', { text: 'Use Templater' });
    const templaterCheckbox = templaterRow.createEl('input', { type: 'checkbox' });
    templaterCheckbox.checked = this.modal.useTemplater;

    const templatePathRow = metaSection.createDiv('vital-log-form-row');
    templatePathRow.createEl('label', { text: 'Template File' });
    const templatePathInput = templatePathRow.createEl('input', {
      type: 'text',
      placeholder: 'Templates/Daily.md',
      value: this.modal.templatePath,
    });
    templatePathRow.style.display = this.modal.useTemplater ? '' : 'none';

    templaterCheckbox.addEventListener('change', () => {
      templatePathRow.style.display = templaterCheckbox.checked ? '' : 'none';
    });

    // ── Fields section ──
    const fieldsSection = contentEl.createDiv('vital-log-editor-section');
    fieldsSection.createEl('h3', { text: 'Fields' });

    const fieldListEl = fieldsSection.createDiv('vital-log-item-list');
    this.renderFieldList(fieldListEl);

    // ── Footer actions ──
    const footer = contentEl.createDiv('vital-log-editor-footer');
    const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = footer.createEl('button', { text: 'Save Modal', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) return;

      this.modal.displayName = name;
      this.modal.icon = iconInput.value.trim() || 'file-text';
      this.modal.notePath = pathInput.value.trim();
      this.modal.useTemplater = templaterCheckbox.checked;
      this.modal.templatePath = templatePathInput.value.trim();

      if (this.isEdit) {
        const idx = this.plugin.settings.customModals.findIndex((m) => m.id === this.modal.id);
        if (idx >= 0) {
          this.plugin.settings.customModals[idx] = this.modal;
        }
      } else {
        this.plugin.settings.customModals.push(this.modal);
      }

      await this.plugin.saveSettings();
      this.plugin.registerCustomModalCommands();
      this.onSaved();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderFieldList(fieldListEl: HTMLElement): void {
    fieldListEl.empty();

    for (let i = 0; i < this.modal.fields.length; i++) {
      const field = this.modal.fields[i];
      const row = fieldListEl.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: field.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${field.propertyKey} · ${field.fieldType}${this.getFieldMeta(field)}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      if (i > 0) {
        const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn' });
        upBtn.addEventListener('click', () => {
          [this.modal.fields[i - 1], this.modal.fields[i]] = [this.modal.fields[i], this.modal.fields[i - 1]];
          this.renderFieldList(fieldListEl);
        });
      }

      if (i < this.modal.fields.length - 1) {
        const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn' });
        downBtn.addEventListener('click', () => {
          [this.modal.fields[i], this.modal.fields[i + 1]] = [this.modal.fields[i + 1], this.modal.fields[i]];
          this.renderFieldList(fieldListEl);
        });
      }

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        this.renderFieldForm(fieldListEl, field, true);
      });

      const delBtn = actions.createEl('button', { text: '\u00d7', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', () => {
        this.modal.fields = this.modal.fields.filter((f) => f.id !== field.id);
        this.renderFieldList(fieldListEl);
      });
    }

    if (this.modal.fields.length === 0) {
      fieldListEl.createDiv({ cls: 'vital-log-empty-state', text: 'No fields yet. Add one below.' });
    }

    const addRow = fieldListEl.createDiv('vital-log-field-add-row');
    const addBtn = addRow.createEl('button', { text: '+ Add Field', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      const newField: CustomField = {
        id: crypto.randomUUID(),
        propertyKey: '',
        displayName: '',
        description: '',
        fieldType: 'text',
      };
      this.renderFieldForm(fieldListEl, newField, false);
    });
  }

  private getFieldMeta(field: CustomField): string {
    const parts: string[] = [];
    if (field.fieldType === 'slider' || field.fieldType === 'rating') {
      parts.push(`${field.min ?? 0}\u2013${field.max ?? 10}`);
    }
    if (field.fieldType === 'dropdown' && field.options?.length) {
      parts.push(`${field.options.length} options`);
    }
    return parts.length > 0 ? ` \u00b7 ${parts.join(' \u00b7 ')}` : '';
  }

  private renderFieldForm(
    fieldListEl: HTMLElement,
    field: CustomField,
    isEdit: boolean
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
        this.modal.fields.push(field);
      } else {
        // Update in place
        const idx = this.modal.fields.findIndex((f) => f.id === field.id);
        if (idx >= 0) {
          this.modal.fields[idx] = field;
        }
      }

      form.remove();
      this.renderFieldList(fieldListEl);
    });
  }
}
