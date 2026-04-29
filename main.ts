// ============================================================
// Vital Log — Plugin Bootstrap
// Wires all modules together. No business logic here.
// ============================================================

import { Plugin, Notice } from 'obsidian';
import type { VitalLogSettings, CustomField } from './src/types';
import { DEFAULT_SETTINGS } from './src/types';
import { VitalLogSettingTab } from './src/settings';
import { LogModal } from './src/logModal';
import { HistoryModal } from './src/historyModal';
import { ManageModal } from './src/manageModal';
import { TrackerModal } from './src/trackerModal';
import { CustomLogModal } from './src/customLogModal';
import { CustomModalChooser } from './src/customModalChooser';

export default class VitalLogPlugin extends Plugin {
  settings: VitalLogSettings = DEFAULT_SETTINGS;

  // Track dynamically registered command IDs so we can unregister on change
  private customModalCommandIds: string[] = [];

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

    // ── Custom modal commands ─────────────────────────────
    this.addRibbonIcon('layout-grid', 'Vital Log: Custom Modals', () => {
      new CustomModalChooser(this.app, this.settings, () => this.saveSettings()).open();
    });

    this.addCommand({
      id: 'choose-log-modal',
      name: 'Choose Log Modal',
      callback: () => {
        new CustomModalChooser(this.app, this.settings, () => this.saveSettings()).open();
      },
    });

    this.registerCustomModalCommands();
  }

  onunload(): void {
    // Obsidian automatically closes all registered modals and event listeners.
  }

  /**
   * Register (or re-register) individual commands for each custom modal.
   * Called on load and whenever custom modals are added/removed in settings.
   */
  registerCustomModalCommands(): void {
    // Remove previously registered custom modal commands
    for (const cmdId of this.customModalCommandIds) {
      // Obsidian doesn't have a public removeCommand API, but we can
      // delete from the internal command registry
      const fullId = `${this.manifest.id}:${cmdId}`;
      if ((this.app as any).commands?.commands?.[fullId]) {
        delete (this.app as any).commands.commands[fullId];
      }
    }
    this.customModalCommandIds = [];

    // Register a command for each custom modal
    for (const modal of this.settings.customModals) {
      const cmdId = `custom-modal-${modal.id}`;
      this.addCommand({
        id: cmdId,
        name: modal.displayName,
        callback: () => {
          new CustomLogModal(
            this.app,
            this.settings,
            () => this.saveSettings(),
            modal
          ).open();
        },
      });
      this.customModalCommandIds.push(cmdId);
    }
  }

  async loadSettings(): Promise<void> {
    try {
      const stored = await this.loadData() as Partial<VitalLogSettings> | null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});

      // Migrate legacy CustomModalConfig.fields → items
      let needsSave = false;
      for (const modal of this.settings.customModals) {
        const legacy = modal as unknown as Record<string, unknown>;
        if ('fields' in legacy && !('items' in legacy)) {
          const fields = (legacy['fields'] as CustomField[]) ?? [];
          (modal as unknown as Record<string, unknown>)['items'] = fields.map((f) => ({ type: 'field', field: f }));
          delete legacy['fields'];
          needsSave = true;
        }
      }
      if (needsSave) await this.saveSettings();
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
