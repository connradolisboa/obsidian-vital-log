// ============================================================
// Vital Log — Key Snapshot Manager
// Tracks property key renames across trackers, tallies,
// vitamins, and custom fields so stale frontmatter can be
// found and migrated when keys change.
// ============================================================

import { App, TFile } from 'obsidian';
import type { VitalLogSettings, PropertyKeySnapshot, SnapshotRecord } from './types';
import { readAllFrontmatter, renameTopLevelKey, renameEntrySubKey } from './yamlManager';

// ── Public types ─────────────────────────────────────────────

export type ChangeType = 'propertyKey' | 'valueName' | 'both';

export interface KeyChange {
  entityId: string;
  entityType: 'tracker' | 'tally' | 'checkbox' | 'vitamin' | 'customField';
  entityName: string;
  changeType: ChangeType;
  oldKey: string;       // full dot-path for the top-level key (e.g. "health.bp")
  newKey: string;
  // For trackers only (sub-key within entries):
  oldValueName?: string;
  newValueName?: string;
  // For display:
  modalName?: string;
}

// ── buildSnapshot ────────────────────────────────────────────

export function buildSnapshot(settings: VitalLogSettings): PropertyKeySnapshot {
  const records: SnapshotRecord[] = [];

  for (const m of settings.metrics) {
    records.push({
      id: m.id,
      entityType: m.trackerType === 'tally' ? 'tally' : m.trackerType === 'checkbox' ? 'checkbox' : 'tracker',
      entityName: m.displayName,
      propertyKey: m.propertyKey,
      // valueName (the sub-key inside each entry) only applies to series metrics.
      valueName: (m.trackerType === 'tally' || m.trackerType === 'checkbox') ? undefined : m.valueName,
    });
  }

  for (const v of settings.vitamins) {
    records.push({
      id: v.id,
      entityType: 'vitamin',
      entityName: v.displayName,
      propertyKey: v.propertyKey,
    });
  }

  for (const modal of settings.customModals) {
    for (const item of modal.items) {
      if (item.type !== 'field') continue;
      records.push({
        id: `${modal.id}:${item.field.id}`,
        entityType: 'customField',
        entityName: item.field.displayName,
        propertyKey: item.field.propertyKey,
        parentKey: item.field.parentKey,
        modalId: modal.id,
        modalName: modal.displayName,
      });
    }
  }

  return { records, capturedAt: new Date().toISOString() };
}

// ── detectChanges ────────────────────────────────────────────

export function detectChanges(
  snapshot: PropertyKeySnapshot,
  settings: VitalLogSettings
): KeyChange[] {
  const current = buildSnapshot(settings);
  const currentMap = new Map<string, SnapshotRecord>();
  for (const r of current.records) currentMap.set(r.id, r);

  const changes: KeyChange[] = [];

  for (const old of snapshot.records) {
    const cur = currentMap.get(old.id);
    if (!cur) continue; // entity deleted — nothing to migrate

    const oldPath = old.parentKey ? `${old.parentKey}.${old.propertyKey}` : old.propertyKey;
    const newPath = cur.parentKey ? `${cur.parentKey}.${cur.propertyKey}` : cur.propertyKey;
    const keyChanged = oldPath !== newPath;
    const valueNameChanged =
      old.valueName !== undefined &&
      cur.valueName !== undefined &&
      old.valueName !== cur.valueName;

    if (!keyChanged && !valueNameChanged) continue;

    changes.push({
      entityId: old.id,
      entityType: old.entityType,
      entityName: cur.entityName,
      changeType: keyChanged && valueNameChanged ? 'both' : keyChanged ? 'propertyKey' : 'valueName',
      oldKey: oldPath,
      newKey: newPath,
      oldValueName: old.valueName,
      newValueName: cur.valueName,
      modalName: cur.modalName,
    });
  }

  return changes;
}

// ── findAffectedFiles ────────────────────────────────────────

export async function findAffectedFiles(
  app: App,
  change: KeyChange
): Promise<TFile[]> {
  const files = app.vault.getMarkdownFiles();
  const affected: TFile[] = [];

  for (const file of files) {
    const fm = await readAllFrontmatter(app, file);

    if (change.changeType === 'valueName' && change.oldValueName) {
      // Sub-key change: check entries under the *old* top-level key
      const entries = fm[change.oldKey];
      if (
        Array.isArray(entries) &&
        entries.some(
          (e: unknown) =>
            typeof e === 'object' &&
            e !== null &&
            change.oldValueName! in (e as Record<string, unknown>)
        )
      ) {
        affected.push(file);
      }
    } else {
      // Top-level key change (including 'both')
      if (hasNestedKey(fm, change.oldKey)) {
        affected.push(file);
      }
    }
  }

  return affected;
}

// ── migrateFileKey ───────────────────────────────────────────

export async function migrateFileKey(
  app: App,
  file: TFile,
  change: KeyChange
): Promise<void> {
  if (change.changeType === 'propertyKey') {
    await renameTopLevelKey(app, file, change.oldKey, change.newKey);
  } else if (change.changeType === 'valueName' && change.oldValueName && change.newValueName) {
    // Only sub-key rename: propertyKey hasn't changed so oldKey === newKey (both equal the current key)
    await renameEntrySubKey(app, file, change.newKey, change.oldValueName, change.newValueName);
  } else if (change.changeType === 'both' && change.oldValueName && change.newValueName) {
    // First rename the top-level key, then rename sub-keys under the new location
    await renameTopLevelKey(app, file, change.oldKey, change.newKey);
    await renameEntrySubKey(app, file, change.newKey, change.oldValueName, change.newValueName);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function hasNestedKey(fm: Record<string, unknown>, dotPath: string): boolean {
  const parts = dotPath.split('.');
  let cur: unknown = fm;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null || !(part in (cur as Record<string, unknown>))) {
      return false;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}
