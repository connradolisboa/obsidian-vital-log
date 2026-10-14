// ============================================================
// Vital Log — reading a log command
//
// "ritalin 10 @09:15", "mood 4", "headache gone": text to a parsed command,
// against the settings' vocabulary. Pure: no Obsidian imports, so the
// Telegram Capture relay bundles this same file and reads commands exactly
// as Vital Log does while Obsidian is closed. Keep it that way; bump
// PARSER_VERSION when a command would read differently.
// ============================================================

import type { Metric, SymptomType, VitalLogSettings, Vitamin } from './types';
import { SYMPTOM_MAX } from './types';

/** Changes whenever the same text would parse differently. */
export const PARSER_VERSION = 1;

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

export function help(settings: VitalLogSettings): string {
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

export function parseCommand(settings: VitalLogSettings, text: string): ParseOutcome {
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

export function aliasesOfVitamin(vitamin: Vitamin): string[] {
  return uniqueNames([vitamin.displayName, vitamin.propertyKey]);
}

export function aliasesOfSymptom(symptom: SymptomType): string[] {
  return uniqueNames([symptom.displayName]);
}

export function aliasesOfMetric(metric: Metric): string[] {
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


// ── Small helpers ────────────────────────────────────────────

export function activeVitamins(settings: VitalLogSettings): Vitamin[] {
  return (settings.vitamins ?? []).filter((v) => !v.archived);
}

export function activeSymptoms(settings: VitalLogSettings): SymptomType[] {
  return (settings.symptomTypes ?? []).filter((t) => !t.archived);
}

export function activeMetrics(settings: VitalLogSettings): Metric[] {
  return (settings.metrics ?? []).filter((m) => !m.archived);
}

export function isSupportedMetric(metric: Metric): boolean {
  return metric.trackerType !== 'tally' && metric.trackerType !== 'checkbox';
}

export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** What a parsed command logs, as a reply says it: "Ritalin 10mg @ 09:12". */
export function commandSummary(settings: VitalLogSettings, command: ParsedLogCommand, time: string): string {
  const suffix = command.note ? ` — ${command.note}` : '';
  if (command.kind === 'symptom') {
    const symptom = activeSymptoms(settings).find((t) => t.id === command.symptomId);
    const name = symptom?.displayName ?? 'Symptom';
    return `${command.severity === 0 ? `${name} gone` : `${name} ${command.severity}/10`} @ ${command.time ?? time}${suffix}`;
  }
  if (command.kind === 'vitamin') {
    const vitamin = activeVitamins(settings).find((v) => v.id === command.vitaminId);
    return `${vitamin?.displayName ?? 'Supplement'} ${formatNumber(command.amount)}${vitamin?.unit ?? ''} @ ${command.time ?? time}${suffix}`;
  }
  const metric = activeMetrics(settings).find((m) => m.id === command.metricId);
  const unit = metric?.trackerType === 'minutes' ? ' min' : '';
  return `${metric?.displayName ?? 'Metric'} ${formatNumber(command.value)}${unit} @ ${command.time ?? time}${suffix}`;
}
