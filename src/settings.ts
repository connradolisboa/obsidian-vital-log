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
}
