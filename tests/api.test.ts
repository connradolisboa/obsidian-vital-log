import { describe, it, expect, beforeEach } from 'vitest';
import { App, TFile, notices, resetNotices } from './stubs/obsidian';
import { createVitalLogApi } from '../src/api';
import type { ParseOutcome, VitalLogApi } from '../src/api';
import * as yaml from '../src/yamlManager';
import { DEFAULT_SETTINGS } from '../src/types';
import type { Metric, VitalLogSettings, Vitamin } from '../src/types';

// ── Fixtures ─────────────────────────────────────────────────
// Modelled on a real configuration: two vitamins sharing a first letter (so
// ambiguity is reachable), a multi-word name, and one metric of each type.

const ritalin: Vitamin = {
  id: 'v1', displayName: 'Ritalin', propertyKey: 'Ritalin', defaultAmount: 10, unit: 'mg',
};
const theanine: Vitamin = {
  id: 'v2', displayName: 'Theanine', propertyKey: 'Theanine', defaultAmount: 250, unit: 'mg',
};
const tyrosine: Vitamin = {
  id: 'v3', displayName: 'Tyrosine', propertyKey: 'Tyrosine', defaultAmount: 250, unit: 'mg',
};
const vitaminC: Vitamin = {
  id: 'v4', displayName: 'Vitamin C', propertyKey: 'vitaminC', defaultAmount: 500, unit: 'mg',
};
const retired: Vitamin = {
  id: 'v5', displayName: 'Zinc', propertyKey: 'Zinc', defaultAmount: 15, unit: 'mg', archived: true,
};

function metric(over: Partial<Metric> & Pick<Metric, 'id' | 'displayName' | 'propertyKey'>): Metric {
  return {
    icon: 'activity', trackerType: 'rating', valueName: '', min: 1, max: 5, target: 0, step: 1,
    ...over,
  };
}

const mood = metric({ id: 'm1', displayName: 'Mood', propertyKey: 'moodLog', valueName: 'mood' });
const energy = metric({ id: 'm2', displayName: 'Energy', propertyKey: 'energyLog', valueName: 'energy' });
const libido = metric({ id: 'm3', displayName: 'Libido', propertyKey: 'libidoLog', valueName: 'intensity' });
const meditation = metric({
  id: 'm4', displayName: 'Meditation', propertyKey: 'meditationLog',
  trackerType: 'minutes', valueName: 'minutes', min: 0, max: 0,
});
const outreach = metric({
  id: 'm5', displayName: 'Outreach', propertyKey: 'outreachTally',
  trackerType: 'tally', valueName: '', min: 0, max: 0, target: 10,
});

function settings(overrides: Partial<VitalLogSettings> = {}): VitalLogSettings {
  return {
    ...DEFAULT_SETTINGS,
    dailyNotePath: 'Daily/{{YYYY-MM-DD}}',
    vitamins: [ritalin, theanine, tyrosine, vitaminC, retired],
    metrics: [mood, energy, libido, meditation, outreach],
    ...overrides,
  };
}

function api(overrides: Partial<VitalLogSettings> = {}): { api: VitalLogApi; app: App } {
  const app = new App();
  const config = settings(overrides);
  return { app, api: createVitalLogApi(app as never, () => config) };
}

/** Parse and assert success, returning the command. */
function parsed(text: string, overrides: Partial<VitalLogSettings> = {}) {
  const outcome = api(overrides).api.parseCommand(text);
  if (!outcome.ok) throw new Error(`expected "${text}" to parse, got: ${outcome.message}`);
  return outcome.command;
}

/** Parse and assert failure, returning the outcome. */
function failed(text: string, overrides: Partial<VitalLogSettings> = {}): Extract<ParseOutcome, { ok: false }> {
  const outcome = api(overrides).api.parseCommand(text);
  if (outcome.ok) throw new Error(`expected "${text}" to fail, got: ${JSON.stringify(outcome.command)}`);
  return outcome;
}

