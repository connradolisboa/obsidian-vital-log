// ============================================================
// Vital Log — Settings Tab
// ============================================================

import { App, Modal, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { CustomModalConfig, CustomField, CustomFieldType, TallyCounterConfig, TrackerConfig, CustomModalItem, CustomButtonConfig, MirrorConditionalPin } from './types';
import { CUSTOM_FIELD_TYPES } from './types';
import { ManageModal } from './manageModal';
import { KeyDiagnosticModal } from './keyDiagnosticModal';
import { buildSnapshot } from './keySnapshotManager';

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

    // ── Mirror Mode ──
    el.createEl('h3', { text: 'Mirror Mode' });

    new Setting(el)
      .setName('Excluded property keys')
      .setDesc('Property keys that will never appear in the "Other Properties" section of Mirror modals. One key per line (e.g. tags, cssclasses).')
      .addTextArea((ta) => {
        ta.setPlaceholder('tags\ncssclasses\ncreated');
        ta.setValue((this.plugin.settings.mirrorExcludedKeys ?? []).join('\n'));
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = '100%';
        ta.onChange(async (value) => {
          this.plugin.settings.mirrorExcludedKeys = value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        });
      });

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

    // ── Maintenance ──
    el.createEl('h3', { text: 'Maintenance' });

    new Setting(el)
      .setName('Diagnose changed keys')
      .setDesc(
        'Scan your vault for notes that still use old property keys after renaming a tracker, tally, vitamin, or custom field. ' +
        'Supports nested (sub-property) keys that Obsidian\'s built-in rename cannot handle.'
      )
      .addButton((btn) =>
        btn
          .setButtonText('Diagnose Changed Keys')
          .onClick(() => {
            new KeyDiagnosticModal(
              this.app,
              this.plugin.settings,
              async () => {
                this.plugin.settings.propertyKeySnapshot = buildSnapshot(this.plugin.settings);
                await this.plugin.saveSettings();
              }
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
    let trackerDragIdx = -1;
    for (let i = 0; i < this.plugin.settings.trackers.length; i++) {
      const tracker = this.plugin.settings.trackers[i];
      const row = trackerList.createDiv('vital-log-item-row');
      row.draggable = true;
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
      const info = row.createDiv('vital-log-item-info');
      const trackerNameEl = info.createDiv({ cls: 'vital-log-item-name' });
      if (tracker.icon) {
        const iconSpan = trackerNameEl.createSpan({ cls: 'vital-log-item-icon' });
        setIcon(iconSpan, tracker.icon);
      }
      trackerNameEl.createSpan({ text: tracker.displayName });
      const isMinuteTracker = tracker.trackerType === 'minutes';
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: isMinuteTracker
          ? `${tracker.propertyKey} · ${tracker.valueName} · minutes`
          : `${tracker.propertyKey} · ${tracker.valueName} · ${tracker.min}–${tracker.max}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      row.addEventListener('dragstart', (e) => {
        trackerDragIdx = i;
        row.classList.add('is-dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (trackerDragIdx !== i) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (trackerDragIdx !== -1 && trackerDragIdx !== i) {
          const arr = this.plugin.settings.trackers;
          const [moved] = arr.splice(trackerDragIdx, 1);
          arr.splice(i, 0, moved);
          trackerDragIdx = -1;
          await this.plugin.saveSettings();
          this.display();
        }
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        trackerList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        trackerDragIdx = -1;
      });

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

    const activeModals = this.plugin.settings.customModals.filter((m) => !m.archived);
    const archivedModals = this.plugin.settings.customModals.filter((m) => m.archived);

    const modalList = el.createDiv('vital-log-item-list');
    let modalDragIdx = -1;
    for (let i = 0; i < activeModals.length; i++) {
      const modal = activeModals[i];
      const row = modalList.createDiv('vital-log-item-row');
      row.draggable = true;
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: modal.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${modal.items.length} item${modal.items.length !== 1 ? 's' : ''} · ${modal.notePath || '(no path)'}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      row.addEventListener('dragstart', (e) => {
        modalDragIdx = i;
        row.classList.add('is-dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (modalDragIdx !== i) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (modalDragIdx !== -1 && modalDragIdx !== i) {
          const arr = this.plugin.settings.customModals;
          const fromModal = activeModals[modalDragIdx];
          const toModal = activeModals[i];
          const fromIdx = arr.indexOf(fromModal);
          const toIdx = arr.indexOf(toModal);
          if (fromIdx !== -1 && toIdx !== -1) {
            const [moved] = arr.splice(fromIdx, 1);
            arr.splice(toIdx, 0, moved);
          }
          modalDragIdx = -1;
          await this.plugin.saveSettings();
          this.plugin.registerCustomModalCommands();
          this.display();
        }
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        modalList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        modalDragIdx = -1;
      });

      const dupBtn = actions.createEl('button', { text: 'Duplicate', cls: 'vital-log-btn' });
      dupBtn.addEventListener('click', async () => {
        const copy: import('./types').CustomModalConfig = JSON.parse(JSON.stringify(modal));
        copy.id = crypto.randomUUID();
        copy.displayName = `Copy of ${modal.displayName}`;
        delete copy.archived;
        const origIdx = this.plugin.settings.customModals.indexOf(modal);
        this.plugin.settings.customModals.splice(origIdx + 1, 0, copy);
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      });

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        new CustomModalEditorModal(this.app, this.plugin, modal, true, () => this.display()).open();
      });

      const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn' });
      archiveBtn.title = 'Hide from commands but keep working in embeds';
      archiveBtn.addEventListener('click', async () => {
        modal.archived = true;
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      });
    }

    if (activeModals.length === 0) {
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

    // ── Archived modals ───────────────────────────────────────
    if (archivedModals.length > 0) {
      const details = el.createEl('details', { cls: 'vital-log-archived-modals' });
      details.createEl('summary', { text: `Archived modals (${archivedModals.length})` });
      const archivedList = details.createDiv('vital-log-item-list');

      for (const modal of archivedModals) {
        const row = archivedList.createDiv('vital-log-item-row vital-log-item-row--archived');
        const info = row.createDiv('vital-log-item-info');
        info.createDiv({ cls: 'vital-log-item-name', text: modal.displayName });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${modal.items.length} item${modal.items.length !== 1 ? 's' : ''} · ${modal.notePath || '(no path)'}`,
        });
        const actions = row.createDiv('vital-log-item-actions');

        const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn' });
        restoreBtn.addEventListener('click', async () => {
          delete modal.archived;
          await this.plugin.saveSettings();
          this.plugin.registerCustomModalCommands();
          this.display();
        });

        const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
        delBtn.addEventListener('click', async () => {
          this.plugin.settings.customModals = this.plugin.settings.customModals.filter((m) => m.id !== modal.id);
          await this.plugin.saveSettings();
          this.plugin.registerCustomModalCommands();
          this.display();
        });
      }
    }
  }

  // ── Tally Counters tab ───────────────────────────────────────

  private renderTallyCountersTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Define tally counters for daily counts (e.g. outreach calls). Each counter tracks a single value + note per day.',
      cls: 'vital-log-settings-helper',
    });

    const tallyList = el.createDiv('vital-log-item-list');
    const tallies = this.plugin.settings.tallyCounters ?? [];
    let tallyDragIdx = -1;

    for (let i = 0; i < tallies.length; i++) {
      const t = tallies[i];
      const row = tallyList.createDiv('vital-log-item-row');
      row.draggable = true;
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
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

      row.addEventListener('dragstart', (e) => {
        tallyDragIdx = i;
        row.classList.add('is-dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (tallyDragIdx !== i) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (tallyDragIdx !== -1 && tallyDragIdx !== i) {
          const [moved] = tallies.splice(tallyDragIdx, 1);
          tallies.splice(i, 0, moved);
          tallyDragIdx = -1;
          await this.plugin.saveSettings();
          this.display();
        }
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        tallyList.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        tallyDragIdx = -1;
      });

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

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Type' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'rating', text: 'Rating (1–N scale)' });
    typeSelect.createEl('option', { value: 'minutes', text: 'Minutes (duration)' });

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

    const syncTypeUI = () => {
      const isMinutes = typeSelect.value === 'minutes';
      minRow.style.display = isMinutes ? 'none' : '';
      maxRow.style.display = isMinutes ? 'none' : '';
      if (isMinutes && !valInput.value) valInput.value = 'minutes';
      if (!isMinutes && valInput.value === 'minutes') valInput.value = '';
    };
    typeSelect.addEventListener('change', syncTypeUI);

    nameInput.addEventListener('input', () => {
      keyInput.value = slugify(nameInput.value) + 'Log';
      if (typeSelect.value === 'rating' && !valInput.value) {
        valInput.value = slugify(nameInput.value);
      }
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      const val = valInput.value.trim();
      if (!name || !key || !val) return;

      const trackerType = typeSelect.value as 'rating' | 'minutes';
      this.plugin.settings.trackers.push({
        id: crypto.randomUUID(),
        displayName: name,
        propertyKey: key,
        valueName: val,
        trackerType,
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

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Type' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'rating', text: 'Rating (1–N scale)' });
    typeSelect.createEl('option', { value: 'minutes', text: 'Minutes (duration)' });
    typeSelect.value = tracker.trackerType ?? 'rating';

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

    const syncTypeUI = () => {
      const isMinutes = typeSelect.value === 'minutes';
      minRow.style.display = isMinutes ? 'none' : '';
      maxRow.style.display = isMinutes ? 'none' : '';
    };
    syncTypeUI();
    typeSelect.addEventListener('change', syncTypeUI);

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
      tracker.trackerType = typeSelect.value as 'rating' | 'minutes';
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

    // ── Mirror Mode ──
    const mirrorRow = metaSection.createDiv('vital-log-form-row');
    mirrorRow.createEl('label', { text: 'Mirror Mode' });
    const mirrorCheckbox = mirrorRow.createEl('input', { type: 'checkbox' });
    mirrorCheckbox.checked = this.modal.mirrorMode ?? false;
    mirrorRow.createEl('span', {
      cls: 'vital-log-form-hint',
      text: 'Only show properties that already exist in the note. Pin fields below to always show them.',
    });

    const otherPropsRow = metaSection.createDiv('vital-log-form-row');
    otherPropsRow.createEl('label', { text: 'Show "Other Properties" section' });
    const otherPropsCheckbox = otherPropsRow.createEl('input', { type: 'checkbox' });
    otherPropsCheckbox.checked = this.modal.showOtherProperties ?? false;
    otherPropsRow.createEl('span', {
      cls: 'vital-log-form-hint',
      text: 'Add a collapsed section showing modal fields that are not yet in the note (excludes globally excluded keys).',
    });
    otherPropsRow.style.display = mirrorCheckbox.checked ? '' : 'none';
    mirrorCheckbox.addEventListener('change', () => {
      otherPropsRow.style.display = mirrorCheckbox.checked ? '' : 'none';
      conditionalPinsWrapper.style.display = mirrorCheckbox.checked ? '' : 'none';
    });

    // ── Conditional Pins (mirror mode only) ──
    const conditionalPinsWrapper = metaSection.createDiv('vital-log-conditional-pins-wrapper');
    conditionalPinsWrapper.style.display = mirrorCheckbox.checked ? '' : 'none';
    this.renderConditionalPinsList(conditionalPinsWrapper);

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
      this.modal.mirrorMode = mirrorCheckbox.checked;
      this.modal.showOtherProperties = mirrorCheckbox.checked ? otherPropsCheckbox.checked : false;

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
    let fieldDragIdx = -1;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = fieldListEl.createDiv('vital-log-item-row');
      row.draggable = true;
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
      const info = row.createDiv('vital-log-item-info');

      if (item.type === 'field') {
        const field = item.field;
        info.createDiv({ cls: 'vital-log-item-name', text: field.displayName });
        const keyDisplay = field.parentKey ? `${field.parentKey}.${field.propertyKey}` : field.propertyKey;
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${keyDisplay} · ${field.fieldType}${this.getFieldMeta(field)}`,
        });
      } else if (item.type === 'tally') {
        const tc = this.plugin.settings.tallyCounters?.find((t) => t.id === item.tallyCounterId);
        info.createDiv({ cls: 'vital-log-item-name', text: tc?.displayName ?? '(deleted tally)' });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: tc ? `${tc.propertyKey} · tally · target ${tc.target}` : item.tallyCounterId,
        });
      } else if (item.type === 'tracker') {
        const tr = this.plugin.settings.trackers?.find((t) => t.id === item.trackerId);
        info.createDiv({ cls: 'vital-log-item-name', text: tr?.displayName ?? '(deleted tracker)' });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: tr ? `${tr.propertyKey} · tracker · ${tr.trackerType ?? 'rating'}` : item.trackerId,
        });
      } else if (item.type === 'button') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.button.displayName });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${item.button.buttonType} → ${item.button.target}`,
        });
      } else if (item.type === 'header') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.text });
        info.createDiv({ cls: 'vital-log-item-meta', text: 'header' });
      } else if (item.type === 'divider') {
        info.createDiv({ cls: 'vital-log-item-name', text: '—' });
        info.createDiv({ cls: 'vital-log-item-meta', text: 'divider' });
      } else if (item.type === 'section') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.title });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `section · ${item.defaultOpen ? 'open' : 'collapsed'} by default`,
        });
      } else if (item.type === 'section-end') {
        info.createDiv({ cls: 'vital-log-item-name', text: 'End section' });
        info.createDiv({ cls: 'vital-log-item-meta', text: 'section end' });
      }

      const actions = row.createDiv('vital-log-item-actions');

      row.addEventListener('dragstart', (e) => {
        fieldDragIdx = i;
        row.classList.add('is-dragging');
        e.dataTransfer!.effectAllowed = 'move';
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (fieldDragIdx !== i) row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (fieldDragIdx !== -1 && fieldDragIdx !== i) {
          const [moved] = items.splice(fieldDragIdx, 1);
          items.splice(i, 0, moved);
          fieldDragIdx = -1;
          this.renderFieldList(fieldListEl);
        }
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('is-dragging');
        fieldListEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        fieldDragIdx = -1;
      });

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
      } else if (item.type === 'header') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderHeaderForm(fieldListEl, item as { type: 'header'; text: string }, true);
        });
      } else if (item.type === 'section') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderSectionForm(fieldListEl, item as { type: 'section'; title: string; defaultOpen: boolean; color?: string }, true);
        });
      }

      // Pin button for field/tally/tracker items (controls mirror mode visibility)
      if (item.type === 'field' || item.type === 'tally' || item.type === 'tracker') {
        const itemId = item.type === 'field' ? item.field.id : item.type === 'tally' ? item.tallyCounterId : item.trackerId;
        if (!this.modal.mirrorModePinnedIds) this.modal.mirrorModePinnedIds = [];
        const isPinned = this.modal.mirrorModePinnedIds.includes(itemId);

        const pinBtn = actions.createEl('button', {
          cls: `vital-log-btn vital-log-pin-btn${isPinned ? ' is-pinned' : ''}`,
          title: isPinned ? 'Unpin (remove always-show in Mirror Mode)' : 'Pin (always show in Mirror Mode)',
        });
        setIcon(pinBtn, 'pin');

        pinBtn.addEventListener('click', () => {
          if (!this.modal.mirrorModePinnedIds) this.modal.mirrorModePinnedIds = [];
          const idx = this.modal.mirrorModePinnedIds.indexOf(itemId);
          if (idx >= 0) {
            this.modal.mirrorModePinnedIds.splice(idx, 1);
          } else {
            this.modal.mirrorModePinnedIds.push(itemId);
          }
          this.renderFieldList(fieldListEl);
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

    const availableTrackers = (this.plugin.settings.trackers ?? []).filter(
      (tr) => !this.modal.items.some((it) => it.type === 'tracker' && it.trackerId === tr.id)
    );
    if (availableTrackers.length > 0) {
      const addTrackerBtn = addRow.createEl('button', { text: '+ Add Tracker', cls: 'vital-log-btn' });
      addTrackerBtn.addEventListener('click', () => {
        this.renderTrackerPickerForm(fieldListEl, availableTrackers);
      });
    } else if ((this.plugin.settings.trackers ?? []).length === 0) {
      addRow.createEl('span', {
        cls: 'vital-log-item-meta',
        text: ' \u00b7 No trackers defined yet. Add them in the Trackers tab.',
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

    const addHeaderBtn = addRow.createEl('button', { text: '+ Add Header', cls: 'vital-log-btn' });
    addHeaderBtn.addEventListener('click', () => {
      this.renderHeaderForm(fieldListEl, { type: 'header', text: '' }, false);
    });

    addRow.createEl('button', { text: '+ Add Divider', cls: 'vital-log-btn' })
      .addEventListener('click', () => {
        this.modal.items.push({ type: 'divider' });
        this.renderFieldList(fieldListEl);
      });

    const addSectionBtn = addRow.createEl('button', { text: '+ Add Section', cls: 'vital-log-btn' });
    addSectionBtn.addEventListener('click', () => {
      this.renderSectionForm(fieldListEl, { type: 'section', title: '', defaultOpen: true }, false);
    });

    addRow.createEl('button', { text: '+ End Section', cls: 'vital-log-btn' })
      .addEventListener('click', () => {
        this.modal.items.push({ type: 'section-end' });
        this.renderFieldList(fieldListEl);
      });
  }

  // ── Conditional Pins (mirror mode) ──────────────────────────

  private renderConditionalPinsList(container: HTMLElement): void {
    container.empty();
    container.createEl('h4', { text: 'Conditional Pins' });
    container.createEl('p', {
      cls: 'vital-log-settings-helper',
      text: 'Always show specific fields when the note matches a tag or folder.',
    });

    const pins = this.modal.mirrorModeConditionalPins ?? [];

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const row = container.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({
        cls: 'vital-log-item-name',
        text: `${pin.conditionType === 'tag' ? 'Tag' : 'Folder'}: ${pin.conditionValue}`,
      });
      const pinnedLabels = pin.pinnedIds.map((id) => {
        const fieldItem = this.modal.items.find((it) => it.type === 'field' && it.field.id === id);
        if (fieldItem && fieldItem.type === 'field') return fieldItem.field.displayName;
        const tallyConfig = this.plugin.settings.tallyCounters?.find((t) => t.id === id);
        if (tallyConfig) return tallyConfig.displayName;
        return id;
      });
      info.createDiv({ cls: 'vital-log-item-meta', text: pinnedLabels.join(', ') || 'no fields selected' });

      const actions = row.createDiv('vital-log-item-actions');
      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => this.renderConditionalPinForm(container, pin, true));

      const delBtn = actions.createEl('button', { text: '×', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', () => {
        if (!this.modal.mirrorModeConditionalPins) return;
        this.modal.mirrorModeConditionalPins.splice(i, 1);
        this.renderConditionalPinsList(container);
      });
    }

    if (pins.length === 0) {
      container.createDiv({ cls: 'vital-log-empty-state', text: 'No conditional pin rules yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Condition', cls: 'vital-log-btn mod-cta' });
    addBtn.style.marginTop = '6px';
    addBtn.addEventListener('click', () => {
      const newPin: MirrorConditionalPin = {
        id: crypto.randomUUID(),
        conditionType: 'tag',
        conditionValue: '',
        pinnedIds: [],
      };
      if (!this.modal.mirrorModeConditionalPins) this.modal.mirrorModeConditionalPins = [];
      this.renderConditionalPinForm(container, newPin, false);
    });
  }

  private renderConditionalPinForm(
    container: HTMLElement,
    pin: MirrorConditionalPin,
    isEdit: boolean,
  ): void {
    const form = container.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Condition' : 'New Condition' });

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Condition type' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'tag', text: 'Tag' });
    typeSelect.createEl('option', { value: 'folder', text: 'Folder' });
    typeSelect.value = pin.conditionType;

    const valueRow = form.createDiv('vital-log-form-row');
    const valueLabel = valueRow.createEl('label', { text: 'Tag (e.g. #work)' });
    const valueInput = valueRow.createEl('input', {
      type: 'text',
      placeholder: '#work',
      value: pin.conditionValue,
    });

    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'tag') {
        valueLabel.setText('Tag (e.g. #work)');
        valueInput.placeholder = '#work';
      } else {
        valueLabel.setText('Folder path (e.g. Work/)');
        valueInput.placeholder = 'Work/';
      }
    });

    // Field checkboxes
    form.createEl('label', { text: 'Always show these fields when matched:', cls: 'vital-log-form-section-label' });
    const checkboxList = form.createDiv('vital-log-conditional-pin-fields');

    const fieldItems = this.modal.items.filter(
      (it) => it.type === 'field' || it.type === 'tally',
    ) as Array<Extract<typeof this.modal.items[0], { type: 'field' | 'tally' }>>;

    const selectedIds = new Set(pin.pinnedIds);

    for (const item of fieldItems) {
      const itemId = item.type === 'field' ? item.field.id : item.tallyCounterId;
      const label = item.type === 'field'
        ? item.field.displayName
        : (this.plugin.settings.tallyCounters?.find((t) => t.id === item.tallyCounterId)?.displayName ?? item.tallyCounterId);

      const row = checkboxList.createDiv('vital-log-form-row vital-log-form-row--compact');
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = selectedIds.has(itemId);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(itemId);
        else selectedIds.delete(itemId);
      });
      row.createSpan({ text: label });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
      .addEventListener('click', () => { form.remove(); });

    actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' })
      .addEventListener('click', () => {
        const val = valueInput.value.trim();
        if (!val) return;
        pin.conditionType = typeSelect.value as 'tag' | 'folder';
        pin.conditionValue = val;
        pin.pinnedIds = [...selectedIds];
        if (!isEdit) {
          if (!this.modal.mirrorModeConditionalPins) this.modal.mirrorModeConditionalPins = [];
          this.modal.mirrorModeConditionalPins.push(pin);
        }
        form.remove();
        this.renderConditionalPinsList(container);
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
      const tc = available.find((t) => t.id === select.value);
      this.modal.items.push({ type: 'tally', tallyCounterId: select.value, tallySnapshot: tc ? { ...tc } : undefined });
      form.remove();
      this.renderFieldList(fieldListEl);
    });
  }

  private renderTrackerPickerForm(fieldListEl: HTMLElement, available: TrackerConfig[]): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: 'Add Tracker' });

    const row = form.createDiv('vital-log-form-row');
    row.createEl('label', { text: 'Tracker' });
    const select = row.createEl('select');
    for (const tr of available) {
      select.createEl('option', { value: tr.id, text: `${tr.displayName} (${tr.propertyKey})` });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    cancelBtn.addEventListener('click', () => { form.remove(); });

    const addBtn = actions.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      if (!select.value) return;
      const tr = available.find((t) => t.id === select.value);
      this.modal.items.push({ type: 'tracker', trackerId: select.value, trackerSnapshot: tr ? { ...tr } : undefined });
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

  private renderHeaderForm(
    fieldListEl: HTMLElement,
    item: { type: 'header'; text: string },
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Header' : 'New Header' });

    const textRow = form.createDiv('vital-log-form-row');
    textRow.createEl('label', { text: 'Header Text' });
    const textInput = textRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Morning Routine',
      value: item.text,
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
      .addEventListener('click', () => form.remove());

    actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' })
      .addEventListener('click', () => {
        const text = textInput.value.trim();
        if (!text) return;
        if (!isEdit) {
          this.modal.items.push({ type: 'header', text });
        } else {
          item.text = text;
        }
        form.remove();
        this.renderFieldList(fieldListEl);
      });
  }

  private renderSectionForm(
    fieldListEl: HTMLElement,
    item: { type: 'section'; title: string; defaultOpen: boolean; color?: string },
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Section' : 'New Section' });

    const titleRow = form.createDiv('vital-log-form-row');
    titleRow.createEl('label', { text: 'Section Title' });
    const titleInput = titleRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Evening Check-in',
      value: item.title,
    });

    const openRow = form.createDiv('vital-log-form-row');
    openRow.createEl('label', { text: 'Expanded by default' });
    const openCheckbox = openRow.createEl('input', { type: 'checkbox' });
    openCheckbox.checked = item.defaultOpen;

    const colorRow = form.createDiv('vital-log-form-row');
    colorRow.createEl('label', { text: 'Accent color' });
    const colorInput = colorRow.createEl('input', { type: 'color' });
    colorInput.addClass('vital-log-color-input');
    colorInput.value = item.color ?? '#7c6cfc';
    const clearColorBtn = colorRow.createEl('button', { text: 'None', cls: 'vital-log-btn' });
    let useColor = !!item.color;
    colorInput.style.opacity = useColor ? '1' : '0.4';
    clearColorBtn.addEventListener('click', () => {
      useColor = false;
      colorInput.style.opacity = '0.4';
    });
    colorInput.addEventListener('input', () => {
      useColor = true;
      colorInput.style.opacity = '1';
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
      .addEventListener('click', () => form.remove());

    actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' })
      .addEventListener('click', () => {
        const title = titleInput.value.trim();
        if (!title) return;
        const color = useColor ? colorInput.value : undefined;
        if (!isEdit) {
          this.modal.items.push({ type: 'section', title, defaultOpen: openCheckbox.checked, color });
        } else {
          item.title = title;
          item.defaultOpen = openCheckbox.checked;
          item.color = color;
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

    const parentKeyRow = form.createDiv('vital-log-form-row');
    parentKeyRow.createEl('label', { text: 'Nest under key (optional)' });
    const parentKeyInput = parentKeyRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. health → writes health.propertyKey',
      value: field.parentKey ?? '',
    });

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
      field.parentKey = parentKeyInput.value.trim() || undefined;
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
