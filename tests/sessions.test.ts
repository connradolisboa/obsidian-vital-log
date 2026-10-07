import { describe, it, expect, vi } from 'vitest';
import { App } from './stubs/obsidian';
import { collectDayLog, isEmptyDay, timeline } from '../src/dayLog';
import { clockMinutes } from '../src/dayChart';
import { formatMinutes, getManagementApi, type MtSession } from '../src/managementTracker';
import { createVitalLogApi, VITAL_LOG_API_VERSION } from '../src/api';
import { DEFAULT_SETTINGS } from '../src/types';

const session = (over: Partial<MtSession> = {}): MtSession => ({
  id: 'mt-1', date: '2026-10-07', time: '09:00', end: '10:15', minutes: 75,
  title: 'Deep work', countsToward: 'Vital Log › Day view', targetPath: null,
  area: 'Work', tags: ['coding'], note: '', source: 'timer', notePath: 'Calendar/Daily/x.md', line: 3,
  ...over,
});

describe('sessions in the day log', () => {
  it('appear in the timeline with their duration and target', () => {
    const log = collectDayLog({ moodLog: [{ time: '08:00', mood: 3 }] }, DEFAULT_SETTINGS);
    log.sessions = [session()];
    expect(timeline(log).map((i) => [i.kind, i.time, i.text, i.note])).toEqual([
      ['tracker', '08:00', 'Mood: 3', undefined],
      ['session', '09:00', 'Deep work · 1h 15m', 'Vital Log › Day view'],
    ]);
  });

  it('make a day non-empty on their own', () => {
    const log = collectDayLog({}, DEFAULT_SETTINGS);
    expect(isEmptyDay(log)).toBe(true);
    log.sessions = [session()];
    expect(isEmptyDay(log)).toBe(false);
  });
});

describe('clockMinutes', () => {
  it('lets an end run past midnight', () => {
    expect(clockMinutes('24:10')).toBe(1450);
    expect(clockMinutes('09:05')).toBe(545);
    expect(clockMinutes('soon')).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('formats durations', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(85)).toBe('1h 25m');
  });
});

describe('getManagementApi', () => {
  const withPlugin = (api: unknown) => {
    const app = new App() as unknown as Record<string, unknown>;
    app['plugins'] = { plugins: { 'management-tracker': { api } } };
    return app;
  };

  it('returns the API at version 1 or later', () => {
    const api = { version: 1, sessionsOn: () => [], onChange: () => () => {} };
    expect(getManagementApi(withPlugin(api) as never)).toBe(api);
  });

  it('is null when missing or too old', () => {
    expect(getManagementApi(new App() as never)).toBeNull();
    expect(getManagementApi(withPlugin({ version: 0, sessionsOn: () => [], onChange: () => () => {} }) as never)).toBeNull();
  });
});

describe('public API renderDay', () => {
  it('is exposed at version 2 and forwards to the viewer', () => {
    const renderDay = vi.fn();
    const api = createVitalLogApi(new App() as never, () => DEFAULT_SETTINGS, renderDay);
    expect(VITAL_LOG_API_VERSION).toBe(2);
    expect(api.version).toBe(2);
    const el = {} as HTMLElement;
    const component = {} as never;
    api.renderDay(el, { date: '2026-10-07', tab: 'time' }, component);
    expect(renderDay).toHaveBeenCalledWith(el, { date: '2026-10-07', tab: 'time' }, component);
  });
});