async function fm(app: App, path: string): Promise<Record<string, unknown>> {
  return yaml.readAllFrontmatter(app as never, new TFile(path) as never);
}

beforeEach(resetNotices);

// ── Name resolution ──────────────────────────────────────────

describe('parseCommand — name resolution', () => {
  it('matches a metric by display name', () => {
    expect(parsed('mood 4')).toEqual({
      kind: 'metric', metricId: 'm1', value: 4,
      time: undefined, date: undefined, dayOffset: undefined, note: undefined,
    });
  });

  it('ignores a leading slash', () => {
    expect(parsed('/mood 4')).toMatchObject({ kind: 'metric', metricId: 'm1', value: 4 });
  });

  it('matches a metric by its valueName, which need not equal its name', () => {
    expect(parsed('intensity 3')).toMatchObject({ metricId: 'm3', value: 3 });
  });

  it('matches a vitamin by propertyKey', () => {
    expect(parsed('vitaminC 500')).toMatchObject({ kind: 'vitamin', vitaminId: 'v4' });
  });

  it('prefers the longest multi-word name over a shorter prefix match', () => {
    expect(parsed('Vitamin C 500')).toMatchObject({ kind: 'vitamin', vitaminId: 'v4', amount: 500 });
  });

  it('resolves a unique prefix', () => {
    expect(parsed('rit 10')).toMatchObject({ vitaminId: 'v1', amount: 10 });
  });

  it('resolves a unique substring when no prefix matches', () => {
    expect(parsed('rosine 250')).toMatchObject({ vitaminId: 'v3' });
  });

  it('reports ambiguity with candidates rather than guessing', () => {
    const outcome = failed('t 100');
    expect(outcome.reason).toBe('ambiguous');
    expect(outcome.candidates).toEqual(expect.arrayContaining(['Theanine', 'Tyrosine']));
  });

  it('reports no-match for an unknown name', () => {
    expect(failed('xyzzy 3').reason).toBe('no-match');
  });

  it('skips archived items', () => {
    expect(failed('zinc 15').reason).toBe('no-match');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(parsed('  RITALIN   10  ')).toMatchObject({ vitaminId: 'v1', amount: 10 });
  });
});

// ── Command prefixes ─────────────────────────────────────────

describe('parseCommand — command prefixes', () => {
  it('strips /med rather than prefix-matching it to Meditation', () => {
    // "med" is a genuine prefix of the Meditation metric, so the prefix
    // reading has to outrank the fuzzy direct one.
    expect(parsed('/med ritalin 20')).toMatchObject({ kind: 'vitamin', vitaminId: 'v1', amount: 20 });
  });

  it('restricts /med to vitamins, and says so', () => {
    const outcome = failed('/med mood 4');
    expect(outcome.reason).toBe('no-match');
    expect(outcome.message).toContain('med or supplement');
    expect(outcome.message).not.toContain('metric');
  });

  it('accepts /log as a scope-free prefix', () => {
    expect(parsed('/log mood 4')).toMatchObject({ metricId: 'm1', value: 4 });
  });

  it('still resolves an exact name that happens to be a prefix word', () => {
    expect(parsed('meditation 20')).toMatchObject({ metricId: 'm4', value: 20 });
  });

  it('treats a followed prefix as authoritative, but hints at the fuzzy reading', () => {
    // "med 20" could mean the Meditation metric, but "med" is also the
    // supplement prefix. Guessing either way silently is worse than saying so.
    const outcome = failed('med 20');
    expect(outcome.reason).toBe('no-match');
    expect(outcome.message).toContain('Meditation');
  });

  it('falls back to the fuzzy direct match for a bare prefix word', () => {
    const outcome = failed('med');
    expect(outcome.reason).toBe('bad-value');
    expect(outcome.message).toContain('Meditation');
  });

  it('rejects an empty command', () => {
    expect(failed('').reason).toBe('empty');
    expect(failed('/').reason).toBe('empty');
  });
});

// ── Values, notes, modifiers ─────────────────────────────────

