// ============================================================
// Vital Log — Public API
//
// The surface other plugins call. It owns the *vocabulary* — which vitamins
// and metrics exist, what they are called, what their units and ranges are —
// so any front-end (Telegram, a shortcut, a webhook) parses commands the same
// way and writes through the same managers the modals use.
//
// Everything here is glue: resolution and parsing live in this file, but a
// logged entry is always written by vitaminManager/trackerManager so the API
// inherits logMode, logSource, units and note templates for free.
//
// Version history:
//   1 — describe, parseCommand, log, logText, help
//   2 — renderDay: draw the day viewer for any date into another plugin's view
//   3 — symptoms: describe() lists them; "headache 5" / "headache gone" log them
//   4 — timeline(date); describe() adds symptom icons and dayTabs
// ============================================================

import { App, TFile } from 'obsidian';
import type { Component } from 'obsidian';
import type { Metric, SymptomType, VitalLogSettings, Vitamin } from './types';
import { SYMPTOM_MAX } from './types';
import { resolveDailyNote } from './dailyNoteResolver';
import { logVitamin } from './vitaminManager';
import { logTracker } from './trackerManager';
import { logSymptom } from './symptomManager';
import { dayLogFor } from './dayHistory';
import { timeline as dayTimeline } from './dayLog';
import { DAY_TABS } from './dayTabs';

export const VITAL_LOG_API_VERSION = 4;

// ── Public types ─────────────────────────────────────────────

export interface CatalogueItem {
  kind: 'vitamin' | 'metric' | 'symptom';
  id: string;
  displayName: string;
  propertyKey: string;
  /** Every string this item can be addressed by, lowercased. */
  aliases: string[];
  /** True when this API version can log the item. */
  supported: boolean;
  // vitamin only
  unit?: string;
  defaultAmount?: number;
  /** Lucide icon name, when set (symptoms; since version 4). */
  icon?: string;
  // metric only
  trackerType?: string;
  valueName?: string;
  min?: number;
  max?: number;
}

export interface Catalogue {
  vitamins: CatalogueItem[];
  metrics: CatalogueItem[];
  /** Since version 3. Logged as 0–10; 0 means gone. */
  symptoms: CatalogueItem[];
  /** The `vital-day` viewer's tab ids, in order (since version 4) — valid for renderDay's `tab` / `tabs`. */
  dayTabs: string[];
}

/** One logged entry on a day's timeline (since version 4). */
export interface TimelineEntry {
  /**
   * What sort of entry: "marker", "session", "substance", "pack", "stack",
   * "tracker", "tally", "habit", "symptom", "event" — and any added later.
   * "session" entries are Management Tracker's own Time Tracker sessions.
   */
  kind: string;
  name: string;
  /** "HH:mm", or null for untimed entries (tallies, habits, a symptom carried in from an earlier day). */
  time: string | null;
  icon?: string;
  /** The amount, reading, minutes, or count, when the entry has one. */
  value?: number;
  unit?: string;
  /** Symptoms 0–10 (0 = gone); events 1–5. */
  severity?: number;
  note?: string;
}

export type ParsedLogCommand =
  | {
      kind: 'vitamin';
      vitaminId: string;
      amount: number;
      time?: string;      // "HH:mm"
      date?: string;      // "YYYY-MM-DD", absolute override
      dayOffset?: number; // relative override, e.g. -1 for "yesterday"
      note?: string;
    }
  | {
      kind: 'metric';
      metricId: string;
      value: number;
      time?: string;
      date?: string;
      dayOffset?: number;
      note?: string;
    }
  | {
      kind: 'symptom';
      symptomId: string;
      /** 0–10; 0 marks it gone. */
      severity: number;
      time?: string;
      date?: string;
      dayOffset?: number;
      note?: string;
    };

export type ParseFailureReason = 'empty' | 'no-match' | 'ambiguous' | 'bad-value' | 'unsupported';

export type ParseOutcome =
  | { ok: true; command: ParsedLogCommand }
  | { ok: false; reason: ParseFailureReason; message: string; candidates?: string[] };

