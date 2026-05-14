// ============================================================
// Vital Log — Key Diagnostic Modal
// Shows detected property key renames and allows bulk or
// per-change migration across all vault notes.
// ============================================================

import { App, Modal, Notice, TFile, setIcon } from 'obsidian';
import type { VitalLogSettings } from './types';
import {
  buildSnapshot,
  detectChanges,
  findAffectedFiles,
  migrateFileKey,
  type KeyChange,
} from './keySnapshotManager';

const ENTITY_ICON: Record<string, string> = {
  tracker: 'activity',
  tally: 'hash',
  vitamin: 'pill',
  customField: 'layout-grid',
};

interface ChangeRow {
  change: KeyChange;
  files: TFile[] | null; // null = still loading
  status: 'pending' | 'migrating' | 'done' | 'skipped';
  el: HTMLElement;
  countEl: HTMLElement;
  actionsEl: HTMLElement;
}

export class KeyDiagnosticModal extends Modal {
  private settings: VitalLogSettings;
  private onSync: () => Promise<void>;
  private rows: ChangeRow[] = [];

  constructor(app: App, settings: VitalLogSettings, onSync: () => Promise<void>) {
    super(app);
    this.settings = settings;
    this.onSync = onSync;
  }

  onOpen(): void {
    this.modalEl.addClass('vital-log-diagnostic-modal');
    const { contentEl } = this;
    contentEl.empty();

    if (!this.settings.propertyKeySnapshot) {
      contentEl.createEl('p', {
        text: 'No key snapshot found. Reload the plugin once to initialise the baseline, then change a key and re-open this dialog.',
        cls: 'vital-log-diagnostic-empty',
      });
      return;
    }

    const changes = detectChanges(this.settings.propertyKeySnapshot, this.settings);

    if (changes.length === 0) {
      contentEl.createEl('p', {
        text: 'No key changes detected. All property keys match the last recorded snapshot.',
        cls: 'vital-log-diagnostic-empty',
      });
      const footer = contentEl.createDiv('vital-log-diagnostic-footer');
      const syncBtn = footer.createEl('button', {
        text: 'Update snapshot',
        cls: 'mod-cta',
      });
      syncBtn.addEventListener('click', () => this.syncAndClose());
      return;
    }

    contentEl.createEl('h2', { text: 'Diagnose Changed Keys' });
    contentEl.createEl('p', {
      text: `${changes.length} key change${changes.length !== 1 ? 's' : ''} detected since the last snapshot. Migrate affected notes or skip individual changes.`,
      cls: 'vital-log-diagnostic-desc',
    });

    const list = contentEl.createDiv('vital-log-diagnostic-list');

    for (const change of changes) {
      const row = this.buildChangeRow(list, change);
      this.rows.push(row);
    }

    const footer = contentEl.createDiv('vital-log-diagnostic-footer');

    const migrateAllBtn = footer.createEl('button', {
      text: 'Migrate all',
      cls: 'mod-cta vital-log-diagnostic-migrate-all',
    });
    migrateAllBtn.addEventListener('click', () => this.migrateAll(migrateAllBtn));

    const syncBtn = footer.createEl('button', {
      text: 'Mark all as synced (skip migration)',
      cls: 'vital-log-diagnostic-sync',
    });
    syncBtn.addEventListener('click', () => this.syncAndClose());

    const cancelBtn = footer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    // Kick off async vault scan for each row
    for (const row of this.rows) {
      this.scanRow(row);
    }
  }

