// ============================================================
// Vital Log — Settings Tab
// ============================================================

import { App, Modal, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { CustomModalConfig, CustomField, CustomFieldType, TallyCounterConfig, CustomModalItem, CustomButtonConfig } from './types';
import { CUSTOM_FIELD_TYPES } from './types';
import { ManageModal } from './manageModal';

function slugify(name: string): string {
  return name
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase()) // camelCase
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

type SettingsTab = 'general' | 'trackers' | 'tallyCounters' | 'customModals';

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
      { id: 'tallyCounters', label: 'Tally Counters' },
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
      case 'tallyCounters':
        this.renderTallyCountersTab(content);
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

    // ── Note Content ──
    el.createEl('h3', { text: 'Note Content' });

    new Setting(el)
      .setName('Append supplements to note content (default on)')
      .setDesc('Default state of the "Also add to note" checkbox when logging vitamins, packs, or stacks.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_supplements === true)
          .onChange(async (value) => {
            this.plugin.settings.appendToNoteDefault_supplements = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Supplement note line template')
      .setDesc('Template for lines added to note content when logging vitamins, packs, or stacks. Available tokens: {time} {name} {amount} {unit} {note}. For stacks, {name} is the list of items. For packs, {amount} and {unit} are empty.')
      .addText((text) =>
        text
          .setPlaceholder('- {time} {name} {amount}{unit}')
          .setValue(this.plugin.settings.noteContentTemplate_supplements ?? '- {time} {name} {amount}{unit}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_supplements = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Append trackers to note content (default on)')
      .setDesc('Default state of the "Also add to note" checkbox when logging trackers.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_trackers === true)
          .onChange(async (value) => {
            this.plugin.settings.appendToNoteDefault_trackers = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Tracker note line template')
      .setDesc('Template for lines added to note content when logging trackers. Available tokens: {time} {name} {value} {note}.')
      .addText((text) =>
        text
          .setPlaceholder('- {time} {name}: {value}')
          .setValue(this.plugin.settings.noteContentTemplate_trackers ?? '- {time} {name}: {value}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_trackers = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Append tally counters to note content (default on)')
      .setDesc('Default state of the "Also add tallies to note" checkbox in custom modals.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_tallies === true)
          .onChange(async (value) => {
            this.plugin.settings.appendToNoteDefault_tallies = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Tally note line template')
      .setDesc('Template for lines added to note content when saving tally counters. Available tokens: {name} {value} {target}.')
      .addText((text) =>
        text
          .setPlaceholder('- {name}: {value}/{target}')
          .setValue(this.plugin.settings.noteContentTemplate_tallies ?? '- {name}: {value}/{target}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_tallies = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Tally → specific note template')
      .setDesc('Template for lines appended to a tally\'s "Append to note" target note. Available tokens: {dailyNote} {time} {name} {value} {target}.')
      .addText((text) =>
        text
          .setPlaceholder('- [[{dailyNote}]] {time} : {value}/{target}')
          .setValue(this.plugin.settings.noteContentTemplate_specificNoteTally ?? '- [[{dailyNote}]] {time} : {value}/{target}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_specificNoteTally = value;
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
    for (let i = 0; i < this.plugin.settings.trackers.length; i++) {
      const tracker = this.plugin.settings.trackers[i];
      const row = trackerList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      const trackerNameEl = info.createDiv({ cls: 'vital-log-item-name' });
      if (tracker.icon) {
        const iconSpan = trackerNameEl.createSpan({ cls: 'vital-log-item-icon' });
        setIcon(iconSpan, tracker.icon);
      }
      trackerNameEl.createSpan({ text: tracker.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${tracker.propertyKey} · ${tracker.valueName} · ${tracker.min}–${tracker.max}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      if (i > 0) {
        const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn' });
        upBtn.addEventListener('click', async () => {
          const trackers = this.plugin.settings.trackers;
          [trackers[i - 1], trackers[i]] = [trackers[i], trackers[i - 1]];
          await this.plugin.saveSettings();
          this.display();
        });
      }
      if (i < this.plugin.settings.trackers.length - 1) {
        const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn' });
        downBtn.addEventListener('click', async () => {
          const trackers = this.plugin.settings.trackers;
          [trackers[i], trackers[i + 1]] = [trackers[i + 1], trackers[i]];
          await this.plugin.saveSettings();
          this.display();
        });
      }

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
    for (let i = 0; i < this.plugin.settings.customModals.length; i++) {
      const modal = this.plugin.settings.customModals[i];
      const row = modalList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: modal.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${modal.items.length} item${modal.items.length !== 1 ? 's' : ''} · ${modal.notePath || '(no path)'}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      if (i > 0) {
        const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn' });
        upBtn.addEventListener('click', async () => {
          const modals = this.plugin.settings.customModals;
          [modals[i - 1], modals[i]] = [modals[i], modals[i - 1]];
          await this.plugin.saveSettings();
          this.display();
        });
      }
      if (i < this.plugin.settings.customModals.length - 1) {
        const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn' });
        downBtn.addEventListener('click', async () => {
          const modals = this.plugin.settings.customModals;
          [modals[i], modals[i + 1]] = [modals[i + 1], modals[i]];
          await this.plugin.saveSettings();
          this.display();
        });
      }

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
              items: [],
            };
            new CustomModalEditorModal(this.app, this.plugin, newModal, false, () => this.display()).open();
          })
      );
  }

  // ── Tally Counters tab ───────────────────────────────────────

  private renderTallyCountersTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Define tally counters for daily counts (e.g. outreach calls). Each counter tracks a single value + note per day.',
      cls: 'vital-log-settings-helper',
    });

    const tallyList = el.createDiv('vital-log-item-list');
    const tallies = this.plugin.settings.tallyCounters ?? [];

    for (let i = 0; i < tallies.length; i++) {
      const t = tallies[i];
      const row = tallyList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      const nameEl = info.createDiv({ cls: 'vital-log-item-name' });
      if (t.icon) {
        const iconSpan = nameEl.createSpan({ cls: 'vital-log-item-icon' });
        setIcon(iconSpan, t.icon);
      }
      nameEl.createSpan({ text: t.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${t.propertyKey} · target ${t.target} · step ${t.step}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      if (i > 0) {
        const upBtn = actions.createEl('button', { text: '↑', cls: 'vital-log-btn' });
        upBtn.addEventListener('click', async () => {
          [tallies[i - 1], tallies[i]] = [tallies[i], tallies[i - 1]];
          await this.plugin.saveSettings();
          this.display();
        });
      }
      if (i < tallies.length - 1) {
        const downBtn = actions.createEl('button', { text: '↓', cls: 'vital-log-btn' });
        downBtn.addEventListener('click', async () => {
          [tallies[i], tallies[i + 1]] = [tallies[i + 1], tallies[i]];
          await this.plugin.saveSettings();
          this.display();
        });
      }

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        this.renderTallyEditForm(el, t, tallyList);
      });

      const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', async () => {
        this.plugin.settings.tallyCounters = tallies.filter((tc) => tc.id !== t.id);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    if (tallies.length === 0) {
      tallyList.createDiv({ cls: 'vital-log-empty-state', text: 'No tally counters configured yet.' });
    }

    new Setting(el)
      .addButton((btn) =>
        btn
          .setButtonText('Add Tally Counter')
          .setCta()
          .onClick(() => {
            this.renderTallyAddForm(el, tallyList);
          })
      );
  }

  private renderTallyAddForm(containerEl: HTMLElement, insertBefore: HTMLElement): void {
    const form = containerEl.createDiv('vital-log-inline-form');
    insertBefore.parentElement?.insertBefore(form, insertBefore.nextSibling);
    form.createEl('h4', { text: 'New Tally Counter' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Outreach' });

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', placeholder: 'e.g. outreachTally' });

    nameInput.addEventListener('input', () => {
      keyInput.value = slugify(nameInput.value) + 'Tally';
    });

    const descRow = form.createDiv('vital-log-form-row');
    descRow.createEl('label', { text: 'Description' });
    const descInput = descRow.createEl('input', { type: 'text', placeholder: 'Helper text shown in modal' });

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = iconRow.createEl('input', { type: 'text', placeholder: 'e.g. check-circle, target, hash' });

    const targetRow = form.createDiv('vital-log-form-row');
    targetRow.createEl('label', { text: 'Target' });
    const targetInput = targetRow.createEl('input', { type: 'number', value: '10' });

    const stepRow = form.createDiv('vital-log-form-row');
    stepRow.createEl('label', { text: 'Step' });
    const stepInput = stepRow.createEl('input', { type: 'number', value: '1' });

    const statusBarRow = form.createDiv('vital-log-form-row');
    statusBarRow.createEl('label', { text: 'Show in status bar' });
    const statusBarCheckbox = statusBarRow.createEl('input', { type: 'checkbox' });

    const appendNoteRow = form.createDiv('vital-log-form-row');
    appendNoteRow.createEl('label', { text: 'Append to note (path)' });
    const appendNoteInput = appendNoteRow.createEl('input', { type: 'text', placeholder: 'e.g. Business Outreaches' });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      if (!name || !key) return;

      const existing = (this.plugin.settings.tallyCounters ?? []);
      if (existing.some((t) => t.propertyKey === key)) {
        keyInput.style.outline = '2px solid var(--text-error)';
        return;
      }

      if (!this.plugin.settings.tallyCounters) this.plugin.settings.tallyCounters = [];
      this.plugin.settings.tallyCounters.push({
        id: crypto.randomUUID(),
        displayName: name,
        description: descInput.value.trim() || undefined,
        propertyKey: key,
        target: parseInt(targetInput.value) || 10,
        step: Math.max(1, parseInt(stepInput.value) || 1),
        icon: iconInput.value.trim() || undefined,
        showInStatusBar: statusBarCheckbox.checked || undefined,
        appendToNoteName: appendNoteInput.value.trim() || undefined,
      });
      await this.plugin.saveSettings();
      this.display();
    });
  }

  private renderTallyEditForm(
    containerEl: HTMLElement,
    t: TallyCounterConfig,
    insertBefore: HTMLElement
  ): void {
    const form = containerEl.createDiv('vital-log-inline-form');
    insertBefore.parentElement?.insertBefore(form, insertBefore.nextSibling);
    form.createEl('h4', { text: `Edit: ${t.displayName}` });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', value: t.displayName });

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', value: t.propertyKey });

    const descRow = form.createDiv('vital-log-form-row');
    descRow.createEl('label', { text: 'Description' });
    const descInput = descRow.createEl('input', { type: 'text', value: t.description ?? '', placeholder: 'Helper text shown in modal' });

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = iconRow.createEl('input', { type: 'text', value: t.icon ?? '', placeholder: 'e.g. check-circle, target, hash' });

    const targetRow = form.createDiv('vital-log-form-row');
    targetRow.createEl('label', { text: 'Target' });
    const targetInput = targetRow.createEl('input', { type: 'number', value: String(t.target) });

    const stepRow = form.createDiv('vital-log-form-row');
    stepRow.createEl('label', { text: 'Step' });
    const stepInput = stepRow.createEl('input', { type: 'number', value: String(t.step) });

    const statusBarRow = form.createDiv('vital-log-form-row');
    statusBarRow.createEl('label', { text: 'Show in status bar' });
    const statusBarCheckbox = statusBarRow.createEl('input', { type: 'checkbox' });
    statusBarCheckbox.checked = t.showInStatusBar === true;

    const appendNoteRow = form.createDiv('vital-log-form-row');
    appendNoteRow.createEl('label', { text: 'Append to note (path)' });
    const appendNoteInput = appendNoteRow.createEl('input', { type: 'text', value: t.appendToNoteName ?? '', placeholder: 'e.g. Business Outreaches' });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      if (!name || !key) return;

      t.displayName = name;
      t.propertyKey = key;
      t.description = descInput.value.trim() || undefined;
      t.icon = iconInput.value.trim() || undefined;
      t.target = parseInt(targetInput.value) || 10;
      t.step = Math.max(1, parseInt(stepInput.value) || 1);
      t.showInStatusBar = statusBarCheckbox.checked || undefined;
      t.appendToNoteName = appendNoteInput.value.trim() || undefined;
      await this.plugin.saveSettings();
      this.display();
    });
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

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = iconRow.createEl('input', { type: 'text', placeholder: 'e.g. smile, zap, activity' });

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
        icon: iconInput.value.trim() || 'activity',
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

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = iconRow.createEl('input', { type: 'text', value: tracker.icon ?? '', placeholder: 'e.g. smile, zap, activity' });

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
      tracker.icon = iconInput.value.trim() || 'activity';
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
    const items = this.modal.items;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = fieldListEl.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');

      if (item.type === 'field') {
        const field = item.field;
        info.createDiv({ cls: 'vital-log-item-name', text: field.displayName });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${field.propertyKey} · ${field.fieldType}${this.getFieldMeta(field)}`,
        });
      } else if (item.type === 'tally') {
        const tc = this.plugin.settings.tallyCounters?.find((t) => t.id === item.tallyCounterId);
        info.createDiv({ cls: 'vital-log-item-name', text: tc?.displayName ?? '(deleted tally)' });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: tc ? `${tc.propertyKey} · tally · target ${tc.target}` : item.tallyCounterId,
        });
      } else if (item.type === 'button') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.button.displayName });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${item.button.buttonType} → ${item.button.target}`,
        });
      }

      const actions = row.createDiv('vital-log-item-actions');

      if (i > 0) {
        const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn' });
        upBtn.addEventListener('click', () => {
          [items[i - 1], items[i]] = [items[i], items[i - 1]];
          this.renderFieldList(fieldListEl);
        });
      }
      if (i < items.length - 1) {
        const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn' });
        downBtn.addEventListener('click', () => {
          [items[i], items[i + 1]] = [items[i + 1], items[i]];
          this.renderFieldList(fieldListEl);
        });
      }

      if (item.type === 'field') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderFieldForm(fieldListEl, item.field, true);
        });
      } else if (item.type === 'button') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderButtonForm(fieldListEl, item.button, true);
        });
      }

      const delBtn = actions.createEl('button', { text: '\u00d7', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', () => {
        this.modal.items.splice(i, 1);
        this.renderFieldList(fieldListEl);
      });
    }

    if (items.length === 0) {
      fieldListEl.createDiv({ cls: 'vital-log-empty-state', text: 'No items yet. Add fields, tally counters, or buttons below.' });
    }

    const addRow = fieldListEl.createDiv('vital-log-field-add-row');

    const addFieldBtn = addRow.createEl('button', { text: '+ Add Field', cls: 'vital-log-btn mod-cta' });
    addFieldBtn.addEventListener('click', () => {
      const newField: CustomField = {
        id: crypto.randomUUID(),
        propertyKey: '',
        displayName: '',
        description: '',
        fieldType: 'text',
      };
      this.renderFieldForm(fieldListEl, newField, false);
    });

    const availableTallies = (this.plugin.settings.tallyCounters ?? []).filter(
      (tc) => !this.modal.items.some((it) => it.type === 'tally' && it.tallyCounterId === tc.id)
    );
    if (availableTallies.length > 0) {
      const addTallyBtn = addRow.createEl('button', { text: '+ Add Tally Counter', cls: 'vital-log-btn' });
      addTallyBtn.addEventListener('click', () => {
        this.renderTallyPickerForm(fieldListEl, availableTallies);
      });
    } else if ((this.plugin.settings.tallyCounters ?? []).length === 0) {
      addRow.createEl('span', {
        cls: 'vital-log-item-meta',
        text: ' \u00b7 No tally counters defined yet. Add them in the Tally Counters tab.',
      });
    }

    const addButtonBtn = addRow.createEl('button', { text: '+ Add Button', cls: 'vital-log-btn' });
    addButtonBtn.addEventListener('click', () => {
      const newButton: CustomButtonConfig = {
        id: crypto.randomUUID(),
        displayName: '',
        buttonType: 'filelink',
        target: '',
      };
      this.renderButtonForm(fieldListEl, newButton, false);
    });
  }

  private renderTallyPickerForm(fieldListEl: HTMLElement, available: TallyCounterConfig[]): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: 'Add Tally Counter' });

    const row = form.createDiv('vital-log-form-row');
    row.createEl('label', { text: 'Tally Counter' });
    const select = row.createEl('select');
    for (const tc of available) {
      select.createEl('option', { value: tc.id, text: `${tc.displayName} (${tc.propertyKey})` });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const addBtn = actions.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      if (!select.value) return;
      this.modal.items.push({ type: 'tally', tallyCounterId: select.value });
      form.remove();
      this.renderFieldList(fieldListEl);
    });
  }

  private renderButtonForm(
    fieldListEl: HTMLElement,
    button: CustomButtonConfig,
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? `Edit: ${button.displayName}` : 'New Button' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Label' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Open Journal',
      value: button.displayName,
    });

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Action' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'filelink', text: 'Open file' });
    typeSelect.createEl('option', { value: 'command', text: 'Run command' });
    typeSelect.value = button.buttonType;

    const targetRow = form.createDiv('vital-log-form-row');
    const targetLabel = targetRow.createEl('label', { text: 'File path' });
    const targetInput = targetRow.createEl('input', {
      type: 'text',
      placeholder: 'Notes/Journal.md',
      value: button.target,
    });

    const updateTargetLabel = () => {
      if (typeSelect.value === 'filelink') {
        targetLabel.setText('File path');
        targetInput.placeholder = 'Notes/Journal.md';
      } else {
        targetLabel.setText('Command ID');
        targetInput.placeholder = 'daily-notes:open-daily-note';
      }
    };
    typeSelect.addEventListener('change', updateTargetLabel);

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon (optional)' });
    const iconInput = iconRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. book-open, terminal',
      value: button.icon ?? '',
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save Button', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      const target = targetInput.value.trim();
      if (!name || !target) return;

      button.displayName = name;
      button.buttonType = typeSelect.value as 'filelink' | 'command';
      button.target = target;
      button.icon = iconInput.value.trim() || undefined;

      if (!isEdit) {
        this.modal.items.push({ type: 'button', button });
      } else {
        const idx = this.modal.items.findIndex((it) => it.type === 'button' && it.button.id === button.id);
        if (idx >= 0) {
          this.modal.items[idx] = { type: 'button', button };
        }
      }

      form.remove();
      this.renderFieldList(fieldListEl);
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
        this.modal.items.push({ type: 'field', field });
      } else {
        // Update in place
        const idx = this.modal.items.findIndex((it) => it.type === 'field' && it.field.id === field.id);
        if (idx >= 0) {
          this.modal.items[idx] = { type: 'field', field };
        }
      }

      form.remove();
      this.renderFieldList(fieldListEl);
    });
  }
}