export interface LogOpts {
  /** Reference date/time — defaults to now. The clock is the entry's default time. */
  date?: Date;
  /** Written to the entry's `source` field (vitamins only). Defaults to "manual". */
  source?: string;
  /** Override the settings default for writing a line into the note body. */
  appendToNote?: boolean;
}

export interface LogResult {
  ok: boolean;
  /** Human-readable one-liner, safe to show to whoever sent the command. */
  summary: string;
  notePath?: string;
  error?: string;
}

export interface RenderDayOptions {
  /** The day to show, as `YYYY-MM-DD` or a Date. */
  date: string | Date;
  /** Tab to open on: chart, timeline, substances, trackers, events, time, week, insights. */
  tab?: string;
  /** Which tabs to show, in order. Defaults to all. */
  tabs?: string[];
  /** Header text. Defaults to "Day". */
  title?: string;
}

export type RenderDay = (el: HTMLElement, opts: RenderDayOptions, component: Component) => void;

export interface VitalLogApi {
  version: number;
  describe(): Catalogue;
  parseCommand(text: string): ParseOutcome;
  log(command: ParsedLogCommand, opts?: LogOpts): Promise<LogResult>;
  logText(text: string, opts?: LogOpts): Promise<LogResult>;
  help(): string;
  /**
   * Everything logged on a day (`YYYY-MM-DD`), in time order — the items the
   * `vital-day` Timeline tab draws (since version 4). Empty when the day has
   * no note or the date is invalid. Reads Obsidian's metadata cache, so it is
   * synchronous.
   */
  timeline(date: string): TimelineEntry[];
  /**
   * Draw the `vital-day` viewer for a date into `el` (since version 2).
   * Listeners are registered on `component`, so they end when it unloads.
   * A day with no daily note shows an empty state.
   */
  renderDay: RenderDay;
}

// ── Factory ──────────────────────────────────────────────────

/**
 * Build the API object. `getSettings` is called on every access rather than
 * captured, so the vocabulary tracks settings edits without the plugin having
 * to rebuild the API.
 */
export function createVitalLogApi(
  app: App,
  getSettings: () => VitalLogSettings,
  renderDay: RenderDay = () => {}
): VitalLogApi {
  return {
    version: VITAL_LOG_API_VERSION,
    describe: () => describe(getSettings()),
    parseCommand: (text: string) => parseCommand(getSettings(), text),
    log: (command: ParsedLogCommand, opts?: LogOpts) => log(app, getSettings(), command, opts),
    logText: async (text: string, opts?: LogOpts) => {
      const parsed = parseCommand(getSettings(), text);
      if (!parsed.ok) {
        return { ok: false, summary: parsed.message, error: parsed.message };
      }
      return log(app, getSettings(), parsed.command, opts);
    },
    help: () => help(getSettings()),
    timeline: (date: string) => timelineOn(app, getSettings(), date),
    renderDay,
  };
}

// ── describe / help ──────────────────────────────────────────

function describe(settings: VitalLogSettings): Catalogue {
  return {
    vitamins: activeVitamins(settings).map((v) => ({
      kind: 'vitamin' as const,
      id: v.id,
      displayName: v.displayName,
      propertyKey: v.propertyKey,
      aliases: aliasesOfVitamin(v),
      supported: true,
      unit: v.unit,
      defaultAmount: v.defaultAmount,
    })),
    metrics: activeMetrics(settings).map((m) => ({
      kind: 'metric' as const,
      id: m.id,
      displayName: m.displayName,
      propertyKey: m.propertyKey,
      aliases: aliasesOfMetric(m),
      supported: isSupportedMetric(m),
      trackerType: m.trackerType ?? 'rating',
      valueName: m.valueName,
      min: m.min,
      max: m.max,
    })),
    symptoms: activeSymptoms(settings).map((t) => ({
      kind: 'symptom' as const,
      id: t.id,
      displayName: t.displayName,
      propertyKey: settings.symptomsPropertyKey || 'symptoms',
      icon: t.icon ?? 'thermometer',
      aliases: aliasesOfSymptom(t),
      supported: true,
      min: 0,
      max: SYMPTOM_MAX,
    })),
    dayTabs: DAY_TABS.map((t) => t.id),
  };
}

