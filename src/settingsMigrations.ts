// ============================================================
// Vital Log — Settings schema versioning, migration, and validation
//
// data.json accumulates a user's whole configuration, so loading it needs to
// be forgiving of old shapes and defensive about damaged ones. Two rules:
//
//   1. Migrations are numbered and run in order, so upgrading from any older
//      version reaches the current shape by the same path.
//   2. Validation repairs field by field. A single bad value costs the user
//      that value, never the rest of their configuration.
// ============================================================

import type { VitalLogSettings, CustomField } from './types';
import { DEFAULT_SETTINGS, metricFromLegacyTracker, metricFromLegacyTally } from './types';

/** Bump when a migration is added below. */
export const CURRENT_SCHEMA_VERSION = 2;

type Raw = Record<string, unknown>;

interface Migration {
  /** Schema version this migration produces. */
  to: number;
  /** Shown in the console when the migration runs. */
  description: string;
  apply: (raw: Raw) => void;
}

/**
 * Ordered migrations. Each takes the raw object from the previous version to
 * the next; none may assume the data is otherwise valid, since validation runs
 * afterwards.
 */
const MIGRATIONS: Migration[] = [
  {
    to: 1,
    description: 'legacy trackers[] + tallyCounters[] → unified metrics[]',
    apply: (raw) => {
      // Config-only. Daily-note frontmatter is untouched: a series metric still
      // reads and writes its list, a scalar metric its {value} object.
      const hasLegacy = 'trackers' in raw || 'tallyCounters' in raw;
      const hasMetrics = Array.isArray(raw['metrics']);
      if (hasLegacy && !hasMetrics) {
        const trackers = Array.isArray(raw['trackers']) ? (raw['trackers'] as Raw[]) : [];
        const tallies = Array.isArray(raw['tallyCounters']) ? (raw['tallyCounters'] as Raw[]) : [];
        raw['metrics'] = [
          ...trackers.map(metricFromLegacyTracker),
          ...tallies.map(metricFromLegacyTally),
        ];
      }
      // Drop the legacy arrays either way so they can't shadow `metrics` later.
      delete raw['trackers'];
      delete raw['tallyCounters'];
    },
  },
  {
    to: 2,
    description: 'CustomModalConfig.fields[] → items[]',
    apply: (raw) => {
      const modals = raw['customModals'];
      if (!Array.isArray(modals)) return;
      for (const modal of modals) {
        if (typeof modal !== 'object' || modal === null) continue;
        const m = modal as Raw;
        if ('fields' in m && !('items' in m)) {
          const fields = (m['fields'] as CustomField[]) ?? [];
          m['items'] = fields.map((f) => ({ type: 'field', field: f }));
          delete m['fields'];
        }
      }
    },
  },
];

export interface MigrationResult {
  settings: VitalLogSettings;
  /** True when the on-disk data differed from the result and should be saved. */
  changed: boolean;
  /** Human-readable notes about migrations applied and fields repaired. */
  notes: string[];
}

/**
 * Bring stored settings up to the current schema and validate every field.
 * Never throws: unusable input yields defaults rather than a failed load.
 */
export function migrateSettings(stored: unknown): MigrationResult {
  const notes: string[] = [];

  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {
      settings: cloneDefaults(),
      changed: stored !== null && stored !== undefined,
      notes: stored == null ? [] : ['data.json was not an object — starting from defaults.'],
    };
  }

  const raw: Raw = { ...(stored as Raw) };

  // Data written before versioning existed is treated as version 0.
  const storedVersion = typeof raw['schemaVersion'] === 'number' ? raw['schemaVersion'] : 0;

  for (const migration of MIGRATIONS) {
    if (migration.to <= storedVersion) continue;
    try {
      migration.apply(raw);
      notes.push(`Migrated to schema v${migration.to}: ${migration.description}`);
    } catch (err) {
      notes.push(`Migration to v${migration.to} failed: ${String(err)}`);
    }
  }

  const settings = validateSettings(raw, notes);
  settings.schemaVersion = CURRENT_SCHEMA_VERSION;

  const changed = storedVersion !== CURRENT_SCHEMA_VERSION || notes.length > 0;
  return { settings, changed, notes };
}

/**
 * Coerce a raw object into VitalLogSettings, replacing any field whose type
 * doesn't match the default with the default. Repairs are recorded in `notes`.
 */
export function validateSettings(raw: Raw, notes: string[] = []): VitalLogSettings {
  const out = cloneDefaults();

  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof VitalLogSettings)[]) {
    if (key === 'schemaVersion') continue;
    if (!(key in raw)) continue;

    const value = raw[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (value === undefined) continue;

    if (matchesShapeOf(value, fallback)) {
      (out as unknown as Raw)[key] = value;
    } else {
      notes.push(`Setting "${String(key)}" had an unexpected type and was reset to its default.`);
    }
  }

  // Optional fields absent from DEFAULT_SETTINGS, carried through when sane.
  if (Array.isArray(raw['mirrorExcludedKeys'])) {
    out.mirrorExcludedKeys = raw['mirrorExcludedKeys'] as string[];
  }
  if (typeof raw['propertyKeySnapshot'] === 'object' && raw['propertyKeySnapshot'] !== null) {
    out.propertyKeySnapshot = raw['propertyKeySnapshot'] as VitalLogSettings['propertyKeySnapshot'];
  }

  // plannedLogs needs its own arrays rather than the shared default reference,
  // or edits would leak across loads.
  const planned = out.plannedLogs as VitalLogSettings['plannedLogs'] | undefined;
  out.plannedLogs = {
    trackerGoals: Array.isArray(planned?.trackerGoals) ? planned!.trackerGoals : [],
    schedule: Array.isArray(planned?.schedule) ? planned!.schedule : [],
  };

  // Legacy arrays never survive validation.
  delete (out as unknown as Raw)['trackers'];
  delete (out as unknown as Raw)['tallyCounters'];

  return out;
}

/** A structural check good enough for config: array vs plain object vs primitive. */
function matchesShapeOf(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (fallback === null) return true;
  if (typeof fallback === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  return typeof value === typeof fallback;
}

function cloneDefaults(): VitalLogSettings {
  // Deep clone so nested defaults (metrics, plannedLogs) are never shared.
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as VitalLogSettings;
}
