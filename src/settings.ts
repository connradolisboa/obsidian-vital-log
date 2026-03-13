// ============================================================
// Vital Log — Settings Tab
// ============================================================

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VitalLogPlugin from '../main';
import { ManageModal } from './manageModal';

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
      text: 'Supported tokens: {{YYYY}} = year, {{Q}} = quarter (1–4), {{YYYY-MM-DD dddd}} = e.g. 2025-03-10 Monday',
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
