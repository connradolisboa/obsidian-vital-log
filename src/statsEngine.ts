// ============================================================
// Vital Log — Stats engine
//
// Reads logged data from daily notes and aggregates it for the
// dashboard. Frontmatter extraction is split from pure computation so
// a single day's frontmatter can be read once and reused across many
// trackers (and across a date range).
// ============================================================

import type { App, TFile } from 'obsidian';
import type {
  VitalLogSettings,
  TrackerConfig,
  TrackerGoalPlan,
  StatType,
  ScheduleItem,
} from './types';
import { isTrackerEntry, defaultPrimaryStat, scalarMetrics } from './types';
import { getNoteIfExists } from './dailyNoteResolver';
import { readAllFrontmatter } from './yamlManager';
import { fromISODate, resolveGoal, shiftDaysISO, todayISO } from './planManager';

type Fm = Record<string, unknown>;

// ── Frontmatter access ──────────────────────────────────────

/** The daily note's frontmatter for `date`, or null if the note doesn't exist. */
export async function getFrontmatterForDate(
  app: App,
  settings: VitalLogSettings,
  date: Date
): Promise<Fm | null> {
  const file = getNoteIfExists(app, settings.dailyNotePath, date);
  if (!file) return null;
  return readAllFrontmatter(app, file as TFile);
}

// ── Tracker value extraction + aggregation (pure) ───────────

/** All numeric values logged for a tracker, in entry order. */
export function extractTrackerValues(fm: Fm | null, tracker: TrackerConfig): number[] {
  if (!fm) return [];
  const raw = fm[tracker.propertyKey];
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const entry of raw) {
    if (isTrackerEntry(entry, tracker.valueName)) {
      const v = entry[tracker.valueName];
      if (typeof v === 'number') out.push(v);
    }
  }
  return out;
}

const ROUND = (n: number) => Math.round(n * 100) / 100;

/** Aggregate a list of values by stat. Returns null for an empty list. */
export function computeStat(values: number[], stat: StatType): number | null {
  if (values.length === 0) return null;
  switch (stat) {
    case 'sum':
      return ROUND(values.reduce((a, b) => a + b, 0));
    case 'average':
      return ROUND(values.reduce((a, b) => a + b, 0) / values.length);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'count':
      return values.length;
    case 'latest':
      return values[values.length - 1];
  }
}

export function trackerPrimaryStat(tracker: TrackerConfig): StatType {
  return tracker.primaryStat ?? defaultPrimaryStat(tracker.trackerType);
}

// ── Tally + supplement status ───────────────────────────────

export function readTallyValue(fm: Fm | null, propertyKey: string): number {
  if (!fm) return 0;
  const val = fm[propertyKey];
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const v = (val as Record<string, unknown>)['value'];
    return typeof v === 'number' ? v : 0;
  }
  return 0;
}

function listHasNamedEntry(fm: Fm, key: string, name: string): boolean {
  const arr = fm[key];
  if (!Array.isArray(arr)) return false;
  return arr.some(
    (e) => typeof e === 'object' && e !== null && (e as Record<string, unknown>)['name'] === name
  );
}

/** Whether a scheduled supplement/tally has been logged on the given day. */
export function isScheduleItemDone(
  fm: Fm | null,
  settings: VitalLogSettings,
  item: ScheduleItem
): boolean {
  if (!fm) return false;
  switch (item.kind) {
    case 'vitamin': {
      const v = settings.vitamins.find((x) => x.id === item.refId);
      if (!v) return false;
      if (settings.logMode === 'substances') {
        return listHasNamedEntry(fm, 'substances', v.displayName);
      }
      const arr = fm[v.propertyKey];
      return Array.isArray(arr) && arr.length > 0;
    }
    case 'pack': {
      const p = settings.packs.find((x) => x.id === item.refId);
      return p ? listHasNamedEntry(fm, 'packs', p.displayName) : false;
    }
    case 'stack': {
      const s = settings.stacks.find((x) => x.id === item.refId);
      return s ? listHasNamedEntry(fm, 'stacks', s.displayName) : false;
    }
    case 'tally': {
      const t = scalarMetrics(settings).find((x) => x.id === item.refId);
      if (!t) return false;
      const value = readTallyValue(fm, t.propertyKey);
      return t.target > 0 ? value >= t.target : value > 0;
    }
  }
}

// ── Range series (for sparklines) ───────────────────────────

export interface SeriesPoint {
  date: string; // ISO
  value: number | null; // null = no data that day
}

/**
 * One aggregated point per day across [startISO, endISO] for a tracker,
 * using its primary stat. Reads each day's frontmatter once.
 */
export async function collectSeriesForRange(
  app: App,
  settings: VitalLogSettings,
  tracker: TrackerConfig,
  isoDates: string[]
): Promise<SeriesPoint[]> {
  const stat = trackerPrimaryStat(tracker);
  const out: SeriesPoint[] = [];
  for (const iso of isoDates) {
    const fm = await getFrontmatterForDate(app, settings, fromISODate(iso));
    const values = extractTrackerValues(fm, tracker);
    out.push({ date: iso, value: computeStat(values, stat) });
  }
  return out;
}

// ── Goal streaks ────────────────────────────────────────────

const MAX_STREAK_LOOKBACK = 366;

/**
 * Count consecutive days (ending at `endISO`) where the tracker met its goal,
 * using the goal in effect on each day. An unfinished *today* doesn't reset
 * the streak — it counts from yesterday instead. Stops at the first miss, or
 * once no goal was defined that far back.
 */
export async function computeGoalStreak(
  app: App,
  settings: VitalLogSettings,
  tracker: TrackerConfig,
  plan: TrackerGoalPlan,
  endISO: string
): Promise<number> {
  const stat = trackerPrimaryStat(tracker);

  const isMet = async (iso: string): Promise<boolean | null> => {
    const goal = resolveGoal(plan, iso);
    if (goal === null || goal <= 0) return null; // no goal in effect → stop
    const fm = await getFrontmatterForDate(app, settings, fromISODate(iso));
    const value = computeStat(extractTrackerValues(fm, tracker), stat);
    if (value === null) return false;
    return value >= goal;
  };

  let cursor = endISO;
  if (endISO === todayISO()) {
    const metToday = await isMet(endISO);
    if (metToday !== true) cursor = shiftDaysISO(endISO, -1);
  }

  let streak = 0;
  for (let i = 0; i < MAX_STREAK_LOOKBACK; i++) {
    const met = await isMet(cursor);
    if (met !== true) break;
    streak++;
    cursor = shiftDaysISO(cursor, -1);
  }
  return streak;
}