  private buildChangeRow(container: HTMLElement, change: KeyChange): ChangeRow {
    const el = container.createDiv('vital-log-diagnostic-row');

    // Entity badge
    const badge = el.createDiv('vital-log-diagnostic-badge');
    const iconSpan = badge.createSpan({ cls: 'vital-log-diagnostic-badge-icon' });
    setIcon(iconSpan, ENTITY_ICON[change.entityType] ?? 'file');
    badge.createSpan({
      text: change.entityType,
      cls: 'vital-log-diagnostic-badge-label',
    });

    // Change description
    const info = el.createDiv('vital-log-diagnostic-info');
    const nameEl = info.createDiv({ cls: 'vital-log-diagnostic-entity-name' });
    nameEl.createSpan({ text: change.entityName });
    if (change.modalName) {
      nameEl.createSpan({ text: ` (${change.modalName})`, cls: 'vital-log-diagnostic-modal-name' });
    }

    const keyEl = info.createDiv({ cls: 'vital-log-diagnostic-keys' });

    if (change.changeType === 'propertyKey' || change.changeType === 'both') {
      const keyRow = keyEl.createDiv({ cls: 'vital-log-diagnostic-key-row' });
      keyRow.createEl('code', { text: change.oldKey, cls: 'vital-log-key-old' });
      keyRow.createSpan({ text: ' → ', cls: 'vital-log-diagnostic-arrow' });
      keyRow.createEl('code', { text: change.newKey, cls: 'vital-log-key-new' });
    }

    if (
      (change.changeType === 'valueName' || change.changeType === 'both') &&
      change.oldValueName &&
      change.newValueName
    ) {
      const subRow = keyEl.createDiv({ cls: 'vital-log-diagnostic-key-row' });
      subRow.createSpan({ text: 'entry field: ', cls: 'vital-log-diagnostic-sub-label' });
      subRow.createEl('code', { text: change.oldValueName, cls: 'vital-log-key-old' });
      subRow.createSpan({ text: ' → ', cls: 'vital-log-diagnostic-arrow' });
      subRow.createEl('code', { text: change.newValueName, cls: 'vital-log-key-new' });
    }

    // Affected count (loads async)
    const countEl = el.createDiv({ cls: 'vital-log-diagnostic-count' });
    countEl.createSpan({ text: 'Scanning…', cls: 'vital-log-diagnostic-scanning' });

    // Actions
    const actionsEl = el.createDiv({ cls: 'vital-log-diagnostic-actions' });

    const row: ChangeRow = {
      change,
      files: null,
      status: 'pending',
      el,
      countEl,
      actionsEl,
    };
    return row;
  }

  private async scanRow(row: ChangeRow): Promise<void> {
    const files = await findAffectedFiles(this.app, row.change);
    row.files = files;
    this.renderRowActions(row);
  }

  private renderRowActions(row: ChangeRow): void {
    row.countEl.empty();
    row.actionsEl.empty();

    if (row.status === 'done') {
      row.el.addClass('vital-log-diagnostic-row--done');
      const doneSpan = row.countEl.createSpan({ cls: 'vital-log-diagnostic-done-label' });
      setIcon(doneSpan, 'check');
      doneSpan.createSpan({ text: ' Migrated' });
      return;
    }

    if (row.status === 'skipped') {
      row.el.addClass('vital-log-diagnostic-row--skipped');
      row.countEl.createSpan({ text: 'Skipped', cls: 'vital-log-diagnostic-skipped-label' });
      return;
    }

    if (row.status === 'migrating') {
      row.countEl.createSpan({ text: 'Migrating…', cls: 'vital-log-diagnostic-scanning' });
      return;
    }

    // pending
    const count = row.files?.length ?? 0;
    const countBadge = row.countEl.createSpan({
      text: `${count} note${count !== 1 ? 's' : ''}`,
      cls: count > 0 ? 'vital-log-diagnostic-count-badge' : 'vital-log-diagnostic-count-zero',
    });
    if (count > 0) {
      // Add tooltip with file names on hover
      const names = row.files!.map((f) => f.path).join('\n');
      countBadge.title = names;
    }

    if (count > 0) {
      const migrateBtn = row.actionsEl.createEl('button', {
        text: 'Migrate',
        cls: 'mod-cta vital-log-diagnostic-btn',
      });
      migrateBtn.addEventListener('click', () => this.migrateRow(row));
    }

    const skipBtn = row.actionsEl.createEl('button', {
      text: 'Skip',
      cls: 'vital-log-diagnostic-btn',
    });
    skipBtn.addEventListener('click', () => {
      row.status = 'skipped';
      this.renderRowActions(row);
      this.checkAllHandled();
    });
  }

  private async migrateRow(row: ChangeRow): Promise<void> {
    if (!row.files || row.status !== 'pending') return;
    row.status = 'migrating';
    this.renderRowActions(row);

    let failed = 0;
    for (const file of row.files) {
      try {
        await migrateFileKey(this.app, file, row.change);
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      new Notice(`Vital Log: ${failed} file(s) could not be migrated. Check console for details.`);
    }

    row.status = 'done';
    this.renderRowActions(row);
    this.checkAllHandled();
  }

  private async migrateAll(btn: HTMLElement): Promise<void> {
    btn.setAttribute('disabled', 'true');
    const pending = this.rows.filter((r) => r.status === 'pending');
    for (const row of pending) {
      if (row.files === null) {
        // Still scanning; wait for it
        row.files = await findAffectedFiles(this.app, row.change);
      }
      await this.migrateRow(row);
    }
    btn.removeAttribute('disabled');
  }

  private checkAllHandled(): void {
    const allDone = this.rows.every((r) => r.status === 'done' || r.status === 'skipped');
    if (allDone) {
      this.syncAndClose();
    }
  }

  private async syncAndClose(): Promise<void> {
    await this.onSync();
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
