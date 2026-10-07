// ============================================================
// Vital Log — Day log model
// Everything logged in one note's frontmatter, gathered into a
// structured shape for the `vital-day` viewer. Pure: reads a
// frontmatter record, never the vault.
//
// Reads every supplement format regardless of the current log mode
// (substances[], per-vitamin keys, and plain names in substances[]),
// so notes from before a mode switch still show up.
// ============================================================

import type { Metric, VitalLogSettings } from './types';
import type { MtSession } from './managementTracker';
import { formatMinutes } from './managementTracker';
import { checkboxMetrics, scalarMetrics, seriesMetrics } from './types';

type Fm = Record<string, unknown>;

export interface SubstanceDose {
  name: string;
  time: string | null;
  amount: number | null;
  unit: string;
  note?: string;
}

export interface SubstanceTotal {
  name: string;
  unit: string;
  /** Sum of the doses that have an amount; null when none do. */
  total: number | null;
  times: string[];
  doses: number;
}

export interface NamedEntry {
  name: string;
  time: string | null;
}

export interface TrackerReading {
  time: string | null;
  value: number;
  note?: string;
}

export interface TrackerDay {
  tracker: Metric;
  readings: TrackerReading[];
}

export interface TallyDay {
  tally: Metric;
  value: number;
}

export interface LoggedEvent {
  name: string;
  time: string | null;
  severity: number;
  icon?: string;
  note?: string;
}

export interface MarkerTime {
  label: string;
  icon?: string;
  time: string;
}

export interface DayLog {
  markers: MarkerTime[];
  doses: SubstanceDose[];
  packs: NamedEntry[];
  stacks: NamedEntry[];
  trackers: TrackerDay[];
  tallies: TallyDay[];
  habits: Metric[];
  events: LoggedEvent[];
  /** Time Tracker sessions from Management Tracker; empty unless the caller attaches them. */
  sessions: MtSession[];
}

export type TimelineKind = 'marker' | 'session' | 'substance' | 'pack' | 'stack' | 'tracker' | 'tally' | 'habit' | 'event';

export interface TimelineItem {
  kind: TimelineKind;
  time: string | null;
  icon?: string;
  text: string;
  note?: string;
  severity?: number;
}

function isObj(v: unknown): v is Fm {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function timeOf(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/**
 * A time of day from a hand-typed property: "07:30", "7:30", "0730", 730,
 * or an ISO datetime. Returns "HH:mm", or null for blanks and anything else.
 */
export function looseTime(v: unknown): string | null {
  const fmt = (h: number, m: number): string | null =>
    h >= 0 && h <= 23 && m >= 0 && m <= 59
      ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      : null;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 0) return null;
    return fmt(Math.floor(v / 100), v % 100);
  }
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const hm = /(?:^|T|\s)(\d{1,2}):(\d{2})/.exec(t);
  if (hm) return fmt(parseInt(hm[1], 10), parseInt(hm[2], 10));
  if (/^\d{3,4}$/.test(t)) return looseTime(parseInt(t, 10));
  return null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

function byTime<T extends { time: string | null }>(a: T, b: T): number {
  if (a.time === b.time) return 0;
  if (a.time === null) return -1;
  if (b.time === null) return 1;
  return a.time.localeCompare(b.time);
}

export function collectDayLog(fm: Fm, settings: VitalLogSettings): DayLog {
  const unitFor = (name: string): string =>
    settings.vitamins.find((v) => v.displayName === name)?.unit ?? '';

  // ── Day markers (wake up, bed time, …) ────────────────────
  const markers: MarkerTime[] = [];
  for (const m of settings.dayMarkers ?? []) {
    const time = looseTime(fm[m.propertyKey]);
    if (time) markers.push({ label: m.label, time, ...(m.icon ? { icon: m.icon } : {}) });
  }

  // ── Supplements ─────────────────────────────────────────
  const doses: SubstanceDose[] = [];
  const substances = fm['substances'];
  if (Array.isArray(substances)) {
    for (const e of substances) {
      if (typeof e === 'string' && e.trim()) {
        doses.push({ name: e.trim(), time: null, amount: null, unit: unitFor(e.trim()) });
        continue;
      }
      if (!isObj(e)) continue;
      const name = str(e['name']);
      if (!name) continue;
      doses.push({
        name,
        time: timeOf(e['time']),
        amount: num(e['amount']),
        unit: str(e['unit']) ?? unitFor(name),
        ...(str(e['note']) ? { note: e['note'] as string } : {}),
      });
    }
  }
  for (const v of settings.vitamins) {
    if (v.propertyKey === 'substances') continue;
    const arr = fm[v.propertyKey];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (!isObj(e)) continue;
      const amount = num(e['amount']);
      const time = timeOf(e['time']);
      if (amount === null && time === null) continue;
      doses.push({
        name: v.displayName,
        time,
        amount,
        unit: str(e['unit']) ?? v.unit,
        ...(str(e['note']) ? { note: e['note'] as string } : {}),
      });
    }
  }
  doses.sort(byTime);

  const named = (key: string): NamedEntry[] => {
    const arr = fm[key];
    if (!Array.isArray(arr)) return [];
    const out: NamedEntry[] = [];
    for (const e of arr) {
      if (!isObj(e)) continue;
      const name = str(e['name']);
      if (name) out.push({ name, time: timeOf(e['time']) });
    }
    return out.sort(byTime);
  };

  // ── Trackers, tallies, habits ───────────────────────────
  const trackers: TrackerDay[] = [];
  for (const tracker of seriesMetrics(settings)) {
    const arr = fm[tracker.propertyKey];
    if (!Array.isArray(arr)) continue;
    const readings: TrackerReading[] = [];
    for (const e of arr) {
      if (!isObj(e)) continue;
      const value = num(e[tracker.valueName]);
      if (value === null) continue;
      readings.push({
        time: timeOf(e['time']),
        value,
        ...(str(e['note']) ? { note: e['note'] as string } : {}),
      });
    }
    if (readings.length > 0) trackers.push({ tracker, readings: readings.sort(byTime) });
  }

  const tallies: TallyDay[] = [];
  for (const tally of scalarMetrics(settings)) {
    const raw = fm[tally.propertyKey];
    const value = isObj(raw) ? num(raw['value']) : null;
    if (value !== null && value > 0) tallies.push({ tally, value });
  }

  const habits = checkboxMetrics(settings).filter((h) => fm[h.propertyKey] === true);

  // ── Events ──────────────────────────────────────────────
  const events: LoggedEvent[] = [];
  const rawEvents = fm[settings.eventsPropertyKey || 'events'];
  if (Array.isArray(rawEvents)) {
    for (const e of rawEvents) {
      if (!isObj(e)) continue;
      const name = str(e['name']);
      if (!name) continue;
      const icon = settings.eventTypes.find((t) => t.displayName.toLowerCase() === name.toLowerCase())?.icon;
      events.push({
        name,
        time: timeOf(e['time']),
        severity: num(e['severity']) ?? 0,
        ...(icon ? { icon } : {}),
        ...(str(e['note']) ? { note: e['note'] as string } : {}),
      });
    }
  }
  events.sort(byTime);

  return { markers, doses, packs: named('packs'), stacks: named('stacks'), trackers, tallies, habits, events, sessions: [] };
}