describe('parseCommand — values and notes', () => {
  it('falls back to a vitamin default amount', () => {
    expect(parsed('ritalin')).toMatchObject({ vitaminId: 'v1', amount: 10 });
  });

  it('ignores a trailing unit on the amount', () => {
    expect(parsed('ritalin 20mg')).toMatchObject({ amount: 20 });
  });

  it('accepts decimals with either separator', () => {
    expect(parsed('ritalin 2.5')).toMatchObject({ amount: 2.5 });
    expect(parsed('ritalin 2,5')).toMatchObject({ amount: 2.5 });
  });

  it('treats everything after the value as a note', () => {
    expect(parsed('energy 2 crashed after lunch')).toMatchObject({
      metricId: 'm2', value: 2, note: 'crashed after lunch',
    });
  });

  it('keeps digits inside a note once the value is taken', () => {
    expect(parsed('energy 2 crashed after 3pm')).toMatchObject({ value: 2, note: 'crashed after 3pm' });
  });

  it('requires a value for a metric', () => {
    const outcome = failed('mood');
    expect(outcome.reason).toBe('bad-value');
    expect(outcome.message).toContain('needs a value');
  });

  it('rejects a rating outside its range', () => {
    const outcome = failed('mood 9');
    expect(outcome.reason).toBe('bad-value');
    expect(outcome.message).toContain('1–5');
  });

  it('accepts any non-negative duration for a minutes metric', () => {
    expect(parsed('meditation 90')).toMatchObject({ metricId: 'm4', value: 90 });
    expect(failed('meditation -5').reason).toBe('bad-value');
  });

  it('reports tally metrics as unsupported rather than unknown', () => {
    const outcome = failed('outreach 3');
    expect(outcome.reason).toBe('unsupported');
    expect(outcome.message).toContain('Outreach');
  });
});

describe('parseCommand — time and date modifiers', () => {
  it('reads @HH:mm', () => {
    expect(parsed('focus 3 @09:15', { metrics: [metric({ id: 'm9', displayName: 'Focus', propertyKey: 'focusLog', valueName: 'focus' })] }))
      .toMatchObject({ value: 3, time: '09:15' });
  });

  it('zero-pads a single-digit hour', () => {
    expect(parsed('mood 4 @9:05')).toMatchObject({ time: '09:05' });
  });

  it('reads "yesterday" as a day offset', () => {
    expect(parsed('mood 4 yesterday')).toMatchObject({ value: 4, dayOffset: -1 });
  });

  it('reads an absolute date, with the clock as a separate token', () => {
    expect(parsed('mood 4 @2026-08-26 14:30')).toMatchObject({
      value: 4, date: '2026-08-26', time: '14:30',
    });
  });

  it('reads an absolute date joined to its time', () => {
    expect(parsed('mood 4 @2026-08-26T14:30')).toMatchObject({ date: '2026-08-26', time: '14:30' });
  });

  it('does not mistake note text for a time', () => {
    expect(parsed('mood 4 felt 7:30 ish')).toMatchObject({ time: undefined, note: 'felt 7:30 ish' });
  });

  it('rejects an impossible clock, leaving it in the note', () => {
    expect(parsed('mood 4 @99:99')).toMatchObject({ time: undefined, note: '@99:99' });
  });
});

// ── describe() ───────────────────────────────────────────────

describe('describe', () => {
  it('lists active items and flags unsupported metric types', () => {
    const catalogue = api().api.describe();

    expect(catalogue.vitamins.map((v) => v.displayName)).toEqual([
      'Ritalin', 'Theanine', 'Tyrosine', 'Vitamin C',
    ]);
    expect(catalogue.metrics.find((m) => m.id === 'm5')).toMatchObject({
      displayName: 'Outreach', supported: false,
    });
    expect(catalogue.metrics.find((m) => m.id === 'm1')).toMatchObject({ supported: true });
  });
});

// ── log() ────────────────────────────────────────────────────