// ── timeline ─────────────────────────────────────────────────

function timelineOn(app: App, settings: VitalLogSettings, date: string): TimelineEntry[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? '').trim());
  if (!m) return [];
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  // Reject dates that roll over, e.g. 2026-02-31.
  if (day.getMonth() !== Number(m[2]) - 1 || day.getDate() !== Number(m[3])) return [];

  const log = dayLogFor(app, settings, day);
  if (!log) return [];
  // Copy field by field rather than per kind, so a new kind needs no change here.
  return dayTimeline(log).map((item) => {
    const entry: TimelineEntry = { kind: item.kind, name: item.name, time: item.time };
    if (item.icon !== undefined) entry.icon = item.icon;
    if (item.value !== undefined) entry.value = item.value;
    if (item.unit !== undefined) entry.unit = item.unit;
    if (item.severity !== undefined) entry.severity = item.severity;
    if (item.note !== undefined) entry.note = item.note;
    return entry;
  });
}

function help(settings: VitalLogSettings): string {
  const lines: string[] = [
    'Send a log as: <name> <value> [@HH:mm | yesterday] [note]',
    '',
    'Examples:',
    '  ritalin 10',
    '  mood 4',
    '  energy 2 crashed after lunch',
    '  focus 3 @09:15',
    '  headache 6',
    '  headache gone',
  ];

  const vitamins = activeVitamins(settings);
  if (vitamins.length > 0) {
    lines.push('', 'Meds & supplements:');
    for (const v of vitamins) {
      lines.push(`  ${v.displayName} — default ${formatNumber(v.defaultAmount)}${v.unit}`);
    }
  }

  const metrics = activeMetrics(settings).filter(isSupportedMetric);
  if (metrics.length > 0) {
    lines.push('', 'Metrics:');
    for (const m of metrics) {
      lines.push(`  ${m.displayName} — ${describeRange(m)}`);
    }
  }

  const symptoms = activeSymptoms(settings);
  if (symptoms.length > 0) {
    lines.push('', 'Symptoms (0–10, or "gone"):');
    for (const t of symptoms) lines.push(`  ${t.displayName}`);
  }

  return lines.join('\n');
}

function describeRange(metric: Metric): string {
  if (metric.trackerType === 'minutes') return 'minutes';
  if (metric.max > metric.min) return `${metric.min}–${metric.max}`;
  return 'number';
}

// ── Parsing ──────────────────────────────────────────────────

// Words that may prefix a command without being part of an item's name.
// Only stripped when the text does not already resolve with them included,
// so an item genuinely called "Log" still wins.
type Scope = 'any' | 'vitamins' | 'symptoms';

const COMMAND_PREFIXES: Record<string, Scope> = {
  med: 'vitamins',
  meds: 'vitamins',
  medication: 'vitamins',
  supp: 'vitamins',
  supplement: 'vitamins',
  vitamin: 'vitamins',
  symptom: 'symptoms',
  symptoms: 'symptoms',
  log: 'any',
  vital: 'any',
  vitals: 'any',
};

// The most words an item name is allowed to span. Bounds the greedy search
// so a long note can't make resolution quadratic in the message length.
const MAX_NAME_WORDS = 4;

