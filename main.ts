// ============================================================
// Vital Log — Plugin Bootstrap
// Wires all modules together. No business logic here.
// ============================================================

import { Plugin, Notice } from 'obsidian';
import type { VitalLogSettings } from './src/types';
import { DEFAULT_SETTINGS } from './src/types';
import { VitalLogSettingTab } from './src/settings';
import { LogModal } from './src/logModal';
import { HistoryModal } from './src/historyModal';
import { ManageModal } from './src/manageModal';

export default class VitalLogPlugin extends Plugin {
  settings: VitalLogSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    // ── Settings tab ───────────────────────────────────────
    this.addSettingTab(new VitalLogSettingTab(this.app, this));

    // ── Ribbon icon ────────────────────────────────────────
    this.addRibbonIcon('pill', 'Vital Log: Log Supplement', () => {
      new LogModal(this.app, this.settings, () => this.saveSettings()).open();
    });

    // ── Commands ───────────────────────────────────────────
    this.addCommand({
      id: 'log-vitamin',
      name: 'Log Vitamin',
      callback: () => {
        new LogModal(this.app, this.settings, () => this.saveSettings(), 'vitamin').open();
      },
    });

    this.addCommand({
      id: 'log-pack',
      name: 'Log Pack',
      callback: () => {
        new LogModal(this.app, this.settings, () => this.saveSettings(), 'pack').open();
      },
    });

    this.addCommand({
      id: 'log-stack',
      name: 'Log Stack',
      callback: () => {
        new LogModal(this.app, this.settings, () => this.saveSettings(), 'stack').open();
      },
    });

    this.addCommand({
      id: 'view-history',
      name: 'View History',
      callback: () => {
        new HistoryModal(this.app, this.settings, () => this.saveSettings()).open();
      },
    });

    this.addCommand({
      id: 'manage',
      name: 'Manage Vitamins / Packs / Stacks',
      callback: () => {
        new ManageModal(this.app, this.settings, () => this.saveSettings()).open();
      },
    });
  }

  onunload(): void {
    // Obsidian automatically closes all registered modals and event listeners.
  }

  async loadSettings(): Promise<void> {
    try {
      const stored = await this.loadData() as Partial<VitalLogSettings> | null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
    } catch (err) {
      new Notice('Vital Log: Failed to load settings. Using defaults.');
      console.error('Vital Log loadSettings:', err);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(): Promise<void> {
    try {
      await this.saveData(this.settings);
    } catch (err) {
      new Notice('Vital Log: Failed to save settings.');
      console.error('Vital Log saveSettings:', err);
    }
  }
}
