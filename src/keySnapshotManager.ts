// ============================================================
// Vital Log — Key Snapshot Manager
// Tracks property key renames across trackers, tallies,
// vitamins, and custom fields so stale frontmatter can be
// found and migrated when keys change.
// ============================================================

import { App, TFile } from 'obsidian';
import type { VitalLogSettings, PropertyKeySnapshot, SnapshotRecord } from './types';
import {
  readAllFrontmatter,
  renameTopLevelKey,
  renameEntrySubKey,
  renameKeyIn,
  renameEntrySubKeyIn,
  mutateFrontmatter,
} from './yamlManager';

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

// ── reconcileSnapshot ────────────────────────────────────────

/**
 * Bring the snapshot in line with the entities that exist right now, without
 * losing the keys it already recorded.
 *
 * Entities created since the snapshot are baselined at their current keys, and
 * entities that were deleted are dropped. Everything else keeps the keys the
 * snapshot recorded, so a later rename is still detected as a change.
 *
 * This runs on every settings save. Before it existed the snapshot was only
 * refreshed from the diagnostic dialog, so anything created after the last
 * visit there had no baseline at all and renaming it looked like nothing had
 * happened.
 */
export function reconcileSnapshot(
  snapshot: PropertyKeySnapshot | undefined,
  settings: VitalLogSettings
): { snapshot: PropertyKeySnapshot; changed: boolean } {
  const current = buildSnapshot(settings);
  if (!snapshot) return { snapshot: current, changed: true };

  const known = new Map<string, SnapshotRecord>();
  for (const r of snapshot.records) known.set(r.id, r);

  const records: SnapshotRecord[] = [];
  for (const cur of current.records) {
    const prev = known.get(cur.id);
    if (!prev) {
      records.push(cur);
      continue;
    }
    known.delete(cur.id);
    // Recorded keys are the baseline and must survive; the rest is display
    // metadata the diagnostic dialog shows, so it tracks settings.
    records.push({
      ...prev,
      entityType: cur.entityType,
      entityName: cur.entityName,
      modalId: cur.modalId,
      modalName: cur.modalName,
    });
  }

  const next: PropertyKeySnapshot = { records, capturedAt: snapshot.capturedAt };
  const changed = JSON.stringify(next.records) !== JSON.stringify(snapshot.records);
  return { snapshot: next, changed };
}

// ── changeSignature ──────────────────────────────────────────

/** Stable identity for one detected change, for de-duplicating prompts. */
export function changeSignature(change: KeyChange): string {
  return [
    change.entityId,
    `${change.oldKey}>${change.newKey}`,
    `${change.oldValueName ?? ''}>${change.newValueName ?? ''}`,
  ].join('|');
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
    if (frontmatterUsesOldKey(fm, change)) affected.push(file);
  }

  return affected;
}

// ── changeAffectsVault ───────────────────────────────────────

/**
 * Whether any note still writes the old key, answered from the metadata cache
 * alone. findAffectedFiles reads every note off disk, which is far too heavy to
 * run on a settings save; this is the in-memory screen that decides whether a
 * rename is worth interrupting the user over.
 */
export function changeAffectsVault(app: App, change: KeyChange): boolean {
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (fm && frontmatterUsesOldKey(fm as Record<string, unknown>, change)) return true;
  }
  return false;
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
    // Rename the top-level key, then the sub-keys under its new location — in a
    // single write, so an interrupted migration can't leave the key moved but
    // its entries still using the old sub-key names.
    const { oldKey, newKey, oldValueName, newValueName } = change;
    await mutateFrontmatter(app, file, (fm) => {
      renameKeyIn(fm, oldKey, newKey);
      renameEntrySubKeyIn(fm, newKey, oldValueName, newValueName);
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────

/** Does this frontmatter still carry the pre-rename key (or sub-key)? */
function frontmatterUsesOldKey(fm: Record<string, unknown>, change: KeyChange): boolean {
  if (change.changeType === 'valueName' && change.oldValueName) {
    // Sub-key change: check entries under the *old* top-level key
    const entries = fm[change.oldKey];
    return (
      Array.isArray(entries) &&
      entries.some(
        (e: unknown) =>
          typeof e === 'object' &&
          e !== null &&
          change.oldValueName! in (e as Record<string, unknown>)
      )
    );
  }
  // Top-level key change (including 'both')
  return hasNestedKey(fm, change.oldKey);
}

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
