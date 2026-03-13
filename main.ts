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
import { TrackerModal } from './src/trackerModal';

export default class VitalLogPlugin extends Plugin {
  settings: VitalLogSettings = DEFAULT_SETTINGS;

  private openLogModal(initialType?: 'vitamin' | 'pack' | 'stack'): void {
    new LogModal(
      this.app, this.settings, () => this.saveSettings(),
      initialType,
      () => this.openTrackerModal()
    ).open();
  }

  private openTrackerModal(initialTrackerId?: string): void {
    new TrackerModal(
      this.app, this.settings, () => this.saveSettings(),
      initialTrackerId,
      () => this.openLogModal()
    ).open();
  }

  async onload(): Promise<void> {
    await this.loadSettings();

    // ── Settings tab ───────────────────────────────────────
    this.addSettingTab(new VitalLogSettingTab(this.app, this));

    // ── Ribbon icon ────────────────────────────────────────
    this.addRibbonIcon('pill', 'Vital Log: Log Supplement', () => {
      this.openLogModal();
    });

    // ── Commands ───────────────────────────────────────────
    this.addCommand({
      id: 'log-vitamin',
      name: 'Log Vitamin',
      callback: () => this.openLogModal('vitamin'),
    });

    this.addCommand({
      id: 'log-pack',
      name: 'Log Pack',
      callback: () => this.openLogModal('pack'),
    });

    this.addCommand({
      id: 'log-stack',
      name: 'Log Stack',
      callback: () => this.openLogModal('stack'),
    });

    // ── Tracker commands ──────────────────────────────────
    this.addRibbonIcon('activity', 'Vital Log: Log Tracker', () => {
      this.openTrackerModal();
    });

    this.addCommand({
      id: 'log-tracker',
      name: 'Log Tracker',
      callback: () => this.openTrackerModal(),
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
