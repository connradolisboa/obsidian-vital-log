// ============================================================
// Vital Log — When a day ends
//
// A day can end after midnight: with 03:00, a log at 01:30 still goes
// to the day before's note. Management Tracker owns the setting when it
// is on and shares it (its API version 2+); otherwise Vital Log's own
// setting applies. Entries keep their real clock time — only the day
// they belong to moves — and a day's lists put late-night times last.
// ============================================================

import type { App } from 'obsidian';
import { getManagementApi } from './managementTracker';

let appRef: App | null = null;
let ownSetting: () => string = () => '00:00';

/** Call once on load: where to find Management Tracker, and Vital Log's own setting. */
export function initDayBoundary(app: App, own: () => string): void {
  appRef = app;
  ownSetting = own;
}

/** `03:00` → 180. Midnight, blank or unreadable → 0; afternoons are not a day end. */
export function parseDayEnd(hhmm: string | null | undefined): number {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(hhmm ?? '');
  if (!m) return 0;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && minutes < 12 * 60 ? minutes : 0;
}

/** Management Tracker's day end, when it is on and shares one; otherwise null. */
export function sharedDayEnd(): string | null {
  if (!appRef) return null;
  const api = getManagementApi(appRef);
  if (!api || api.version < 2 || typeof api.dayEndsAt !== 'function') return null;
  try {
    return api.dayEndsAt();
  } catch {
    return null;
  }
}

/** The day end in force, `HH:mm`. */
export function dayEndsAt(): string {
  return sharedDayEnd() ?? (ownSetting() || '00:00');
}

/** Minutes after midnight when a day ends; 0 for midnight. */
export function dayEndMinutes(): number {
  return parseDayEnd(dayEndsAt());
}

/** `YYYY-MM-DD` of a Date's local calendar day. */
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The day a moment counts for, as a Date at the same clock time: before
 * the day end it falls on the day before. Use it to pick a note, never
 * for an entry's time.
 */
export function logicalDay(now: Date = new Date(), end: number = dayEndMinutes()): Date {
  const out = new Date(now.getTime());
  if (end > 0 && now.getHours() * 60 + now.getMinutes() < end) out.setDate(out.getDate() - 1);
  return out;
}

/** Today as the user counts days, `YYYY-MM-DD`. */
export function logicalTodayISO(now: Date = new Date(), end: number = dayEndMinutes()): string {
  return isoOf(logicalDay(now, end));
}

/** Is `HH:mm` before the day end, so it happened the night after its note's date? */
export function isLateNight(time: string | null | undefined, end: number = dayEndMinutes()): boolean {
  if (!time || end <= 0) return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  return !!m && Number(m[1]) * 60 + Number(m[2]) < end;
}

/** Minutes for placing a time on a day: late-night times come after 24:00. */
export function dayMinutes(minutes: number, end: number = dayEndMinutes()): number {
  return end > 0 && minutes < end ? minutes + 24 * 60 : minutes;
}
