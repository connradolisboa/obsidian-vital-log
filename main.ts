// ============================================================
// Vital Log — Plugin Bootstrap
// Wires all modules together. No business logic here.
// ============================================================

import { Plugin, Notice, setIcon, TFile } from 'obsidian';
import type { VitalLogSettings, CustomField, TallyCounterConfig } from './src/types';
import { DEFAULT_SETTINGS, metricFromLegacyTracker, metricFromLegacyTally, scalarMetrics } from './src/types';
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

export default class VitalLogPlugin extends Plugin {
  settings: VitalLogSettings = DEFAULT_SETTINGS;

  // Track dynamically registered command IDs so we can unregister on change
  private customModalCommandIds: string[] = [];

  // Status bar items for tally counters with showInStatusBar enabled
  private tallyStatusItems: { el: HTMLElement; config: TallyCounterConfig }[] = [];

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
    this.initStatusBar();
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

  private initStatusBar(): void {
    const tallies = scalarMetrics(this.settings).filter((t) => t.showInStatusBar);
    for (const config of tallies) {
      const el = this.addStatusBarItem();
      el.addClass('vital-log-status-item');
      this.tallyStatusItems.push({ el, config });
    }
  }

  private updateStatusBar(): void {
    if (this.tallyStatusItems.length === 0) return;
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
      const stored = await this.loadData() as Partial<VitalLogSettings> | null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});

      // ── Migrate legacy trackers + tallyCounters → unified metrics ──
      // One-time, config-only. Daily-note frontmatter is untouched: a series
      // metric still reads/writes its list, a scalar metric its {value} object.
      const legacy = stored as (Record<string, unknown> | null);
      const hasLegacy = !!legacy && ('trackers' in legacy || 'tallyCounters' in legacy);
      const hasMetrics = !!legacy && Array.isArray((legacy as Record<string, unknown>)['metrics']);
      if (hasLegacy && !hasMetrics) {
        const legacyTrackers = Array.isArray(legacy!['trackers']) ? (legacy!['trackers'] as Record<string, unknown>[]) : [];
        const legacyTallies = Array.isArray(legacy!['tallyCounters']) ? (legacy!['tallyCounters'] as Record<string, unknown>[]) : [];
        this.settings.metrics = [
          ...legacyTrackers.map(metricFromLegacyTracker),
          ...legacyTallies.map(metricFromLegacyTally),
        ];
        // Drop legacy arrays so they don't re-serialize or shadow `metrics`.
        delete this.settings.trackers;
        delete this.settings.tallyCounters;
        await this.saveSettings();
      }
      delete this.settings.trackers;
      delete this.settings.tallyCounters;
      if (!Array.isArray(this.settings.metrics)) this.settings.metrics = [];

      // Ensure planned-logs structure exists with its own object/arrays
      // (don't share the DEFAULT_SETTINGS reference).
      const pl = this.settings.plannedLogs;
      this.settings.plannedLogs = {
        trackerGoals: pl?.trackerGoals ?? [],
        schedule: pl?.schedule ?? [],
      };

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

      // Take an initial snapshot if none exists yet
      if (!this.settings.propertyKeySnapshot) {
        this.settings.propertyKeySnapshot = buildSnapshot(this.settings);
        await this.saveSettings();
      }
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
