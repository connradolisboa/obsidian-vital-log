// ============================================================
// Vital Log — Day history loader
// Builds DayLogs for a run of past daily notes from the metadata
// cache, for the day view's compare line, heatmap, and insights.
// The cache is in memory, so even a 30-day window is cheap.
// ============================================================

import type { App } from 'obsidian';
import type { VitalLogSettings } from './types';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import { collectDayLog, type DayLog } from './dayLog';

export interface HistoryDay {
  date: Date;
  log: DayLog | null; // null when there's no note for that day
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
  const days: HistoryDay[] = [];
  const offset = includeEnd ? 0 : 1;
  for (let i = count - 1 + offset; i >= offset; i--) {
    const date = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - i);
    const file = getDailyNoteIfExists(app, settings, date);
    const fm = file ? app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    days.push({ date, log: fm ? collectDayLog(fm as Record<string, unknown>, settings) : null });
  }
  return days;
}

/** Only the days that have a note. */
export function loggedDays(history: HistoryDay[]): DayLog[] {
  return history.map((d) => d.log).filter((l): l is DayLog => l !== null);
}
