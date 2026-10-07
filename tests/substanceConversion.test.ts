import { describe, it, expect } from 'vitest';
import { App } from './stubs/obsidian';
import { convertFrontmatter, planConversion, applyConversion } from '../src/substanceConversion';
import * as yaml from '../src/yamlManager';
import { DEFAULT_SETTINGS } from '../src/types';
import type { VitalLogSettings, Vitamin } from '../src/types';

const vyvanse: Vitamin = { id: 'v1', displayName: 'Vyvanse', propertyKey: 'Vyvanse', defaultAmount: 50, unit: 'mg' };
const lamotrigine: Vitamin = { id: 'v2', displayName: 'Lamotrigine', propertyKey: 'Lamotrigine', defaultAmount: 50, unit: 'mg' };

function settings(overrides: Partial<VitalLogSettings> = {}): VitalLogSettings {
  return {
    ...DEFAULT_SETTINGS,
    vitamins: [vyvanse, lamotrigine],
    logMode: 'substances',
    logSource: false,
    logUnit: false,
    ...overrides,
  };
}

describe('convertFrontmatter', () => {
  it('folds per-vitamin lists into substances, dropping source and redundant unit', () => {
    const fm: Record<string, unknown> = {
      Vyvanse: [{ time: '08:31', amount: 50, unit: 'mg', source: 'manual' }],
      Lamotrigine: [{ time: '08:31', amount: 50, unit: 'mg', source: 'manual' }],
      dayRate: 4,
    };

    const result = convertFrontmatter(fm, settings());

    expect(result).toEqual({ converted: 2, trimmed: 0 });
    expect(fm).toEqual({
      dayRate: 4,
      substances: [
        { name: 'Vyvanse', time: '08:31', amount: 50 },
        { name: 'Lamotrigine', time: '08:31', amount: 50 },
      ],
    });
    expect(Object.keys((fm['substances'] as object[])[0])).toEqual(['name', 'time', 'amount']);
  });

  it('keeps notes and a unit that differs from the configured one', () => {
    const fm: Record<string, unknown> = {
      Vyvanse: [{ time: '09:00', amount: 0.5, unit: 'g', note: 'half', source: 'manual' }],
    };

    convertFrontmatter(fm, settings());

    expect(fm['substances']).toEqual([{ name: 'Vyvanse', time: '09:00', amount: 0.5, unit: 'g', note: 'half' }]);
  });

  it('keeps unit and source when those settings are on', () => {
    const fm: Record<string, unknown> = {
      Vyvanse: [{ time: '09:00', amount: 50, unit: 'mg', source: 'manual' }],
    };

    convertFrontmatter(fm, settings({ logUnit: true, logSource: true }));

    expect(fm['substances']).toEqual([{ name: 'Vyvanse', time: '09:00', amount: 50, unit: 'mg', source: 'manual' }]);
  });

  it('appends to an existing list, leaving plain names alone, sorted by time', () => {
    const fm: Record<string, unknown> = {
      substances: ['Nicotine', { name: 'Caffeine', amount: 50, unit: 'mg', time: '11:00' }],
      Vyvanse: [{ time: '10:00', amount: 50, unit: 'mg' }],
      Lamotrigine: [{ time: '08:00', amount: 50, unit: 'mg' }],
    };

    const result = convertFrontmatter(fm, settings());

    expect(result).toEqual({ converted: 2, trimmed: 0 });
    expect(fm['substances']).toEqual([
      'Nicotine',
      { name: 'Caffeine', amount: 50, unit: 'mg', time: '11:00' },
      { name: 'Lamotrigine', time: '08:00', amount: 50 },
      { name: 'Vyvanse', time: '10:00', amount: 50 },
    ]);
  });

  it('fills an empty substances key', () => {
    const fm: Record<string, unknown> = { substances: null, Vyvanse: [{ time: '10:00', amount: 50 }] };

    convertFrontmatter(fm, settings());

    expect(fm['substances']).toEqual([{ name: 'Vyvanse', time: '10:00', amount: 50 }]);
  });

  it('trims existing substance entries for known vitamins', () => {
    const fm: Record<string, unknown> = {
      substances: [{ name: 'Vyvanse', amount: 50, unit: 'mg', time: '08:31', source: 'manual' }],
    };

    expect(convertFrontmatter(fm, settings())).toEqual({ converted: 0, trimmed: 1 });
    expect(fm['substances']).toEqual([{ name: 'Vyvanse', time: '08:31', amount: 50 }]);
  });

  it('leaves entries that are not plugin entries under their key', () => {
    const fm: Record<string, unknown> = {
      Vyvanse: [{ time: '10:00', amount: 50 }, 'took it'],
    };

    convertFrontmatter(fm, settings());

    expect(fm['Vyvanse']).toEqual(['took it']);
    expect(fm['substances']).toEqual([{ name: 'Vyvanse', time: '10:00', amount: 50 }]);
  });

  it('skips a note whose substances key is not a list', () => {
    const fm: Record<string, unknown> = { substances: 'Ritalin', Vyvanse: [{ time: '10:00', amount: 50 }] };

    const result = convertFrontmatter(fm, settings());

    expect(result.skipReason).toBeDefined();
    expect(fm['Vyvanse']).toEqual([{ time: '10:00', amount: 50 }]);
  });
});

describe('planConversion / applyConversion', () => {
  it('rewrites only the notes that need it', async () => {
    const app = new App();
    const old = app.vault.create(
      'Daily/a.md',
      '---\nVyvanse:\n  - time: "08:31"\n    amount: 50\n    unit: mg\n    source: manual\n---\nbody\n'
    );
    app.vault.create('Daily/b.md', '---\ndayRate: 3\n---\nother\n');

    const plan = await planConversion(app as never, settings());
    expect(plan.files.map((f) => f.path)).toEqual(['Daily/a.md']);
    expect(plan.converted).toBe(1);

    const failed = await applyConversion(app as never, settings(), plan.files as never);
    expect(failed).toEqual([]);
    expect(await yaml.readAllFrontmatter(app as never, old as never)).toEqual({
      substances: [{ name: 'Vyvanse', time: '08:31', amount: 50 }],
    });
    expect(app.vault.raw('Daily/a.md')).toContain('---\nbody\n');
    expect(app.vault.raw('Daily/b.md')).toBe('---\ndayRate: 3\n---\nother\n');
  });
});