function parseCommand(settings: VitalLogSettings, text: string): ParseOutcome {
  const tokens = (text ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: false, reason: 'empty', message: 'Nothing to log.' };
  }

  // Strip a leading slash from the first token only — "/mood 4" and "mood 4"
  // are the same command, but a note may legitimately contain slashes.
  tokens[0] = tokens[0].replace(/^\/+/, '');
  if (!tokens[0]) tokens.shift();
  if (tokens.length === 0) {
    return { ok: false, reason: 'empty', message: 'Nothing to log.' };
  }

  // An exact name match always wins, so an item genuinely called "Log" beats
  // the "/log …" prefix reading of the same word.
  const direct = resolveLeadingItem(settings, tokens, 'any');
  if (direct.ok && direct.exact) return buildCommand(direct.item, tokens.slice(direct.consumed));

  // Otherwise treat a leading keyword as a command prefix ("/med ritalin 10").
  // Once a prefix is followed by anything, its reading is authoritative: "med"
  // also prefix-matches the Meditation metric, and silently falling back to
  // that would turn "/med mood 4" into "Meditation 4, note: mood".
  const prefixScope = COMMAND_PREFIXES[tokens[0].toLowerCase()];
  if (prefixScope) {
    const rest = tokens.slice(1);
    if (rest.length === 0) {
      // A bare keyword is only a command prefix if something follows it.
      if (!direct.ok) {
        return { ok: false, reason: 'empty', message: 'Nothing to log. Send "help" to see what you can log.' };
      }
    } else {
      const prefixed = resolveLeadingItem(settings, rest, prefixScope);
      if (prefixed.ok) return buildCommand(prefixed.item, rest.slice(prefixed.consumed));
      return withHint(prefixed.failure, direct);
    }
  }

  if (direct.ok) return buildCommand(direct.item, tokens.slice(direct.consumed));
  return direct.failure;
}

/**
 * When a prefixed reading fails but the unprefixed text did match something,
 * say so — "/med 20" is a plausible attempt at the Meditation metric, and a
 * bare "no such med" would send the user hunting for the wrong mistake.
 */
function withHint(
  failure: Extract<ParseOutcome, { ok: false }>,
  direct: LeadingItem
): Extract<ParseOutcome, { ok: false }> {
  if (!direct.ok) return failure;
  const name = itemName(direct.item);
  return { ...failure, message: `${failure.message} Did you mean "${name}"?` };
}

type ResolvedItem =
  | { kind: 'vitamin'; vitamin: Vitamin }
  | { kind: 'metric'; metric: Metric }
  | { kind: 'symptom'; symptom: SymptomType };

function itemName(item: ResolvedItem): string {
  if (item.kind === 'vitamin') return item.vitamin.displayName;
  if (item.kind === 'metric') return item.metric.displayName;
  return item.symptom.displayName;
}

const SCOPE_NOUN: Record<Scope, string> = {
  vitamins: 'med or supplement',
  symptoms: 'symptom',
  any: 'med, metric, or symptom',
};

type LeadingItem =
  | { ok: true; item: ResolvedItem; consumed: number; exact: boolean }
  | { ok: false; failure: Extract<ParseOutcome, { ok: false }> };

/**
 * Take the longest leading run of words that names exactly one item.
 * Tried longest-first so "Vitamin C 500" resolves to "Vitamin C", not to a
 * one-word prefix match on "Vitamin".
 */
function resolveLeadingItem(
  settings: VitalLogSettings,
  tokens: string[],
  scope: Scope
): LeadingItem {
  const candidates = buildCandidates(settings, scope);
  const maxWords = Math.min(MAX_NAME_WORDS, tokens.length);

  // Remembered so an all-ambiguous message beats a generic "unknown item".
  let ambiguity: Candidate[] | undefined;

  for (let words = maxWords; words >= 1; words--) {
    const needle = tokens.slice(0, words).join(' ');
    const { matches, exact } = matchCandidates(candidates, needle);
    if (matches.length === 1) {
      return { ok: true, item: matches[0].item, consumed: words, exact };
    }
    if (matches.length > 1 && !ambiguity) ambiguity = matches;
  }

  if (ambiguity) {
    const names = ambiguity.map((c) => c.displayName);
    return {
      ok: false,
      failure: {
        ok: false,
        reason: 'ambiguous',
        message: `"${tokens[0]}" matches several items: ${names.join(', ')}.`,
        candidates: names,
      },
    };
  }

  return {
    ok: false,
    failure: {
      ok: false,
      reason: 'no-match',
      // Name only what was actually searched: under "/med" the metrics were
      // never in the pool, so offering them would misdirect.
      message: `No ${SCOPE_NOUN[scope]} called "${tokens[0]}".`,
      candidates: candidates.map((c) => c.displayName),
    },
  };
}

/** Words that mark a symptom as gone, in place of a 0. */
const GONE_WORDS = new Set(['gone', 'over', 'ended', 'stopped', 'better', 'none']);

