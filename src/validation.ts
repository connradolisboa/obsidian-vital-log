// ============================================================
// Vital Log — Validation helpers
// Shared property-key validation used by the manage modal and settings,
// so the rules live in one place instead of being re-implemented per form.
// ============================================================

import type { VitalLogSettings } from './types';

export interface KeyOwner {
  id: string;
  key: string;
  label: string;
}

/** Validate the *format* of a frontmatter property key. Returns an error string or null. */
export function validateKeyFormat(key: string): string | null {
  if (!key) return 'Property key cannot be empty.';
  if (/\s/.test(key)) return 'Property key must not contain spaces.';
  if (!/^[a-zA-Z0-9_]+$/.test(key)) {
    return 'Property key may only contain letters, numbers, and underscores.';
  }
  return null;
}

/** Find the first owner (other than excludeId) whose key collides. */
export function findKeyCollision(
  key: string,
  owners: KeyOwner[],
  excludeId?: string
): KeyOwner | null {
  return owners.find((o) => o.key === key && o.id !== excludeId) ?? null;
}

/** Format + collision check in one call. Returns an error string or null. */
export function validatePropertyKey(
  key: string,
  owners: KeyOwner[],
  excludeId?: string
): string | null {
  const formatError = validateKeyFormat(key);
  if (formatError) return formatError;
  const collision = findKeyCollision(key, owners, excludeId);
  if (collision) return `Property key "${key}" is already used by "${collision.label}".`;
  return null;
}

/**
 * Every frontmatter property key claimed across the library and config —
 * vitamins, trackers, and tally counters all write into the same daily-note
 * frontmatter, so a key shared between them would clobber data.
 */
export function allKeyOwners(settings: VitalLogSettings): KeyOwner[] {
  const owners: KeyOwner[] = [];
  for (const v of settings.vitamins) owners.push({ id: v.id, key: v.propertyKey, label: v.displayName });
  for (const t of settings.trackers) owners.push({ id: t.id, key: t.propertyKey, label: t.displayName });
  for (const t of settings.tallyCounters) owners.push({ id: t.id, key: t.propertyKey, label: t.displayName });
  return owners;
}
