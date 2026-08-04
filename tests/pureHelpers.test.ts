import { describe, it, expect } from 'vitest';
import { resolvePathTemplate, pathMatchesTemplate, extractDateFromPath, findUnknownPathTokens } from '../src/dailyNoteResolver';
import { computeStat, extractTrackerValues, readTallyValue, readCheckboxValue } from '../src/statsEngine';
import { applyTemplate } from '../src/template';
import { validateKeyFormat, validatePropertyKey, findKeyCollision } from '../src/validation';
import type { TrackerConfig } from '../src/types';

const MARCH_10 = new Date(2025, 2, 10, 12, 0, 0); // a Monday

describe('date template parsing', () => {
  it('substitutes the compound date+weekday token', () => {
    expect(resolvePathTemplate('Daily/{{YYYY-MM-DD dddd}}', MARCH_10))
      .toBe('Daily/2025-03-10 Monday');
  });

  it('substitutes year, month, and day tokens', () => {
    expect(resolvePathTemplate('{{YYYY}}/{{MM}}/{{DD}}', MARCH_10)).toBe('2025/03/10');
  });

  it('substitutes quarter and month-name tokens', () => {
    expect(resolvePathTemplate('{{YYYY}}-Q{{Q}}/{{MMMM}}', MARCH_10)).toBe('2025-Q1/March');
  });

  it('resolves the longest token first, so {{YYYY-MM-DD}} is not split', () => {
    expect(resolvePathTemplate('{{YYYY-MM-DD}}', MARCH_10)).toBe('2025-03-10');
  });

  it('leaves unknown tokens untouched and reports them', () => {
    expect(findUnknownPathTokens('Daily/{{NOPE}}')).toContain('NOPE');
  });

  it('matches a path produced by its own template', () => {
    const template = 'Daily/{{YYYY-MM-DD}}';
    const path = `${resolvePathTemplate(template, MARCH_10)}.md`;
    expect(pathMatchesTemplate(path, template)).toBe(true);
  });

  it('rejects a path that the template could not have produced', () => {
    expect(pathMatchesTemplate('Notes/inbox.md', 'Daily/{{YYYY-MM-DD}}')).toBe(false);
  });

  it('recovers the date from a resolved path', () => {
    const template = 'Daily/{{YYYY-MM-DD}}';
    // Use a date within the ±5 year search window of today.
    const recent = new Date();
    recent.setHours(12, 0, 0, 0);
    recent.setDate(recent.getDate() - 30);

    const path = `${resolvePathTemplate(template, recent)}.md`;
    const found = extractDateFromPath(path, template);

    expect(found).not.toBeNull();
    expect(resolvePathTemplate(template, found!)).toBe(resolvePathTemplate(template, recent));
  });
});

describe('statistics', () => {
  const tracker = { propertyKey: 'moodLog', valueName: 'rating' } as TrackerConfig;

  it('extracts numeric values in entry order', () => {
    const fm = {
      moodLog: [
        { time: '09:00', rating: 3 },
        { time: '13:00', rating: 7 },
        { time: '21:00', rating: 5 },
      ],
    };
    expect(extractTrackerValues(fm, tracker)).toEqual([3, 7, 5]);
  });

  it('ignores entries missing the value name or a time', () => {
    const fm = {
      moodLog: [
        { time: '09:00', rating: 3 },
        { time: '13:00', note: 'no rating' },
        { rating: 99 },                      // no time — not a tracker entry
        { time: '21:00', rating: 5 },
      ],
    };
    expect(extractTrackerValues(fm, tracker)).toEqual([3, 5]);
  });

  it('returns an empty list for absent or non-list properties', () => {
    expect(extractTrackerValues(null, tracker)).toEqual([]);
    expect(extractTrackerValues({ moodLog: 5 }, tracker)).toEqual([]);
  });

  it.each([
    ['sum', 15],
    ['average', 5],
    ['min', 3],
    ['max', 7],
    ['count', 3],
    ['latest', 5],
  ] as const)('computes %s', (stat, expected) => {
    expect(computeStat([3, 7, 5], stat)).toBe(expected);
  });

  it('rounds averages to two decimals', () => {
    expect(computeStat([1, 2], 'average')).toBe(1.5);
    expect(computeStat([1, 1, 2], 'average')).toBe(1.33);
  });

  it('returns null for an empty series', () => {
    expect(computeStat([], 'sum')).toBeNull();
    expect(computeStat([], 'average')).toBeNull();
  });

  it('reads a tally value, defaulting to 0', () => {
    expect(readTallyValue({ water: { value: 6 } }, 'water')).toBe(6);
    expect(readTallyValue({ water: 'nope' }, 'water')).toBe(0);
    expect(readTallyValue(null, 'water')).toBe(0);
  });

  it('reads a checkbox value strictly', () => {
    expect(readCheckboxValue({ meditated: true }, 'meditated')).toBe(true);
    expect(readCheckboxValue({ meditated: 'true' }, 'meditated')).toBe(false);
    expect(readCheckboxValue(null, 'meditated')).toBe(false);
  });
});

describe('note-content templates', () => {
  it('substitutes known tokens', () => {
    expect(applyTemplate('- {time} {name} {amount}{unit}', {
      time: '09:00', name: 'Vitamin C', amount: '500', unit: 'mg',
    })).toBe('- 09:00 Vitamin C 500mg');
  });

  it('drops unknown tokens and collapses the gap they leave', () => {
    expect(applyTemplate('- {time} {name} {amount}{unit}', {
      time: '09:00', name: 'Morning Pack', amount: '', unit: '',
    })).toBe('- 09:00 Morning Pack');
  });

  it('leaves a template without tokens alone', () => {
    expect(applyTemplate('- logged', {})).toBe('- logged');
  });
});

describe('property key validation', () => {
  it('accepts letters, numbers, and underscores', () => {
    expect(validateKeyFormat('vitamin_C2')).toBeNull();
  });

  it.each([
    ['', /empty/i],
    ['has space', /space/i],
    ['has-dash', /letters, numbers/i],
  ])('rejects %j', (key, pattern) => {
    expect(validateKeyFormat(key)).toMatch(pattern);
  });

  it('still rejects dotted keys — nested properties are not supported yet', () => {
    expect(validateKeyFormat('health.bp')).toMatch(/letters, numbers/i);
  });

  it('detects a collision with another owner', () => {
    const owners = [{ id: 'a', key: 'mood', label: 'Mood' }];
    expect(findKeyCollision('mood', owners)).toEqual(owners[0]);
    expect(validatePropertyKey('mood', owners)).toMatch(/already used by "Mood"/);
  });

  it('does not flag an owner colliding with itself', () => {
    const owners = [{ id: 'a', key: 'mood', label: 'Mood' }];
    expect(validatePropertyKey('mood', owners, 'a')).toBeNull();
  });
});
