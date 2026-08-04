import { describe, it, expect } from 'vitest';
import { migrateSettings, validateSettings, CURRENT_SCHEMA_VERSION } from '../src/settingsMigrations';
import { DEFAULT_SETTINGS } from '../src/types';

describe('schema versioning', () => {
  it('starts fresh installs at the current version', () => {
    const { settings } = migrateSettings(null);
    expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('treats data written before versioning as version 0 and migrates it', () => {
    const { settings, changed } = migrateSettings({ dailyNotePath: 'Daily/{{YYYY-MM-DD}}' });
    expect(settings.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(changed).toBe(true);
  });

  it('leaves already-current data alone', () => {
    const current = { ...DEFAULT_SETTINGS, schemaVersion: CURRENT_SCHEMA_VERSION };
    const { changed, notes } = migrateSettings(current);
    expect(changed).toBe(false);
    expect(notes).toEqual([]);
  });

  it('does not re-run a migration that already ran', () => {
    // schemaVersion 1 means the metrics migration is done; a stray trackers[]
    // must not be folded into metrics a second time.
    const { settings } = migrateSettings({
      schemaVersion: 1,
      metrics: [{ id: 'm1', displayName: 'Mood', propertyKey: 'moodLog' }],
      trackers: [{ id: 't1', displayName: 'Sleep', propertyKey: 'sleepLog' }],
    });
    expect(settings.metrics).toHaveLength(1);
  });
});

describe('migration 1: legacy trackers/tallyCounters → metrics', () => {
  it('folds both legacy arrays into metrics', () => {
    const { settings } = migrateSettings({
      trackers: [{ id: 't1', displayName: 'Mood', propertyKey: 'moodLog', valueName: 'mood' }],
      tallyCounters: [{ id: 'c1', displayName: 'Water', propertyKey: 'water', target: 8 }],
    });

    expect(settings.metrics).toHaveLength(2);
    expect(settings.metrics.map((m) => m.displayName)).toEqual(['Mood', 'Water']);
  });

  it('drops the legacy arrays so they cannot shadow metrics later', () => {
    const { settings } = migrateSettings({
      trackers: [{ id: 't1', displayName: 'Mood', propertyKey: 'moodLog', valueName: 'mood' }],
    });

    expect(settings.trackers).toBeUndefined();
    expect(settings.tallyCounters).toBeUndefined();
  });

  it('keeps existing metrics when both shapes are present', () => {
    const { settings } = migrateSettings({
      metrics: [{ id: 'm1', displayName: 'Existing', propertyKey: 'existing' }],
      trackers: [{ id: 't1', displayName: 'Legacy', propertyKey: 'legacy', valueName: 'v' }],
    });

    expect(settings.metrics.map((m) => m.displayName)).toEqual(['Existing']);
  });
});

describe('migration 2: custom modal fields → items', () => {
  it('converts fields[] into items[]', () => {
    const { settings } = migrateSettings({
      customModals: [{
        id: 'cm1',
        displayName: 'Morning',
        fields: [{ id: 'f1', label: 'Mood', type: 'number' }],
      }],
    });

    const modal = settings.customModals[0] as unknown as Record<string, unknown>;
    expect(modal['fields']).toBeUndefined();
    expect(modal['items']).toEqual([
      { type: 'field', field: { id: 'f1', label: 'Mood', type: 'number' } },
    ]);
  });

  it('leaves a modal that already uses items[] untouched', () => {
    const items = [{ type: 'field', field: { id: 'f1', label: 'Mood', type: 'number' } }];
    const { settings } = migrateSettings({
      customModals: [{ id: 'cm1', displayName: 'Morning', items }],
    });

    const modal = settings.customModals[0] as unknown as Record<string, unknown>;
    expect(modal['items']).toEqual(items);
  });
});

describe('validation', () => {
  it('keeps valid user values', () => {
    const settings = validateSettings({
      dailyNotePath: 'Daily/{{YYYY-MM-DD}}',
      logSource: false,
      logMode: 'substances',
    });

    expect(settings.dailyNotePath).toBe('Daily/{{YYYY-MM-DD}}');
    expect(settings.logSource).toBe(false);
    expect(settings.logMode).toBe('substances');
  });

  it('resets only the field with the wrong type', () => {
    const notes: string[] = [];
    const settings = validateSettings({
      dailyNotePath: 'Daily/{{YYYY-MM-DD}}',
      logSource: 'yes please',   // should be boolean
      vitamins: 'not an array',  // should be an array
    }, notes);

    expect(settings.dailyNotePath).toBe('Daily/{{YYYY-MM-DD}}');
    expect(settings.logSource).toBe(DEFAULT_SETTINGS.logSource);
    expect(settings.vitamins).toEqual([]);
    expect(notes).toHaveLength(2);
  });

  it('survives a data.json that is not an object', () => {
    const { settings, notes } = migrateSettings('garbage');
    expect(settings.dailyNotePath).toBe(DEFAULT_SETTINGS.dailyNotePath);
    expect(notes.join()).toMatch(/not an object/);
  });

  it('gives plannedLogs its own arrays rather than sharing the defaults', () => {
    const a = validateSettings({});
    const b = validateSettings({});

    a.plannedLogs.schedule.push({ id: 'x' } as never);

    expect(b.plannedLogs.schedule).toHaveLength(0);
    expect(DEFAULT_SETTINGS.plannedLogs.schedule).toHaveLength(0);
  });

  it('repairs a malformed plannedLogs rather than discarding everything', () => {
    const settings = validateSettings({
      dailyNotePath: 'Daily/{{YYYY-MM-DD}}',
      plannedLogs: { trackerGoals: 'broken', schedule: [{ id: 'keep' }] },
    });

    expect(settings.dailyNotePath).toBe('Daily/{{YYYY-MM-DD}}');
    expect(settings.plannedLogs.trackerGoals).toEqual([]);
    expect(settings.plannedLogs.schedule).toHaveLength(1);
  });

  it('does not let one user\'s metrics array mutate the defaults', () => {
    const { settings } = migrateSettings({});
    settings.metrics.push({ id: 'new', displayName: 'New', propertyKey: 'new' } as never);

    expect(DEFAULT_SETTINGS.metrics.some((m) => m.id === 'new')).toBe(false);
  });
});
