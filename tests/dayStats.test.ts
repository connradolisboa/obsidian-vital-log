import { describe, it, expect } from 'vitest';
import { collectDayLog, looseTime } from '../src/dayLog';
import { findInsights, heatmapRow, hourlyAverage } from '../src/dayStats';
import { DEFAULT_SETTINGS, seriesMetrics } from '../src/types';
import type { VitalLogSettings } from '../src/types';

const settings: VitalLogSettings = {
  ...DEFAULT_SETTINGS,
  vitamins: [{ id: 'v1', displayName: 'Theanine', propertyKey: 'Theanine', defaultAmount: 200, unit: 'mg' }],
  dayMarkers: [{ id: 'm1', label: 'Wake up', propertyKey: 'wakeUp', icon: 'sunrise' }],
};
const mood = DEFAULT_SETTINGS.metrics.find((m) => m.valueName === 'mood')!;

describe('looseTime', () => {
  it('reads the shapes found in hand-typed notes', () => {
    expect(looseTime('07:30')).toBe('07:30');
    expect(looseTime('7:05')).toBe('07:05');
    expect(looseTime(730)).toBe('07:30');
    expect(looseTime(2330)).toBe('23:30');
    expect(looseTime('0730')).toBe('07:30');
    expect(looseTime('2026-10-07T06:45:00')).toBe('06:45');
  });

  it('rejects blanks and nonsense', () => {
    expect(looseTime(null)).toBeNull();
    expect(looseTime(NaN)).toBeNull();
    expect(looseTime('')).toBeNull();
    expect(looseTime(799)).toBeNull();
    expect(looseTime('late')).toBeNull();
  });
});

describe('day markers', () => {
  it('collects configured time properties', () => {
    const log = collectDayLog({ wakeUp: 715 }, settings);
    expect(log.markers).toEqual([{ label: 'Wake up', time: '07:15', icon: 'sunrise' }]);
  });
});

describe('hourlyAverage', () => {
  it('averages readings per clock hour across days', () => {
    const logs = [
      collectDayLog({ moodLog: [{ time: '08:10', mood: 2 }, { time: '14:00', mood: 4 }] }, settings),
      collectDayLog({ moodLog: [{ time: '08:50', mood: 4 }] }, settings),
    ];
    expect(hourlyAverage(logs, mood.id)).toEqual([
      { minutes: 8 * 60 + 30, value: 3 },
      { minutes: 14 * 60 + 30, value: 4 },
    ]);
  });
});

describe('heatmapRow', () => {
  it('carries the latest reading forward between the first and last', () => {
    const log = collectDayLog({ moodLog: [{ time: '08:30', mood: 3 }, { time: '11:15', mood: 5 }] }, settings);
    expect(heatmapRow(log, mood.id, 6, 14)).toEqual([null, null, 3, 3, 3, 5, null, null]);
  });

  it('is all null without readings', () => {
    expect(heatmapRow(collectDayLog({}, settings), mood.id, 6, 9)).toEqual([null, null, null]);
  });
});

describe('findInsights', () => {
  const day = (theanine: boolean, moodValue: number, wake: string) =>
    collectDayLog({
      wakeUp: wake,
      moodLog: [{ time: '12:00', mood: moodValue }],
      ...(theanine ? { substances: [{ name: 'Theanine', time: '09:00', amount: 200 }] } : {}),
    }, settings);

  it('reports a substance that splits the tracker average', () => {
    const logs = [
      day(true, 4, '07:00'), day(true, 5, '09:00'), day(true, 4, '07:10'),
      day(false, 2, '09:10'), day(false, 3, '07:20'), day(false, 2, '09:20'),
    ];
    const insights = findInsights(logs, seriesMetrics(settings));
    const theanine = insights.find((i) => i.subject === 'Theanine');
    expect(theanine).toMatchObject({ withDays: 3, withoutDays: 3 });
    expect(theanine!.delta).toBeCloseTo(2);
  });

  it('needs at least three days on each side', () => {
    const logs = [day(true, 5, '07:00'), day(true, 5, '07:00'), day(false, 1, '07:00'), day(false, 1, '07:00')];
    expect(findInsights(logs, seriesMetrics(settings)).find((i) => i.subject === 'Theanine')).toBeUndefined();
  });
});
