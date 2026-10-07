import { describe, it, expect } from 'vitest';
import { App } from './stubs/obsidian';
import {
  activeAfter,
  buildSymptomDays,
  logSymptom,
  moveEventsToSymptomsIn,
  readSymptomEntries,
} from '../src/symptomManager';
import { collectDayLog, timeline } from '../src/dayLog';
import { symptomsAfterDoses } from '../src/dayStats';
import * as yaml from '../src/yamlManager';
import { DEFAULT_SETTINGS } from '../src/types';
import type { SymptomEntry, VitalLogSettings } from '../src/types';

const settings: VitalLogSettings = {
  ...DEFAULT_SETTINGS,
  symptomTypes: [{ id: 's1', displayName: 'Headache', icon: 'brain' }],
};
const none = new Map<string, { name: string; severity: number }>();
const entry = (time: string, name: string, severity: number): SymptomEntry => ({ time, name, severity });

describe('readSymptomEntries', () => {
  it('reads, clamps to 0–10, and orders by time', () => {
    const fm = { symptoms: [
      { time: '16:00', name: 'Headache', severity: 12 },
      { time: '14:00', name: 'Headache', severity: 3 },
      { time: '15:00', name: 'Nausea' },
      'junk',
    ] };
    expect(readSymptomEntries(fm, settings)).toEqual([
      entry('14:00', 'Headache', 3),
      entry('16:00', 'Headache', 10),
    ]);
  });
});

describe('buildSymptomDays', () => {
  it('turns readings into a span with a peak', () => {
    const [day] = buildSymptomDays(
      [entry('14:00', 'Headache', 3), entry('16:10', 'headache', 5), entry('18:30', 'Headache', 0)],
      none,
      settings
    );
    expect(day).toMatchObject({
      name: 'Headache', icon: 'brain', carriedIn: null, peak: 5,
      startTime: '14:00', endTime: '18:30', activeAtEnd: false,
    });
  });

  it('keeps a carried-in symptom active with no start of its own', () => {
    const [day] = buildSymptomDays(
      [entry('09:00', 'Sick', 4)],
      new Map([['sick', { name: 'Sick', severity: 7 }]]),
      settings
    );
    expect(day).toMatchObject({ carriedIn: 7, startTime: null, peak: 7, activeAtEnd: true });
  });

  it('ignores a symptom only ever logged as gone', () => {
    expect(buildSymptomDays([entry('09:00', 'Nausea', 0)], none, settings)).toEqual([]);
  });
});

describe('activeAfter', () => {
  it('keeps what is still above 0 and when it began', () => {
    const active = activeAfter([
      { iso: '2026-10-05', entries: [entry('10:00', 'Sick', 6), entry('11:00', 'Headache', 4)] },
      { iso: '2026-10-06', entries: [entry('09:00', 'Sick', 3), entry('12:00', 'Headache', 0)] },
    ]);
    expect([...active.values()]).toEqual([{ name: 'Sick', severity: 3, sinceISO: '2026-10-05', sinceTime: '10:00' }]);
  });
});

describe('symptoms in the day log', () => {
  it('appear on the timeline, including one carried in', () => {
    const log = collectDayLog(
      { symptoms: [{ time: '10:00', name: 'Sick', severity: 0 }] },
      settings,
      new Map([['sick', { name: 'Sick', severity: 6 }]])
    );
    expect(timeline(log).map((i) => `${i.time} ${i.text}`)).toEqual(['null Sick 6/10 (from earlier)', '10:00 Sick gone']);
  });
});

describe('symptomsAfterDoses', () => {
  const day = (dose: boolean, onset: string | null) =>
    collectDayLog({
      ...(dose ? { substances: [{ name: 'Vyvanse', time: '08:00', amount: 50 }] } : {}),
      ...(onset ? { symptoms: [{ time: onset, name: 'Headache', severity: 5 }] } : {}),
    }, settings);

  it('links a symptom that begins soon after doses', () => {
    const logs = [
      day(true, '11:00'), day(true, '12:30'), day(true, '10:00'), day(true, null),
      day(false, null), day(false, '20:00'), day(false, null), day(false, null),
    ];
    expect(symptomsAfterDoses(logs, 6)).toEqual([{
      substance: 'Vyvanse', symptom: 'Headache', windowHours: 6,
      doseDays: 4, doseHits: 3, otherDays: 4, otherHits: 1,
    }]);
  });

  it('does not count onsets outside the window', () => {
    const logs = [day(true, '20:00'), day(true, '21:00'), day(true, '22:00'), day(false, null), day(false, null), day(false, null)];
    expect(symptomsAfterDoses(logs, 6)).toEqual([]);
  });
});

describe('logSymptom', () => {
  it('appends a reading', async () => {
    const app = new App();
    const file = app.vault.create('Daily/2026-10-07.md', '---\n---\n');
    await logSymptom(app as never, file as never, entry('14:00', 'Headache', 4), settings, false);
    expect(await yaml.readAllFrontmatter(app as never, file as never)).toEqual({
      symptoms: [{ time: '14:00', name: 'Headache', severity: 4 }],
    });
  });
});

describe('moveEventsToSymptomsIn', () => {
  it('moves matching events, doubling severity, and leaves the rest', () => {
    const fm: Record<string, unknown> = {
      events: [
        { time: '15:08', name: 'Sick', severity: 5, note: 'flu' },
        { time: '18:00', name: 'Travel', severity: 2 },
      ],
    };
    expect(moveEventsToSymptomsIn(fm, 'sick', settings)).toBe(1);
    expect(fm).toEqual({
      events: [{ time: '18:00', name: 'Travel', severity: 2 }],
      symptoms: [{ time: '15:08', name: 'Sick', severity: 10, note: 'flu' }],
    });
  });

  it('drops an emptied events list', () => {
    const fm: Record<string, unknown> = { events: [{ time: '10:54', name: 'Sick', severity: 2 }] };
    moveEventsToSymptomsIn(fm, 'Sick', settings);
    expect(fm).toEqual({ symptoms: [{ time: '10:54', name: 'Sick', severity: 4 }] });
  });
});