/** Per-substance totals, in order of first dose. */
export function substanceTotals(log: DayLog): SubstanceTotal[] {
  const map = new Map<string, SubstanceTotal>();
  for (const d of log.doses) {
    const key = `${d.name}\u0000${d.unit}`;
    let row = map.get(key);
    if (!row) {
      row = { name: d.name, unit: d.unit, total: null, times: [], doses: 0 };
      map.set(key, row);
    }
    row.doses++;
    if (d.time) row.times.push(d.time);
    if (d.amount !== null) row.total = (row.total ?? 0) + d.amount;
  }
  return [...map.values()];
}

function formatAmount(amount: number | null, unit: string): string {
  if (amount === null) return '';
  return ` ${Math.round(amount * 100) / 100}${unit}`;
}

/** Every entry as one time-ordered list; untimed items (tallies, habits) first. */
export function timeline(log: DayLog): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const m of log.markers) items.push({ kind: 'marker', time: m.time, icon: m.icon ?? 'clock', text: m.label });
  for (const s of log.sessions) {
    items.push({
      kind: 'session',
      time: s.time,
      icon: 'timer',
      text: `${s.title || 'Session'} · ${formatMinutes(s.minutes)}`,
      note: s.countsToward || undefined,
    });
  }
  for (const d of log.doses) {
    items.push({ kind: 'substance', time: d.time, icon: 'pill', text: `${d.name}${formatAmount(d.amount, d.unit)}`, note: d.note });
  }
  for (const p of log.packs) items.push({ kind: 'pack', time: p.time, icon: 'package', text: p.name });
  for (const s of log.stacks) items.push({ kind: 'stack', time: s.time, icon: 'layers', text: s.name });
  for (const t of log.trackers) {
    for (const r of t.readings) {
      const unit = t.tracker.trackerType === 'minutes' ? ' min' : '';
      items.push({ kind: 'tracker', time: r.time, icon: t.tracker.icon ?? 'activity', text: `${t.tracker.displayName}: ${r.value}${unit}`, note: r.note });
    }
  }
  for (const t of log.tallies) {
    items.push({ kind: 'tally', time: null, icon: t.tally.icon ?? 'hash', text: `${t.tally.displayName}: ${t.value}/${t.tally.target}` });
  }
  for (const h of log.habits) items.push({ kind: 'habit', time: null, icon: h.icon ?? 'check', text: h.displayName });
  for (const e of log.events) {
    items.push({ kind: 'event', time: e.time, icon: e.icon ?? 'calendar-clock', text: e.name, note: e.note, severity: e.severity });
  }
  // Stable sort keeps kind order within the same minute.
  return items.sort(byTime);
}

export function isEmptyDay(log: DayLog): boolean {
  return (
    log.markers.length === 0 && log.doses.length === 0 && log.packs.length === 0 && log.stacks.length === 0 &&
    log.trackers.length === 0 && log.tallies.length === 0 && log.habits.length === 0 &&
    log.events.length === 0 && log.sessions.length === 0
  );
}
