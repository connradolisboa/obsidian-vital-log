// ============================================================
// Vital Log — Day history loader
// Builds DayLogs for a run of past daily notes from the metadata
// cache, for the day view's compare line, heatmap, and insights.
// The cache is in memory, so even a 30-day window is cheap.
//
// Symptoms that span days need the days before the range too: each
// day's log is built with whatever was still active coming into it.
// ============================================================

import type { App } from 'obsidian';
import type { SymptomEntry, VitalLogSettings } from './types';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import { collectDayLog, type DayLog } from './dayLog';
import { ACTIVE_WINDOW_DAYS, activeAfter, readSymptomEntries } from './symptomManager';
import { toISODate } from './planManager';
import { getManagementApi } from './managementTracker';

type Fm = Record<string, unknown>;

export interface HistoryDay {
  date: Date;
  log: DayLog | null; // null when there's no note for that day
}

function dayFrontmatter(app: App, settings: VitalLogSettings, date: Date): Fm | null {
  const file = getDailyNoteIfExists(app, settings, date);
  const fm = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
  return fm ? (fm as Fm) : null;
}

function shift(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
}

/**
 * Symptoms still active coming into `date`: the latest reading of each
 * symptom over the window before it, kept when above 0.
 */
export function symptomsCarriedInto(
  app: App,
  settings: VitalLogSettings,
  date: Date
): Map<string, { name: string; severity: number; sinceISO: string; sinceTime: string }> {
  const days: { iso: string; entries: SymptomEntry[] }[] = [];
  for (let i = ACTIVE_WINDOW_DAYS; i >= 1; i--) {
    const d = shift(date, -i);
    const fm = dayFrontmatter(app, settings, d);
    if (fm) days.push({ iso: toISODate(d), entries: readSymptomEntries(fm, settings) });
  }
  return activeAfter(days);
}

/**
 * The `count` days ending on `endDate` (inclusive), oldest first.
 * Pass `includeEnd: false` for the days before it only.
 */
export function loadHistory(
  app: App,
  settings: VitalLogSettings,
  endDate: Date,
  count: number,
  includeEnd = true
): HistoryDay[] {
  // Normalise to midday so the day-by-day loop below never drops the last day.
  const last = shift(endDate, includeEnd ? 0 : -1);
  const first = shift(last, -(count - 1));

  // Read the range plus the look-back window once, oldest first.
  const span: { date: Date; fm: Fm | null; entries: SymptomEntry[] }[] = [];
  for (let d = shift(first, -ACTIVE_WINDOW_DAYS); d <= last; d = shift(d, 1)) {
    const fm = dayFrontmatter(app, settings, d);
    span.push({ date: d, fm, entries: fm ? readSymptomEntries(fm, settings) : [] });
  }

  const days: HistoryDay[] = [];
  for (let i = ACTIVE_WINDOW_DAYS; i < span.length; i++) {
    const { date, fm } = span[i];
    const window = span
      .slice(i - ACTIVE_WINDOW_DAYS, i)
      .map((s) => ({ iso: toISODate(s.date), entries: s.entries }));
    days.push({ date, log: fm ? collectDayLog(fm, settings, activeAfter(window)) : null });
  }
  return days;
}

/** Only the days that have a note. */
export function loggedDays(history: HistoryDay[]): DayLog[] {
  return history.map((d) => d.log).filter((l): l is DayLog => l !== null);
}

/**
 * Symptoms active as of the end of `date`'s readings: the look-back window
 * plus the day itself. Used by the log modal's "Active now" list.
 */
export function symptomsActiveOn(
  app: App,
  settings: VitalLogSettings,
  date: Date
): Map<string, { name: string; severity: number; sinceISO: string; sinceTime: string }> {
  const days: { iso: string; entries: SymptomEntry[] }[] = [];
  for (let i = ACTIVE_WINDOW_DAYS; i >= 0; i--) {
    const d = shift(date, -i);
    const fm = dayFrontmatter(app, settings, d);
    if (fm) days.push({ iso: toISODate(d), entries: readSymptomEntries(fm, settings) });
  }
  return activeAfter(days);
}

/**
 * Add Management Tracker's sessions for `date` to a day's log, when that
 * plugin's API is available. The viewer and the public API both go through
 * here, so they always show the same items.
 */
export function attachSessions(app: App, log: DayLog, date: Date): void {
  const mt = getManagementApi(app);
  if (!mt) return;
  try {
    log.sessions = mt.sessionsOn(toISODate(date));
  } catch (err) {
    console.error('Vital Log: Management Tracker sessionsOn failed', err);
  }
}

/**
 * One day's log as the day viewer builds it — the note's entries, symptoms
 * carried in from earlier days, and Time Tracker sessions — read from the
 * metadata cache. Null when the day has no note.
 */
export function dayLogFor(app: App, settings: VitalLogSettings, date: Date): DayLog | null {
  const fm = dayFrontmatter(app, settings, date);
  if (!fm) return null;
  const log = collectDayLog(fm, settings, symptomsCarriedInto(app, settings, date));
  attachSessions(app, log, date);
  return log;
}
