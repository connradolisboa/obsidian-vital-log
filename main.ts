// ============================================================
// Vital Log — Plugin Bootstrap
// Wires all modules together. No business logic here.
// ============================================================

import { Plugin, Notice, setIcon, TFile } from 'obsidian';
import type { VitalLogSettings, TallyCounterConfig } from './src/types';
import { DEFAULT_SETTINGS, scalarMetrics } from './src/types';
import { migrateSettings } from './src/settingsMigrations';
import { buildSnapshot } from './src/keySnapshotManager';
import { getDailyNoteIfExists } from './src/dailyNoteResolver';
import { VitalLogSettingTab } from './src/settings';
import { LogModal } from './src/logModal';
import { HistoryModal } from './src/historyModal';
import { ManageModal } from './src/manageModal';
import { TrackerModal } from './src/trackerModal';
import { CustomLogModal } from './src/customLogModal';
import { CustomModalChooser } from './src/customModalChooser';
import { registerEmbedRenderer } from './src/embedRenderer';
import { registerInlineRenderers, buildInlineEditorExtension } from './src/inlineRenderer';
import { registerMobileKeyboard } from './src/mobileKeyboard';
import { DashboardView, VIEW_TYPE_VITAL_DASHBOARD } from './src/dashboardView';
import { DashboardModal } from './src/dashboardModal';
import { registerDashboardEmbed } from './src/dashboardEmbed';
import { removeCommand } from './src/internal';
import { EventModal } from './src/eventModal';

export default class VitalLogPlugin extends Plugin {
  settings: VitalLogSettings = DEFAULT_SETTINGS;

  // Track dynamically registered command IDs so we can unregister on change
  private customModalCommandIds: string[] = [];

  // Status bar items for tally counters with showInStatusBar enabled
  private tallyStatusItems: { el: HTMLElement; config: TallyCounterConfig }[] = [];

  // Identity of the counters currently on the status bar, so refreshStatusBar
  // can tell a real composition change from an ordinary settings save.
  private statusBarSignature = '';

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

  private openEventModal(): void {
    new EventModal(this.app, this.settings, () => this.saveSettings()).open();
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

    // ── Event commands ─────────────────────────────────────
    this.addRibbonIcon('calendar-clock', 'Vital Log: Log Event', () => {
      this.openEventModal();
    });

    this.addCommand({
      id: 'log-event',
      name: 'Log Event',
      callback: () => this.openEventModal(),
    });

    this.addCommand({
      id: 'view-history',
      name: 'View History',
      callback: () => {
        new HistoryModal(this.app, this.settings, () => this.saveSettings()).open();
      },
    });

    // ── Dashboard ─────────────────────────────────────────
    this.registerView(
      VIEW_TYPE_VITAL_DASHBOARD,
      (leaf) => new DashboardView(leaf, this)
    );

    this.addRibbonIcon('layout-dashboard', 'Vital Log: Dashboard', () => {
      void this.activateDashboardView();
    });

    this.addCommand({
      id: 'open-dashboard',
      name: 'Open Dashboard',
      callback: () => void this.activateDashboardView(),
    });

    this.addCommand({
      id: 'open-dashboard-modal',
      name: 'Open Dashboard (modal)',
      callback: () => new DashboardModal(this.app, this).open(),
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
    registerEmbedRenderer(this);
    registerDashboardEmbed(this);
    registerInlineRenderers(this);
    this.registerEditorExtension(buildInlineEditorExtension(this));

    // Keep focused inputs visible above the soft keyboard on mobile
    registerMobileKeyboard(this);

    // ── Status bar for tally counters ─────────────────────
    // refreshStatusBar rather than initStatusBar: a migration during
    // loadSettings() can already have built the items via saveSettings(), and
    // rebuilding from scratch is the only idempotent way to get here.
    this.refreshStatusBar();
    this.app.workspace.onLayoutReady(() => this.updateStatusBar());
    this.registerEvent(
      this.app.metadataCache.on('changed', (file: TFile) => {
        const daily = getDailyNoteIfExists(this.app, this.settings);
        if (daily && file.path === daily.path) {
          this.updateStatusBar();
        }
      })
    );
  }

  onunload(): void {
    // Obsidian automatically closes all registered modals and event listeners.
  }

  /** Reveal the dashboard pane, reusing an existing leaf or opening one on the right. */
  async activateDashboardView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_VITAL_DASHBOARD);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_VITAL_DASHBOARD, active: true });
      await workspace.revealLeaf(leaf);
    }
  }

  /**
   * Register (or re-register) individual commands for each custom modal.
   * Called on load and whenever custom modals are added/removed in settings.
   */
  registerCustomModalCommands(): void {
    // Remove previously registered custom modal commands
    for (const cmdId of this.customModalCommandIds) {
      removeCommand(this.app, `${this.manifest.id}:${cmdId}`);
    }
    this.customModalCommandIds = [];

    // Register a command for each active (non-archived) custom modal
    for (const modal of this.settings.customModals) {
      if (modal.archived) continue;
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

  /**
   * Bring the status bar in line with current settings.
   *
   * Items used to be created once at startup, so enabling, disabling,
   * renaming, or deleting a counter left the bar stale until Obsidian was
   * reloaded. This runs after every settings save; because most saves are
   * ordinary log actions that don't touch the bar's composition, the elements
   * are only torn down when the set of counters actually changed.
   */
  refreshStatusBar(): void {
    const tallies = scalarMetrics(this.settings).filter((t) => t.showInStatusBar);
    const signature = tallies
      .map((t) => `${t.id} ${t.propertyKey} ${t.icon ?? ''} ${t.target}`)
      .join('');

    if (signature !== this.statusBarSignature) {
      this.statusBarSignature = signature;
      for (const { el } of this.tallyStatusItems) el.remove();
      this.tallyStatusItems = tallies.map((config) => {
        const el = this.addStatusBarItem();
        el.addClass('vital-log-status-item');
        return { el, config };
      });
    }

    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const daily = getDailyNoteIfExists(this.app, this.settings);
    const fm = daily
      ? (this.app.metadataCache.getFileCache(daily)?.frontmatter ?? {})
      : {};

    for (const { el, config } of this.tallyStatusItems) {
      el.empty();
      if (config.icon) {
        const iconSpan = el.createSpan({ cls: 'vital-log-status-icon' });
        setIcon(iconSpan, config.icon);
      }
      const raw = fm[config.propertyKey];
      const value =
        typeof raw === 'object' && raw !== null && 'value' in raw
          ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
          : 0;
      el.createSpan({ text: ` ${value}/${config.target}` });
    }
  }

  async loadSettings(): Promise<void> {
    try {
      const stored = await this.loadData() as unknown;

      // Versioned migration + per-field validation. A damaged field is reset on
      // its own rather than costing the user their whole configuration.
      const { settings, changed, notes } = migrateSettings(stored);
      this.settings = settings;

      for (const note of notes) console.info('Vital Log settings:', note);
      if (notes.some((n) => n.includes('reset to its default'))) {
        new Notice('Vital Log: Some settings were invalid and have been reset. See the console.');
      }

      // Take an initial snapshot if none exists yet
      const needsSnapshot = !this.settings.propertyKeySnapshot;
      if (needsSnapshot) {
        this.settings.propertyKeySnapshot = buildSnapshot(this.settings);
      }

      if (changed || needsSnapshot) await this.saveSettings();
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
    // Settings changes can add, remove, rename, or re-target a status-bar
    // counter, so the bar is rebuilt here rather than only at startup.
    this.refreshStatusBar();
  }
}
