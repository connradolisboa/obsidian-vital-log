// ============================================================
// Vital Log — Symptom history stats
// Pure helpers over a run of days (oldest first, with gaps as null):
// multi-day episodes, a per-symptom calendar, weekly totals, and
// what tends to come the day before a symptom begins.
// ============================================================

import type { DayLog } from './dayLog';
import { minutesOf } from './dayChart';
import { MIN_DAYS_PER_SIDE } from './dayStats';

export interface Day {
  date: Date;
  log: DayLog | null;
}

const key = (name: string): string => name.trim().toLowerCase();

// ── Episodes ─────────────────────────────────────────────────

export interface SymptomEpisode {
  name: string;
  startDate: Date;
  /** Null when it began before the range (or untimed). */
  startTime: string | null;
  /** Null while still active at the end of the range. */
  endDate: Date | null;
  endTime: string | null;
  /** Days in the range it was active on (days without a note are skipped). */
  days: number;
  peak: number;
  /** Peak per active day, oldest first — the episode's curve. */
  dailyPeaks: number[];
  /** True when it was already active on the first day of the range. */
  startedBefore: boolean;
}

/**
 * Group each symptom's days into episodes: an episode runs from the day it
 * began until the day it was marked gone, across days via carry-over.
 */
export function symptomEpisodes(days: Day[]): SymptomEpisode[] {
  const open = new Map<string, SymptomEpisode>();
  const done: SymptomEpisode[] = [];
  let previousDate: Date | null = null;

  for (const { date, log } of days) {
    if (!log) continue;
    const seen = new Set<string>();
    for (const sd of log.symptoms) {
      const k = key(sd.name);
      seen.add(k);
      let ep = open.get(k);
      if (ep && sd.carriedIn === null) {
        // Began afresh although an episode was open: close the old one.
        ep.endDate = previousDate;
        done.push(ep);
        ep = undefined;
      }
      if (!ep) {
        ep = {
          name: sd.name,
          startDate: date,
          startTime: sd.startTime,
          endDate: null,
          endTime: null,
          days: 0,
          peak: 0,
          dailyPeaks: [],
          startedBefore: sd.carriedIn !== null,
        };
        open.set(k, ep);
      }
      ep.days++;
      ep.peak = Math.max(ep.peak, sd.peak);
      ep.dailyPeaks.push(sd.peak);
      if (!sd.activeAtEnd) {
        ep.endDate = date;
        ep.endTime = sd.endTime;
        done.push(ep);
        open.delete(k);
      }
    }
    // Open but absent from a day that has a note: it lapsed (past the
    // carry-over window) without being marked gone.
    for (const [k, ep] of open) {
      if (seen.has(k)) continue;
      ep.endDate = previousDate;
      done.push(ep);
      open.delete(k);
    }
    previousDate = date;
  }

  return [...done, ...open.values()].sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

// ── Calendar ─────────────────────────────────────────────────

export interface CalendarRow {
  name: string;
  /** Peak per day of the range (null: not present, or no note). */
  cells: (number | null)[];
  days: number;
  averagePeak: number;
}

/** One row per symptom seen in the range, most frequent first. */
export function symptomCalendar(days: Day[]): CalendarRow[] {
  const rows = new Map<string, CalendarRow>();
  days.forEach(({ log }, i) => {
    for (const sd of log?.symptoms ?? []) {
      const k = key(sd.name);
      let row = rows.get(k);
      if (!row) {
        row = { name: sd.name, cells: new Array<number | null>(days.length).fill(null), days: 0, averagePeak: 0 };
        rows.set(k, row);
      }
      row.cells[i] = sd.peak;
    }
  });
  for (const row of rows.values()) {
    const peaks = row.cells.filter((c): c is number => c !== null);
    row.days = peaks.length;
    row.averagePeak = peaks.length ? peaks.reduce((a, b) => a + b, 0) / peaks.length : 0;
  }
  return [...rows.values()].sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

export interface WeekTotal {
  /** Monday of the week. */
  weekStart: Date;
  /** Days with any symptom. */
  symptomDays: number;
  /** Days in the range that week that have a note. */
  loggedDays: number;
  /** Average of each symptom day's highest peak; 0 when none. */
  averagePeak: number;
}

/** Per calendar week (Monday start), newest first. */
export function weeklySymptomTotals(days: Day[]): WeekTotal[] {
  const weeks = new Map<number, { weekStart: Date; peaks: number[]; logged: number }>();
  for (const { date, log } of days) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
    const k = monday.getTime();
    const week = weeks.get(k) ?? { weekStart: monday, peaks: [], logged: 0 };
    weeks.set(k, week);
    if (!log) continue;
    week.logged++;
    if (log.symptoms.length > 0) week.peaks.push(Math.max(...log.symptoms.map((s) => s.peak)));
  }
  return [...weeks.values()]
    .sort((a, b) => b.weekStart.getTime() - a.weekStart.getTime())
    .map((w) => ({
      weekStart: w.weekStart,
      symptomDays: w.peaks.length,
      loggedDays: w.logged,
      averagePeak: w.peaks.length ? w.peaks.reduce((a, b) => a + b, 0) / w.peaks.length : 0,
    }));
}

// ── The day before ───────────────────────────────────────────

export interface NextDayLink {
  /** What held the day before, e.g. "Vyvanse", "no Lamotrigine", "Bed time after 00:30". */
  condition: string;
  symptom: string;
  /** Pairs of days where the condition held on the first. */
  withDays: number;
  /** …of which the symptom began on the second. */
  withHits: number;
  withoutDays: number;
  withoutHits: number;
}

/** A substance taken on at least this share of logged days counts as regular, so missing it is a condition. */
const REGULAR_SHARE = 0.6;

/** Clock time for comparing late-night markers: 00:30 sorts after 23:30. */
function lateness(time: string | null): number | null {
  const m = minutesOf(time);
  if (m === null) return null;
  return m < 4 * 60 ? m + 24 * 60 : m;
}

function hhmm(m: number): string {
  const wrapped = m % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * What tends to hold the day before a symptom begins: a substance taken or
 * a regular one missed, an event, or a late time marker (e.g. bed time).
 * Compares the symptom's onset rate on following days with and without the
 * condition. Only consecutive days that both have a note are used.
 */
export function symptomsNextDay(days: Day[], limit = 6): NextDayLink[] {
  const pairs: [DayLog, DayLog][] = [];
  for (let i = 0; i + 1 < days.length; i++) {
    const a = days[i].log;
    const b = days[i + 1].log;
    if (a && b) pairs.push([a, b]);
  }
  if (pairs.length < MIN_DAYS_PER_SIDE * 2) return [];

  const logged = days.map((d) => d.log).filter((l): l is DayLog => l !== null);
  const conditions: { label: string; holds: (log: DayLog) => boolean }[] = [];

  const substances = new Set(logged.flatMap((l) => l.doses.map((d) => d.name)));
  for (const s of substances) {
    const taken = (l: DayLog): boolean => l.doses.some((d) => d.name === s);
    conditions.push({ label: s, holds: taken });
    if (logged.filter(taken).length / logged.length >= REGULAR_SHARE) {
      conditions.push({ label: `no ${s}`, holds: (l) => !taken(l) });
    }
  }

  const events = new Map<string, string>();
  for (const l of logged) for (const e of l.events) events.set(key(e.name), e.name);
  for (const [k, label] of events) {
    conditions.push({ label, holds: (l) => l.events.some((e) => key(e.name) === k) });
  }

  const markerLabels = new Set(logged.flatMap((l) => l.markers.map((m) => m.label)));
  for (const label of markerLabels) {
    const at = (l: DayLog): number | null => lateness(l.markers.find((m) => m.label === label)?.time ?? null);
    const times = logged.map(at).filter((m): m is number => m !== null).sort((a, b) => a - b);
    if (times.length < MIN_DAYS_PER_SIDE * 2) continue;
    const median = times[Math.floor(times.length / 2)];
    conditions.push({
      label: `${label} after ${hhmm(median)}`,
      holds: (l) => {
        const m = at(l);
        return m !== null && m > median;
      },
    });
  }

  const symptoms = new Map<string, string>();
  for (const l of logged) for (const s of l.symptoms) symptoms.set(key(s.name), s.name);

  const found: (NextDayLink & { lift: number })[] = [];
  for (const cond of conditions) {
    for (const [k, name] of symptoms) {
      const began = (l: DayLog): boolean => l.symptoms.some((s) => key(s.name) === k && s.carriedIn === null);
      let withDays = 0, withHits = 0, withoutDays = 0, withoutHits = 0;
      for (const [a, b] of pairs) {
        if (cond.holds(a)) {
          withDays++;
          if (began(b)) withHits++;
        } else {
          withoutDays++;
          if (began(b)) withoutHits++;
        }
      }
      if (withDays < MIN_DAYS_PER_SIDE || withoutDays < MIN_DAYS_PER_SIDE || withHits < 2) continue;
      const lift = withHits / withDays - withoutHits / withoutDays;
      if (lift < 0.2) continue;
      found.push({ condition: cond.label, symptom: name, withDays, withHits, withoutDays, withoutHits, lift });
    }
  }

  return found
    .sort((a, b) => b.lift - a.lift)
    .slice(0, limit)
    .map(({ lift: _l, ...rest }) => rest);
}