describe('log', () => {
  const at = (iso: string) => new Date(iso);

  it('writes a metric entry into the resolved daily note', async () => {
    const { app, api: vl } = api();

    const result = await vl.logText('mood 4', { date: at('2026-08-27T14:30:00') });

    expect(result.ok).toBe(true);
    expect(result.notePath).toBe('Daily/2026-08-27.md');
    expect(await fm(app, 'Daily/2026-08-27.md')).toMatchObject({
      moodLog: [{ time: '14:30', mood: 4 }],
    });
  });

  it('writes a vitamin entry with its unit and source', async () => {
    const { app, api: vl } = api();

    const result = await vl.logText('ritalin', { date: at('2026-08-27T09:00:00'), source: 'telegram' });

    expect(result.ok).toBe(true);
    expect(await fm(app, 'Daily/2026-08-27.md')).toMatchObject({
      Ritalin: [{ time: '09:00', amount: 10, unit: 'mg', source: 'telegram' }],
    });
  });

  it('summarises what was logged', async () => {
    const { api: vl } = api();

    const result = await vl.logText('ritalin 20 with food', { date: at('2026-08-27T09:00:00') });

    expect(result.summary).toBe('Ritalin 20mg @ 09:00 → 2026-08-27 — with food');
  });

  it('uses the message time, not the wall clock, so backfill is correct', async () => {
    const { app, api: vl } = api();

    await vl.logText('mood 3', { date: at('2026-08-27T06:05:00') });

    expect(await fm(app, 'Daily/2026-08-27.md')).toMatchObject({ moodLog: [{ time: '06:05' }] });
  });

  it('routes "yesterday" into the previous day\'s note', async () => {
    const { app, api: vl } = api();

    await vl.logText('mood 4 yesterday', { date: at('2026-03-01T10:00:00') });

    expect(await fm(app, 'Daily/2026-02-28.md')).toMatchObject({ moodLog: [{ mood: 4 }] });
  });

  it('honours an absolute date without rolling the month over', async () => {
    const { app, api: vl } = api();

    // 31 January as the reference date: setting month to February first would
    // overflow into March if the day were not set before the month.
    await vl.logText('mood 4 @2026-02-05 08:00', { date: at('2026-01-31T23:00:00') });

    expect(await fm(app, 'Daily/2026-02-05.md')).toMatchObject({ moodLog: [{ time: '08:00', mood: 4 }] });
  });

  it('appends to an existing note rather than replacing it', async () => {
    const { app, api: vl } = api();
    app.vault.create('Daily/2026-08-27.md', '---\ntitle: Thursday\n---\nbody\n');

    await vl.logText('mood 4', { date: at('2026-08-27T14:30:00') });
    await vl.logText('mood 2', { date: at('2026-08-27T20:00:00') });

    expect(await fm(app, 'Daily/2026-08-27.md')).toMatchObject({
      title: 'Thursday',
      moodLog: [{ time: '14:30', mood: 4 }, { time: '20:00', mood: 2 }],
    });
  });

  it('reports a parse failure without touching the vault', async () => {
    const { app, api: vl } = api();

    const result = await vl.logText('xyzzy 3', { date: at('2026-08-27T14:30:00') });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('xyzzy');
    expect(app.vault.getAbstractFileByPath('Daily/2026-08-27.md')).toBeNull();
  });

  it('surfaces malformed frontmatter as an error instead of a bare Notice', async () => {
    const { app, api: vl } = api();
    app.vault.create('Daily/2026-08-27.md', '---\n: : broken\n  - [\n---\nbody\n');

    const result = await vl.logText('mood 4', { date: at('2026-08-27T14:30:00') });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('frontmatter');
    // The Notice still fires for in-app users; the point is that the caller
    // also gets something it can relay.
    expect(notices.join(' ')).toContain('Could not parse');
  });

  it('writes a body line when the setting asks for one', async () => {
    const { app, api: vl } = api({ appendToNoteDefault_trackers: true });

    await vl.logText('mood 4', { date: at('2026-08-27T14:30:00') });

    expect(app.vault.raw('Daily/2026-08-27.md')).toContain('14:30');
  });
});
