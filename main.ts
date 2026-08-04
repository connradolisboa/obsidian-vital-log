// ============================================================
// Vital Log — Plugin Bootstrap
// Wires all modules together. No business logic here.
// ============================================================

import { Plugin, Notice, setIcon, TFile } from 'obsidian';
import type { VitalLogSettings, TallyCounterConfig } from './src/types';
import { DEFAULT_SETTINGS, scalarMetrics } from './src/types';
import { migrateSettings } from './src/settingsMigrations';
import {
  buildSnapshot,
  reconcileSnapshot,
  detectChanges,
  changeAffectsVault,
  changeSignature,
} from './src/keySnapshotManager';
import { KeyDiagnosticModal } from './src/keyDiagnosticModal';
import { confirm } from './src/confirmModal';
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

  // True while the rename prompt (or the diagnostic dialog it opens) is up, so
  // saves that happen underneath it don't stack a duplicate prompt.
  private keyRenamePromptOpen = false;

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
    this.app.workspace.onLayoutReady(() => {
      this.updateStatusBar();
      // Catch renames made in a session that ended before the prompt could be
      // answered. Needs the metadata cache, hence layout-ready rather than here.
      void this.checkForKeyRenames();
    });
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
    // Baseline anything created since the last save. Without this a brand-new
    // vitamin or metric has no recorded key, so renaming it later reads as
    // "nothing changed" and its already-logged notes are never offered up for
    // migration.
    const { snapshot, changed } = reconcileSnapshot(this.settings.propertyKeySnapshot, this.settings);
    if (changed) this.settings.propertyKeySnapshot = snapshot;

    try {
      await this.saveData(this.settings);
    } catch (err) {
      new Notice('Vital Log: Failed to save settings.');
      console.error('Vital Log saveSettings:', err);
    }
    // Settings changes can add, remove, rename, or re-target a status-bar
    // counter, so the bar is rebuilt here rather than only at startup.
    this.refreshStatusBar();

    void this.checkForKeyRenames();
  }

  /**
   * Offer to migrate old frontmatter after a key rename.
   *
   * Renames used to be found only by opening the diagnostic dialog by hand, so
   * notes quietly kept the stale key until someone thought to look. This runs
   * after every save instead, and stays quiet unless a rename actually stranded
   * data: a key corrected before it was ever logged is silently re-baselined,
   * and a change the user defers is remembered so it is never raised twice.
   */
  private async checkForKeyRenames(): Promise<void> {
    if (this.keyRenamePromptOpen) return;
    const snapshot = this.settings.propertyKeySnapshot;
    if (!snapshot) return;

    const changes = detectChanges(snapshot, this.settings);
    const signatures = new Set(changes.map(changeSignature));

    // Drop dismissals for changes that no longer exist (migrated, renamed back,
    // or the entity was deleted) so the list can't grow without bound.
    const dismissed = (this.settings.keyRenameDismissed ?? []).filter((s) => signatures.has(s));
    if (dismissed.length !== (this.settings.keyRenameDismissed ?? []).length) {
      this.settings.keyRenameDismissed = dismissed.length > 0 ? dismissed : undefined;
      await this.persist();
    }

    const pending = changes.filter((c) => !dismissed.includes(changeSignature(c)));
    if (pending.length === 0) return;

    // A key nothing has written yet needs no migration — typically a metric
    // whose key was fixed up right after it was created.
    const stranded = pending.filter((c) => changeAffectsVault(this.app, c));
    if (stranded.length === 0) {
      this.settings.propertyKeySnapshot = buildSnapshot(this.settings);
      await this.persist();
      return;
    }

    // Held until the user is finished with the prompt (and the diagnostic dialog
    // behind it), so ordinary saves in the meantime can't stack a second copy.
    this.keyRenamePromptOpen = true;
    try {
      const names = stranded.map((c) => `"${c.entityName}"`).join(', ');
      const migrate = await confirm(this.app, {
        title: 'Property key renamed',
        message: [
          `${names} now write${stranded.length === 1 ? 's' : ''} to a different frontmatter key, but existing notes still use the old one.`,
          'Update those notes now, or leave them as they are — you can always revisit this from Settings → Maintenance → Diagnose Changed Keys.',
        ],
        confirmText: 'Review and migrate',
        cancelText: 'Not now',
        destructive: false,
      });

      // Whatever the user does from here, these changes have been raised once —
      // don't interrupt them with the same ones again. A completed migration
      // stops them being detected at all, so the dismissals get pruned above.
      this.settings.keyRenameDismissed = [...dismissed, ...stranded.map(changeSignature)];
      await this.persist();

      if (migrate) {
        new KeyDiagnosticModal(
          this.app,
          this.settings,
          async () => {
            this.settings.propertyKeySnapshot = buildSnapshot(this.settings);
            await this.persist();
          },
          () => { this.keyRenamePromptOpen = false; }
        ).open();
        return; // the dialog's own close handler releases the guard
      }
      this.keyRenamePromptOpen = false;
    } catch (err) {
      this.keyRenamePromptOpen = false;
      console.error('Vital Log key rename check:', err);
    }
  }

  /** Write settings straight to disk, skipping the saveSettings side effects. */
  private async persist(): Promise<void> {
    try {
      await this.saveData(this.settings);
    } catch (err) {
      console.error('Vital Log persist:', err);
    }
  }
}
