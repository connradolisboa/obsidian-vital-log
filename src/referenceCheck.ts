// ============================================================
// Vital Log — Reference Check
// Finds (and removes) dangling references in the library and schedule:
// pack/stack items pointing at deleted vitamins or packs, and schedule
// entries pointing at deleted vitamins/packs/stacks/tallies.
// ============================================================

import type { VitalLogSettings } from './types';

export interface StaleReference {
  /** Human-readable description of the broken reference. */
  description: string;
}

function vitaminExists(settings: VitalLogSettings, id: string): boolean {
  return settings.vitamins.some((v) => v.id === id);
}
function packExists(settings: VitalLogSettings, id: string): boolean {
  return settings.packs.some((p) => p.id === id);
}
function stackExists(settings: VitalLogSettings, id: string): boolean {
  return settings.stacks.some((s) => s.id === id);
}
function tallyExists(settings: VitalLogSettings, id: string): boolean {
  return settings.metrics.some((m) => m.trackerType === 'tally' && m.id === id);
}

/** Scan the library and schedule for dangling references. Read-only. */
export function findStaleReferences(settings: VitalLogSettings): StaleReference[] {
  const stale: StaleReference[] = [];

  for (const pack of settings.packs) {
    const missing = pack.items.filter((i) => !vitaminExists(settings, i.vitaminId)).length;
    if (missing > 0) {
      stale.push({ description: `Pack "${pack.displayName}" references ${missing} deleted vitamin(s).` });
    }
  }

  for (const stack of settings.stacks) {
    const missing = stack.items.filter((i) =>
      i.type === 'vitamin' ? !vitaminExists(settings, i.vitaminId) : !packExists(settings, i.packId)
    ).length;
    if (missing > 0) {
      stale.push({ description: `Stack "${stack.displayName}" references ${missing} deleted item(s).` });
    }
  }

  for (const item of settings.plannedLogs.schedule) {
    const exists =
      item.kind === 'vitamin' ? vitaminExists(settings, item.refId)
      : item.kind === 'pack' ? packExists(settings, item.refId)
      : item.kind === 'stack' ? stackExists(settings, item.refId)
      : tallyExists(settings, item.refId);
    if (!exists) {
      stale.push({ description: `Schedule has a ${item.kind} entry pointing at a deleted item.` });
    }
  }

  return stale;
}

/**
 * Remove every dangling reference found by findStaleReferences.
 * Mutates settings in place. Returns the number of broken references removed.
 */
export function removeStaleReferences(settings: VitalLogSettings): number {
  let removed = 0;

  for (const pack of settings.packs) {
    const before = pack.items.length;
    pack.items = pack.items.filter((i) => vitaminExists(settings, i.vitaminId));
    removed += before - pack.items.length;
  }

  for (const stack of settings.stacks) {
    const before = stack.items.length;
    stack.items = stack.items.filter((i) =>
      i.type === 'vitamin' ? vitaminExists(settings, i.vitaminId) : packExists(settings, i.packId)
    );
    removed += before - stack.items.length;
  }

  const before = settings.plannedLogs.schedule.length;
  settings.plannedLogs.schedule = settings.plannedLogs.schedule.filter((item) =>
    item.kind === 'vitamin' ? vitaminExists(settings, item.refId)
    : item.kind === 'pack' ? packExists(settings, item.refId)
    : item.kind === 'stack' ? stackExists(settings, item.refId)
    : tallyExists(settings, item.refId)
  );
  removed += before - settings.plannedLogs.schedule.length;

  return removed;
}
