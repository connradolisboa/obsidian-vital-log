// ============================================================
// Vital Log — Symptoms
// Symptoms are logged as readings: a name, a time, and a 0–10
// severity. Logging the same symptom again re-rates it; 0 means it
// has gone. A symptom still above 0 at the end of a day carries over
// into the next days until it's marked gone (within a window, so a
// forgotten one doesn't stay "active" forever).
//
// The readers here are pure; logSymptom and the event migration write
// through yamlManager.
// ============================================================

import type { App, TFile } from 'obsidian';
import type { SymptomEntry, SymptomType, VitalLogSettings } from './types';
import { SYMPTOM_MAX } from './types';
import { appendEntry, appendLineToBody } from './yamlManager';
import { applyTemplate, noteContentHeading } from './template';

type Fm = Record<string, unknown>;

/** How many days back an unresolved symptom still counts as active. */
export const ACTIVE_WINDOW_DAYS = 7;

export interface SymptomReading {
  time: string | null;
  severity: number;
  note?: string;
}

/** One symptom's course over a single day. */
export interface SymptomDay {
  name: string;
  icon?: string;
  readings: SymptomReading[];
  /** Severity it carried into the day from earlier days; null when it started (or not at all) today. */
  carriedIn: number | null;
  /** Highest severity reached today, including any carried in. */
  peak: number;
  /** Time it began today; null when carried in. */
  startTime: string | null;
  /** Time it was marked gone (the last 0 after being active); null when still active. */
  endTime: string | null;
  /** Still above 0 at the end of the day's readings. */
  activeAtEnd: boolean;
}

// ── Reading ──────────────────────────────────────────────────

