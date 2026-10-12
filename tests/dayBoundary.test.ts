import { afterEach, describe, expect, it } from 'vitest';
import {
  dayEndMinutes, dayEndsAt, dayMinutes, initDayBoundary, isLateNight, logicalDay, logicalTodayISO, parseDayEnd, sharedDayEnd,
} from '../src/dayBoundary';
import { hourRange } from '../src/dayChart';

const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi);

/** An app whose plugin list holds Management Tracker's API, or nothing. */
const appWith = (api: unknown) => ({ plugins: { plugins: api ? { 'management-tracker': { api } } : {} } }) as never;
const mtApi = (dayEnd: string, version = 2) => ({
  version, sessionsOn: () => [], onChange: () => () => {}, dayEndsAt: () => dayEnd,
});

describe('day boundary', () => {
  afterEach(() => initDayBoundary(appWith(null), () => '00:00'));

  it('reads a day end, and ignores midnight, afternoons and junk', () => {
    expect(parseDayEnd('03:00')).toBe(180);
    expect(parseDayEnd('4:30')).toBe(270);
    expect(parseDayEnd('00:00')).toBe(0);
    expect(parseDayEnd('15:00')).toBe(0);
    expect(parseDayEnd('nope')).toBe(0);
  });

  it('changes nothing at midnight', () => {
    expect(logicalTodayISO(at(2026, 10, 13, 1, 30), 0)).toBe('2026-10-13');
    expect(isLateNight('01:30', 0)).toBe(false);
    expect(dayMinutes(90, 0)).toBe(90);
  });

  it('keeps the day before until the day end, at the same clock time', () => {
    const day = logicalDay(at(2026, 10, 13, 1, 30), 180);
    expect(day.getDate()).toBe(12);
    expect(day.getHours()).toBe(1);
    expect(day.getMinutes()).toBe(30);
    expect(logicalTodayISO(at(2026, 10, 13, 3, 0), 180)).toBe('2026-10-13');
    expect(logicalTodayISO(at(2027, 1, 1, 0, 10), 180)).toBe('2026-12-31');
  });

  it('puts late-night times after 24:00', () => {
    expect(isLateNight('01:30', 180)).toBe(true);
    expect(isLateNight('03:00', 180)).toBe(false);
    expect(dayMinutes(90, 180)).toBe(1530);
    expect(dayMinutes(600, 180)).toBe(600);
    expect(hourRange([600, 1530], 27)).toEqual([6, 26]);
  });

  it('follows Management Tracker when it shares a day end, and its own setting otherwise', () => {
    initDayBoundary(appWith(null), () => '02:00');
    expect(sharedDayEnd()).toBeNull();
    expect(dayEndsAt()).toBe('02:00');
    expect(dayEndMinutes()).toBe(120);

    initDayBoundary(appWith(mtApi('04:00')), () => '02:00');
    expect(sharedDayEnd()).toBe('04:00');
    expect(dayEndMinutes()).toBe(240);

    // An older Management Tracker (API v1) shares nothing.
    initDayBoundary(appWith(mtApi('04:00', 1)), () => '02:00');
    expect(sharedDayEnd()).toBeNull();
    expect(dayEndMinutes()).toBe(120);
  });
});
