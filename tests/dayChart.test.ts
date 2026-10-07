import { describe, it, expect } from 'vitest';
import { minutesOf, hourRange, stackRows } from '../src/dayChart';

describe('minutesOf', () => {
  it('parses HH:mm', () => {
    expect(minutesOf('08:31')).toBe(511);
    expect(minutesOf('8:05')).toBe(485);
  });

  it('rejects anything else', () => {
    expect(minutesOf(null)).toBeNull();
    expect(minutesOf('morning')).toBeNull();
    expect(minutesOf('25:00')).toBeNull();
  });
});

describe('hourRange', () => {
  it('defaults to 06–22 with nothing to plot', () => {
    expect(hourRange([])).toEqual([6, 22]);
  });

  it('keeps 06–22 when everything falls inside it', () => {
    expect(hourRange([8 * 60 + 31, 14 * 60])).toEqual([6, 22]);
  });

  it('widens for early and late entries', () => {
    expect(hourRange([4 * 60 + 10, 23 * 60 + 30])).toEqual([4, 24]);
  });
});

describe('stackRows', () => {
  it('puts dots that would overlap on new rows', () => {
    expect(stackRows([10, 12, 14, 40], 18, 4)).toEqual([0, 1, 2, 0]);
  });

  it('reuses a row once a dot clears it', () => {
    expect(stackRows([10, 20, 30], 18, 4)).toEqual([0, 1, 0]);
  });

  it('overlaps on the top row when out of rows', () => {
    expect(stackRows([10, 10, 10], 18, 2)).toEqual([0, 1, 1]);
  });
});
