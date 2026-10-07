import { describe, it, expect } from 'vitest';
import { collectDayLog, substanceTotals, timeline, isEmptyDay } from '../src/dayLog';
import { DEFAULT_SETTINGS } from '../src/types';
import type { VitalLogSettings } from '../src/types';

const settings: VitalLogSettings = {
  ...DEFAULT_SETTINGS,
  vitamins: [
    { id: 'v1', displayName: 'Vyvanse', propertyKey: 'Vyvanse', defaultAmount: 50, unit: 'mg' },
    { id: 'v2', displayName: 'Ritalin', propertyKey: 'Ritalin', defaultAmount: 10, unit: 'mg' },
  ],
  eventTypes: [{ id: 'e1', displayName: 'Sick', icon: 'thermometer' }],
};

describe('collectDayLog', () => {
  it('reads substances[], per-vitamin keys and plain names together', () => {
    const log = collectDayLog({
      substances: [
        { name: 'Vyvanse', time: '08:31', amount: 50 },
        'Nicotine',
        { name: 'Vitamin D', time: '11:00', amount: 2000, unit: 'ui' },
      ],
      Ritalin: [{ time: '14:00', amount: 10, unit: 'mg', source: 'manual' }],
    }, settings);

    expect(log.doses).toEqual([
      { name: 'Nicotine', time: null, amount: null, unit: '' },
      { name: 'Vyvanse', time: '08:31', amount: 50, unit: 'mg' },
      { name: 'Vitamin D', time: '11:00', amount: 2000, unit: 'ui' },
      { name: 'Ritalin', time: '14:00', amount: 10, unit: 'mg' },
    ]);
  });

  it('collects trackers, tallies, habits and events', () => {
    const log = collectDayLog({
      moodLog: [{ time: '09:00', mood: 3 }, { time: '07:00', mood: 4, note: 'rested' }],
      events: [{ time: '10:00', name: 'sick', severity: 3 }],
    }, settings);

    expect(log.trackers).toHaveLength(1);
    expect(log.trackers[0].readings).toEqual([
      { time: '07:00', value: 4, note: 'rested' },
      { time: '09:00', value: 3 },
    ]);
    expect(log.events).toEqual([{ name: 'sick', time: '10:00', severity: 3, icon: 'thermometer' }]);
  });

  it('treats a note with only a template-empty substances key as empty', () => {
    expect(isEmptyDay(collectDayLog({ substances: null, dayRate: 4 }, settings))).toBe(true);
  });
});

describe('substanceTotals', () => {
  it('sums doses per substance and lists their times', () => {
    const log = collectDayLog({
      substances: [
        { name: 'Vyvanse', time: '08:00', amount: 30 },
        { name: 'Ritalin', time: '09:00', amount: 10 },
        { name: 'Vyvanse', time: '13:00', amount: 20 },
      ],
    }, settings);

    expect(substanceTotals(log)).toEqual([
      { name: 'Vyvanse', unit: 'mg', total: 50, times: ['08:00', '13:00'], doses: 2 },
      { name: 'Ritalin', unit: 'mg', total: 10, times: ['09:00'], doses: 1 },
    ]);
  });
});

describe('timeline', () => {
  it('orders everything by time with untimed items first', () => {
    const log = collectDayLog({
      substances: [{ name: 'Vyvanse', time: '08:31', amount: 50 }],
      moodLog: [{ time: '07:00', mood: 4 }],
      events: [{ time: '12:00', name: 'Sick', severity: 2 }],
      packs: [{ time: '08:31', name: 'Morning Pack' }],
    }, settings);

    expect(timeline(log).map((i) => `${i.time} ${i.text}`)).toEqual([
      '07:00 Mood: 4',
      '08:31 Vyvanse 50mg',
      '08:31 Morning Pack',
      '12:00 Sick',
    ]);
  });
});
