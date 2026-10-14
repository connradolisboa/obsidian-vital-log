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
//   5 — forms(), formStatus(form, path), renderForm(el, { form, path }, component)
//   6 — parserSettings(): the vocabulary and PARSER_VERSION, for a parser
//       running elsewhere (Telegram Capture's relay)
//   7 — reminders(date), logScheduled(id, opts), link(id): scheduled items
//       with reminder times, for the relay's reminders
// ============================================================

import { logicalDay } from './dayBoundary';
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
import {
  activeMetrics,
  activeSymptoms,
  activeVitamins,
  aliasesOfMetric,
  aliasesOfSymptom,
  aliasesOfVitamin,
  formatNumber,
  help,
  isSupportedMetric,
  pad2,
  parseCommand,
  type ParsedLogCommand,
  type ParseOutcome,
} from './commandParser';

export type { ParsedLogCommand, ParseFailureReason, ParseOutcome } from './commandParser';
export { PARSER_VERSION, commandSummary } from './commandParser';
import { PARSER_VERSION } from './commandParser';
import { logScheduled, scheduledReminders, type ScheduledReminder } from './scheduledReminders';
import { fromISODate } from './planManager';
export type { ScheduledReminder } from './scheduledReminders';

export const VITAL_LOG_API_VERSION = 7;

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

/** A custom modal, as a form other plugins can show (since version 5). */
export interface FormInfo {
  id: string;
  name: string;
  icon: string;
  /** Its note path template; empty for a modal that writes to the current note. */
  notePath: string;
  /** Its fields; `key` is `parentKey.propertyKey` for a nested one. */
  fields: Array<{ key: string; name: string; type: string }>;
}

/** Which of a form's fields a note has filled in (since version 5). */
export interface FormStatus {
  filled: string[];
  empty: string[];
}

export interface RenderFormOptions {
  /** The form's id or name. */
  form: string;
  /** The note to show and write to. It must exist; it is never created. */
  path: string;
  /** Fold under its header. */
  collapsible?: boolean;
}

export type RenderForm = (el: HTMLElement, opts: RenderFormOptions, component: Component) => void;

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
  /** The custom modals that are not archived, as forms (since version 5). */
  forms(): FormInfo[];
  /** Which fields of a form a note has filled, from the metadata cache; null without the form or the note (since version 5). */
  formStatus(form: string, path: string): FormStatus | null;
  /** Draw a form for one note, writing to that note only (since version 5). */
  renderForm: RenderForm;
  /**
   * What src/commandParser.ts needs to read commands as Vital Log does, and
   * the parser's version, for a copy of it running elsewhere (since version 6).
   */
  parserSettings(): ParserSettings;
  /** Scheduled items with reminder times due on a day (`YYYY-MM-DD`, today by default), and whether each is logged (since version 7). */
  reminders(date?: string): Promise<ScheduledReminder[]>;
  /** Log a scheduled item as its reminder's button asks (since version 7). */
  logScheduled(id: string, opts?: { date?: Date; value?: number }): Promise<{ ok: boolean; summary?: string; error?: string }>;
  /** `obsidian://vital-log?…` opening the log window on that item (since version 7). */
  link(id: string): string;
}

export interface ParserSettings {
  parserVersion: number;
  dayEndsAt: string;
  vitamins: Vitamin[];
  metrics: Metric[];
  symptomTypes: SymptomType[];
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
  renderDay: RenderDay = () => {},
  renderForm: RenderForm = () => {}
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
    forms: () => formsOf(getSettings()),
    formStatus: (form: string, path: string) => formStatusOf(app, getSettings(), form, path),
    renderForm,
    reminders: (date?: string) => scheduledReminders(app, getSettings(), date ? fromISODate(date) : undefined),
    logScheduled: (id: string, opts?: { date?: Date; value?: number }) => logScheduled(app, getSettings(), id, opts),
    link: (id: string) => `obsidian://vital-log?vault=${encodeURIComponent(app.vault.getName())}&item=${encodeURIComponent(id)}`,
    parserSettings: () => {
      const settings = getSettings();
      return {
        parserVersion: PARSER_VERSION,
        dayEndsAt: settings.dayEndsAt,
        vitamins: settings.vitamins ?? [],
        metrics: settings.metrics ?? [],
        symptomTypes: settings.symptomTypes ?? [],
      };
    },
  };
}

// ── describe / help ──────────────────────────────────────────

// ── Forms ────────────────────────────────────────────────────

const fieldKey = (f: { propertyKey: string; parentKey?: string }) => (f.parentKey ? `${f.parentKey}.${f.propertyKey}` : f.propertyKey);

export function formsOf(settings: VitalLogSettings): FormInfo[] {
  return settings.customModals.filter((m) => !m.archived).map((m) => ({
    id: m.id,
    name: m.displayName,
    icon: m.icon,
    notePath: m.notePath,
    fields: m.items.flatMap((item) => (item.type === 'field'
      ? [{ key: fieldKey(item.field), name: item.field.displayName, type: item.field.fieldType }]
      : [])),
  }));
}

/** A value counts as filled unless it is missing, empty text or an empty list. */
function isFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function formStatusOf(app: App, settings: VitalLogSettings, form: string, path: string): FormStatus | null {
  const config = settings.customModals.find((m) => m.id === form) ?? settings.customModals.find((m) => m.displayName.toLowerCase() === form.toLowerCase());
  const file = app.vault.getAbstractFileByPath(path);
  if (!config || !(file instanceof TFile)) return null;
  const fm = (app.metadataCache.getFileCache(file)?.frontmatter ?? {}) as Record<string, unknown>;
  const out: FormStatus = { filled: [], empty: [] };
  for (const item of config.items) {
    if (item.type !== 'field') continue;
    const f = item.field;
    const parent = f.parentKey ? fm[f.parentKey] : fm;
    const value = parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[f.propertyKey] : undefined;
    (isFilled(value) ? out.filled : out.empty).push(fieldKey(f));
  }
  return out;
}

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

// ── Logging ──────────────────────────────────────────────────

async function log(
  app: App,
  settings: VitalLogSettings,
  command: ParsedLogCommand,
  opts?: LogOpts
): Promise<LogResult> {
  const base = opts?.date ?? new Date();
  // The note follows the day as the user counts it; the time stays the clock's.
  const targetDate = resolveTargetDate(command, logicalDay(base));
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





function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}