function buildCommand(item: ResolvedItem, rest: string[]): ParseOutcome {
  const { time, date, dayOffset, remainder } = extractModifiers(rest);

  if (item.kind === 'symptom') {
    // The first token is the severity — a number or a "gone" word; the rest is the note.
    const [first, ...others] = remainder;
    const name = item.symptom.displayName;
    const severity = first === undefined
      ? undefined
      : GONE_WORDS.has(first.toLowerCase()) ? 0 : parseNumber(first);
    if (severity === undefined) {
      return {
        ok: false,
        reason: 'bad-value',
        message: `"${name}" needs how bad it is, 0–10 — e.g. "${name.toLowerCase()} 5", or "${name.toLowerCase()} gone".`,
      };
    }
    if (!Number.isInteger(severity) || severity < 0 || severity > SYMPTOM_MAX) {
      return { ok: false, reason: 'bad-value', message: `${name} takes 0–10, not ${formatNumber(severity)}.` };
    }
    const note = others.join(' ') || undefined;
    return { ok: true, command: { kind: 'symptom', symptomId: item.symptom.id, severity, time, date, dayOffset, note } };
  }

  // The first bare number is the value; anything after it is the note. Notes
  // containing digits are therefore fine as long as the value comes first.
  let value: number | undefined;
  const noteWords: string[] = [];
  for (const token of remainder) {
    if (value === undefined) {
      const parsed = parseNumber(token);
      if (parsed !== undefined) {
        value = parsed;
        continue;
      }
    }
    noteWords.push(token);
  }
  const note = noteWords.join(' ') || undefined;

  if (item.kind === 'vitamin') {
    const amount = value ?? item.vitamin.defaultAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        ok: false,
        reason: 'bad-value',
        message: `"${item.vitamin.displayName}" needs a positive amount, e.g. "${item.vitamin.displayName.toLowerCase()} ${formatNumber(item.vitamin.defaultAmount)}".`,
      };
    }
    return {
      ok: true,
      command: { kind: 'vitamin', vitaminId: item.vitamin.id, amount, time, date, dayOffset, note },
    };
  }

  const metric = item.metric;
  if (!isSupportedMetric(metric)) {
    return {
      ok: false,
      reason: 'unsupported',
      message: `"${metric.displayName}" is a ${metric.trackerType} metric — this API can't log those yet.`,
    };
  }
  if (value === undefined) {
    return {
      ok: false,
      reason: 'bad-value',
      message: `"${metric.displayName}" needs a value, e.g. "${metric.displayName.toLowerCase()} ${suggestedValue(metric)}".`,
    };
  }
  const rangeError = checkMetricRange(metric, value);
  if (rangeError) return { ok: false, reason: 'bad-value', message: rangeError };

  return {
    ok: true,
    command: { kind: 'metric', metricId: metric.id, value, time, date, dayOffset, note },
  };
}

interface Modifiers {
  time?: string;
  date?: string;
  dayOffset?: number;
  remainder: string[];
}

function extractModifiers(tokens: string[]): Modifiers {
  const remainder: string[] = [];
  let time: string | undefined;
  let date: string | undefined;
  let dayOffset: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const lower = token.toLowerCase();

    if (lower === 'yesterday') {
      dayOffset = -1;
      continue;
    }
    if (lower === 'today') {
      dayOffset = 0;
      continue;
    }

    if (token.startsWith('@')) {
      const value = token.slice(1);

      const dateMatch = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2}))?$/);
      if (dateMatch) {
        date = dateMatch[1];
        const inlineTime = dateMatch[2] ? normalizeTime(dateMatch[2]) : undefined;
        if (inlineTime) {
          time = inlineTime;
        } else {
          // "@2026-08-26 14:30" reaches us as two tokens.
          const next = normalizeTime(tokens[i + 1]);
          if (next) {
            time = next;
            i++;
          }
        }
        continue;
      }

      const clock = normalizeTime(value);
      if (clock) {
        time = clock;
        continue;
      }
    }

    remainder.push(token);
  }

  return { time, date, dayOffset, remainder };
}