function isObj(v: unknown): v is Fm {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clampSeverity(n: number): number {
  return Math.max(0, Math.min(SYMPTOM_MAX, Math.round(n)));
}

/** The symptom readings in a note's frontmatter, in time order (untimed first). */
export function readSymptomEntries(fm: Fm, settings: VitalLogSettings): SymptomEntry[] {
  const raw = fm[settings.symptomsPropertyKey || 'symptoms'];
  if (!Array.isArray(raw)) return [];
  const out: SymptomEntry[] = [];
  for (const e of raw) {
    if (!isObj(e)) continue;
    const name = typeof e['name'] === 'string' ? e['name'].trim() : '';
    const severity = typeof e['severity'] === 'number' ? e['severity'] : NaN;
    if (!name || isNaN(severity)) continue;
    out.push({
      name,
      time: typeof e['time'] === 'string' ? e['time'].trim() : '',
      severity: clampSeverity(severity),
      ...(typeof e['note'] === 'string' && e['note'].trim() ? { note: e['note'] } : {}),
    });
  }
  // Stable: same-time readings keep the order they were logged in.
  return out.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}

/** Symptom names are matched case-insensitively; keep the first spelling seen. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Each symptom's course over a day, from that day's readings plus whatever
 * was still active coming in (`carriedIn`, keyed by lowercase name).
 */
export function buildSymptomDays(
  entries: SymptomEntry[],
  carriedIn: Map<string, { name: string; severity: number }>,
  settings: VitalLogSettings
): SymptomDay[] {
  const days = new Map<string, SymptomDay>();
  const iconFor = (name: string): string | undefined =>
    settings.symptomTypes.find((t) => key(t.displayName) === key(name))?.icon;

  for (const [k, c] of carriedIn) {
    if (c.severity <= 0) continue;
    days.set(k, {
      name: c.name,
      icon: iconFor(c.name),
      readings: [],
      carriedIn: c.severity,
      peak: c.severity,
      startTime: null,
      endTime: null,
      activeAtEnd: true,
    });
  }

  for (const e of entries) {
    const k = key(e.name);
    let day = days.get(k);
    if (!day) {
      day = {
        name: e.name, icon: iconFor(e.name), readings: [], carriedIn: null,
        peak: 0, startTime: null, endTime: null, activeAtEnd: false,
      };
      days.set(k, day);
    }
    day.readings.push({ time: e.time || null, severity: e.severity, ...(e.note ? { note: e.note } : {}) });
    if (e.severity > 0) {
      if (!day.activeAtEnd && day.carriedIn === null && day.startTime === null) day.startTime = e.time || null;
      day.activeAtEnd = true;
      day.endTime = null;
      day.peak = Math.max(day.peak, e.severity);
    } else if (day.activeAtEnd) {
      day.activeAtEnd = false;
      day.endTime = e.time || null;
    }
  }

  // A symptom only ever logged as gone, with nothing carried in, never happened today.
  return [...days.values()].filter((d) => d.peak > 0);
}

/**
 * What's still active after a run of days (oldest first): the latest
 * reading of each symptom, kept when above 0. Also returns when each active
 * symptom began (its first reading in the current run).
 */
export function activeAfter(
  daysOldestFirst: { iso: string; entries: SymptomEntry[] }[]
): Map<string, { name: string; severity: number; sinceISO: string; sinceTime: string }> {
  const state = new Map<string, { name: string; severity: number; sinceISO: string; sinceTime: string }>();
  for (const day of daysOldestFirst) {
    for (const e of day.entries) {
      const k = key(e.name);
      const prev = state.get(k);
      if (e.severity <= 0) {
        state.delete(k);
      } else if (prev) {
        prev.severity = e.severity;
      } else {
        state.set(k, { name: e.name, severity: e.severity, sinceISO: day.iso, sinceTime: e.time });
      }
    }
  }
  return state;
}

// ── Writing ──────────────────────────────────────────────────

export async function logSymptom(
  app: App,
  file: TFile,
  entry: SymptomEntry,
  settings: VitalLogSettings,
  appendToNote: boolean
): Promise<void> {
  const stored: SymptomEntry = {
    time: entry.time,
    name: entry.name,
    severity: clampSeverity(entry.severity),
    ...(entry.note && settings.logNoteInFrontmatter !== false ? { note: entry.note } : {}),
  };
  await appendEntry(app, file, settings.symptomsPropertyKey || 'symptoms', stored);

  if (appendToNote) {
    const line = applyTemplate(settings.noteContentTemplate_symptoms || '- {time} {name} {severity}/10', {
      time: entry.time,
      name: entry.name,
      severity: String(stored.severity),
      note: entry.note ?? '',
    });
    await appendLineToBody(app, file, line, noteContentHeading(settings));
  }
}

/** Add a symptom type unless one with that name exists. Returns the type either way. */
export function ensureSymptomType(settings: VitalLogSettings, name: string, icon?: string): SymptomType {
  const existing = settings.symptomTypes.find((t) => key(t.displayName) === key(name));
  if (existing) return existing;
  const created: SymptomType = { id: crypto.randomUUID(), displayName: name.trim(), ...(icon ? { icon } : {}) };
  settings.symptomTypes.push(created);
  return created;
}

// ── Moving an event type to symptoms ─────────────────────────

/**
 * In one note's frontmatter, move every event named `eventName` into the
 * symptoms list, mapping its 1–5 severity onto 0–10 (×2). Returns how many
 * entries moved. Other events are left untouched.
 */
export function moveEventsToSymptomsIn(fm: Fm, eventName: string, settings: VitalLogSettings): number {
  const eventsKey = settings.eventsPropertyKey || 'events';
  const symptomsKey = settings.symptomsPropertyKey || 'symptoms';
  const events = fm[eventsKey];
  if (!Array.isArray(events)) return 0;

  const moved: SymptomEntry[] = [];
  const kept: unknown[] = [];
  for (const e of events) {
    if (isObj(e) && typeof e['name'] === 'string' && key(e['name']) === key(eventName)) {
      const severity = typeof e['severity'] === 'number' ? clampSeverity(e['severity'] * 2) : 5;
      moved.push({
        time: typeof e['time'] === 'string' ? e['time'] : '',
        name: e['name'],
        severity: severity === 0 ? 1 : severity,
        ...(typeof e['note'] === 'string' && e['note'] ? { note: e['note'] } : {}),
      });
    } else {
      kept.push(e);
    }
  }
  if (moved.length === 0) return 0;

  if (kept.length === 0) delete fm[eventsKey];
  else fm[eventsKey] = kept;

  const existing = fm[symptomsKey];
  if (Array.isArray(existing)) existing.push(...moved);
  else if (existing === undefined || existing === null) fm[symptomsKey] = moved;
  else throw new Error(`"${symptomsKey}" exists but is not a list`);
  return moved.length;
}
