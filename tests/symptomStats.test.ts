import { describe, it, expect } from 'vitest';
import { collectDayLog } from '../src/dayLog';
import { symptomCalendar, symptomEpisodes, symptomsNextDay, weeklySymptomTotals, type Day } from '../src/symptomStats';
import { DEFAULT_SETTINGS } from '../src/types';
import type { VitalLogSettings } from '../src/types';

const settings: VitalLogSettings = {
  ...DEFAULT_SETTINGS,
  dayMarkers: [{ id: 'm', label: 'Bed', propertyKey: 'bedTime' }],
};
const d = (day: number): Date => new Date(2026, 9, day, 12);
const sym = (time: string, name: string, severity: number) => ({ time, name, severity });
const carry = (name: string, severity: number) => new Map([[name.toLowerCase(), { name, severity }]]);

describe('symptomEpisodes', () => {
  it('follows a symptom across days until it is marked gone', () => {
    const days: Day[] = [
      { date: d(1), log: collectDayLog({ symptoms: [sym('15:08', 'Sick', 6)] }, settings) },
      { date: d(2), log: collectDayLog({ symptoms: [sym('09:00', 'Sick', 8)] }, settings, carry('Sick', 6)) },
      { date: d(3), log: collectDayLog({ symptoms: [sym('20:00', 'Sick', 0)] }, settings, carry('Sick', 8)) },
      { date: d(4), log: collectDayLog({}, settings) },
    ];
    const [ep] = symptomEpisodes(days);
    expect(ep).toMatchObject({
      name: 'Sick', startTime: '15:08', endTime: '20:00', days: 3, peak: 8, dailyPeaks: [6, 8, 8], startedBefore: false,
    });
    expect(ep.startDate).toEqual(d(1));
    expect(ep.endDate).toEqual(d(3));
  });

  it('leaves an unresolved symptom open', () => {
    const days: Day[] = [
      { date: d(1), log: collectDayLog({}, settings, carry('Sick', 5)) },
      { date: d(2), log: null },
    ];
    expect(symptomEpisodes(days)[0]).toMatchObject({ endDate: null, startedBefore: true, days: 1 });
  });
});

describe('symptomCalendar and weekly totals', () => {
  const days: Day[] = [
    { date: d(5), log: collectDayLog({ symptoms: [sym('10:00', 'Headache', 4)] }, settings) }, // Monday
    { date: d(6), log: collectDayLog({ symptoms: [sym('10:00', 'Headache', 6), sym('11:00', 'Nausea', 2)] }, settings) },
    { date: d(7), log: null },
  ];

  it('maps each symptom to its daily peaks', () => {
    expect(symptomCalendar(days)).toEqual([
      { name: 'Headache', cells: [4, 6, null], days: 2, averagePeak: 5 },
      { name: 'Nausea', cells: [null, 2, null], days: 1, averagePeak: 2 },
    ]);
  });

  it('totals symptom days per week', () => {
    const [week] = weeklySymptomTotals(days);
    expect(week).toMatchObject({ symptomDays: 2, loggedDays: 2, averagePeak: 5 });
    expect(week.weekStart).toEqual(new Date(2026, 9, 5));
  });
});

describe('symptomsNextDay', () => {
  it('links a late bed time to a headache the next day', () => {
    const late = ['00:45', '01:00', '00:30', '23:00', '22:30', '23:15', '22:45', '23:30'];
    const nextHeadache = [true, true, false, false, false, false, true, false];
    const days: Day[] = [];
    late.forEach((bed, i) => {
      const fm: Record<string, unknown> = { bedTime: bed };
      if (i > 0 && nextHeadache[i - 1]) fm['symptoms'] = [sym('10:00', 'Headache', 5)];
      days.push({ date: d(i + 1), log: collectDayLog(fm, settings) });
    });
    const links = symptomsNextDay(days);
    expect(links[0]).toMatchObject({ condition: 'Bed after 23:30', symptom: 'Headache' });
    expect(links[0].withHits).toBeGreaterThanOrEqual(2);
  });

  it('needs enough consecutive days', () => {
    expect(symptomsNextDay([{ date: d(1), log: collectDayLog({}, settings) }])).toEqual([]);
  });
});