/** "9:5" is not a time; "9:05" is. Returns a zero-padded "HH:mm" or undefined. */
function normalizeTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** Accepts "10", "2.5", "10mg" — a trailing unit is ignored, not validated. */
function parseNumber(token: string): number | undefined {
  const match = token.match(/^([+-]?\d+(?:[.,]\d+)?)\s*[a-z%]*$/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

function checkMetricRange(metric: Metric, value: number): string | undefined {
  if (metric.trackerType === 'minutes') {
    return value >= 0 ? undefined : `${metric.displayName} can't be negative.`;
  }
  if (metric.max > metric.min && (value < metric.min || value > metric.max)) {
    return `${metric.displayName} takes ${metric.min}–${metric.max}, not ${formatNumber(value)}.`;
  }
  return undefined;
}

function suggestedValue(metric: Metric): string {
  if (metric.trackerType === 'minutes') return '20';
  if (metric.max > metric.min) return String(Math.round((metric.min + metric.max) / 2));
  return '1';
}

// ── Candidate matching ───────────────────────────────────────

interface Candidate {
  displayName: string;
  aliases: string[];
  item: ResolvedItem;
}

function buildCandidates(settings: VitalLogSettings, scope: Scope): Candidate[] {
  const symptoms: Candidate[] = activeSymptoms(settings).map((symptom) => ({
    displayName: symptom.displayName,
    aliases: aliasesOfSymptom(symptom),
    item: { kind: 'symptom' as const, symptom },
  }));
  if (scope === 'symptoms') return symptoms;

  const candidates: Candidate[] = activeVitamins(settings).map((vitamin) => ({
    displayName: vitamin.displayName,
    aliases: aliasesOfVitamin(vitamin),
    item: { kind: 'vitamin' as const, vitamin },
  }));

  if (scope === 'vitamins') return candidates;
  candidates.push(...symptoms);

  // Unsupported metric types stay in the pool deliberately: naming one should
  // report "can't log those yet", not "no such item".
  for (const metric of activeMetrics(settings)) {
    candidates.push({
      displayName: metric.displayName,
      aliases: aliasesOfMetric(metric),
      item: { kind: 'metric' as const, metric },
    });
  }

  return candidates;
}

interface CandidateMatches {
  matches: Candidate[];
  /** True only for a whole-alias hit — callers use this to rank readings. */
  exact: boolean;
}

function matchCandidates(candidates: Candidate[], needle: string): CandidateMatches {
  const target = normalizeName(needle);
  if (!target) return { matches: [], exact: false };

  const exact = candidates.filter((c) => c.aliases.some((alias) => alias === target));
  if (exact.length > 0) return { matches: exact, exact: true };

  const prefix = candidates.filter((c) => c.aliases.some((alias) => alias.startsWith(target)));
  if (prefix.length > 0) return { matches: prefix, exact: false };

  const substring = candidates.filter((c) => c.aliases.some((alias) => alias.includes(target)));
  return { matches: substring, exact: false };
}

function aliasesOfVitamin(vitamin: Vitamin): string[] {
  return uniqueNames([vitamin.displayName, vitamin.propertyKey]);
}

function aliasesOfSymptom(symptom: SymptomType): string[] {
  return uniqueNames([symptom.displayName]);
}

function aliasesOfMetric(metric: Metric): string[] {
  // valueName is included so "/mood 4" matches the Mood metric whose
  // propertyKey is "moodLog", and so a metric can be addressed by the field
  // name that shows up in frontmatter.
  return uniqueNames([metric.displayName, metric.propertyKey, metric.valueName]);
}

function uniqueNames(names: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const normalized = normalizeName(name);
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Logging ──────────────────────────────────────────────────

async function log(
  app: App,
  settings: VitalLogSettings,
  command: ParsedLogCommand,
  opts?: LogOpts
): Promise<LogResult> {
  const base = opts?.date ?? new Date();
  const targetDate = resolveTargetDate(command, base);
  const time = command.time ?? formatTime(base);

  let file: TFile | null;
  try {
    file = await resolveDailyNote(app, settings, targetDate);
  } catch (error) {
    return failure(`Could not open the daily note: ${errorText(error)}`);
  }
  if (!file) {
    return failure(`Could not create the daily note for ${formatDate(targetDate)}.`);
  }

  try {
    if (command.kind === 'symptom') {
      const symptom = activeSymptoms(settings).find((t) => t.id === command.symptomId);
      if (!symptom) return failure('That symptom no longer exists in Vital Log settings.');
      await logSymptom(
        app,
        file,
        { time, name: symptom.displayName, severity: command.severity, note: command.note },
        settings,
        opts?.appendToNote ?? settings.appendToNoteDefault_symptoms ?? false
      );
      return {
        ok: true,
        notePath: file.path,
        summary: summarize(
          command.severity === 0 ? `${symptom.displayName} gone` : `${symptom.displayName} ${command.severity}/10`,
          time,
          file,
          command.note
        ),
      };
    }

    if (command.kind === 'vitamin') {
      const vitamin = activeVitamins(settings).find((v) => v.id === command.vitaminId);
      if (!vitamin) return failure('That supplement no longer exists in Vital Log settings.');

      await logVitamin(
        app,
        file,
        vitamin,
        {
          time,
          amount: command.amount,
          note: command.note,
          source: opts?.source ?? 'manual',
          appendToNote: opts?.appendToNote ?? settings.appendToNoteDefault_supplements ?? false,
        },
        settings
      );

      return {
        ok: true,
        notePath: file.path,
        summary: summarize(
          `${vitamin.displayName} ${formatNumber(command.amount)}${vitamin.unit}`,
          time,
          file,
          command.note
        ),
      };
    }

    const metric = activeMetrics(settings).find((m) => m.id === command.metricId);
    if (!metric) return failure('That metric no longer exists in Vital Log settings.');

    await logTracker(
      app,
      file,
      metric,
      {
        time,
        value: command.value,
        note: command.note,
        appendToNote: opts?.appendToNote ?? settings.appendToNoteDefault_trackers ?? false,
      },
      settings
    );

    const unit = metric.trackerType === 'minutes' ? ' min' : '';
    return {
      ok: true,
      notePath: file.path,
      summary: summarize(
        `${metric.displayName} ${formatNumber(command.value)}${unit}`,
        time,
        file,
        command.note
      ),
    };
  } catch (error) {
    // yamlManager aborts through a Notice, which nobody outside Obsidian ever
    // sees. Convert it into something the caller can relay back to its user.
    return failure(abortText(error) ?? `Could not write to "${file.basename}": ${errorText(error)}`);
  }
}

function summarize(what: string, time: string, file: TFile, note?: string): string {
  const suffix = note ? ` — ${note}` : '';
  return `${what} @ ${time} → ${file.basename}${suffix}`;
}

function failure(message: string): LogResult {
  return { ok: false, summary: message, error: message };
}

/** Recognise yamlManager's AbortError structurally — the class is not exported. */
function abortText(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'AbortError') return undefined;
  const reason = (error as Error & { reason?: string }).reason;
  if (reason === 'malformed-frontmatter') {
    return "The daily note's frontmatter could not be parsed, so nothing was written. Fix the YAML and try again.";
  }
  return `Nothing was written: ${error.message}.`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveTargetDate(command: ParsedLogCommand, base: Date): Date {
  const date = new Date(base.getTime());
  if (command.date) {
    const [year, month, day] = command.date.split('-').map(Number);
    // Set the day first so a month with fewer days can't roll the date over.
    date.setDate(1);
    date.setFullYear(year, month - 1, day);
  }
  if (command.dayOffset) {
    date.setDate(date.getDate() + command.dayOffset);
  }
  return date;
}

// ── Small helpers ────────────────────────────────────────────

function activeVitamins(settings: VitalLogSettings): Vitamin[] {
  return (settings.vitamins ?? []).filter((v) => !v.archived);
}

function activeSymptoms(settings: VitalLogSettings): SymptomType[] {
  return (settings.symptomTypes ?? []).filter((t) => !t.archived);
}

function activeMetrics(settings: VitalLogSettings): Metric[] {
  return (settings.metrics ?? []).filter((m) => !m.archived);
}

function isSupportedMetric(metric: Metric): boolean {
  return metric.trackerType !== 'tally' && metric.trackerType !== 'checkbox';
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
