import { describe, it, expect } from 'vitest';
import { buildSnapshot, reconcileSnapshot, detectChanges, changeSignature } from '../src/keySnapshotManager';
import { DEFAULT_SETTINGS } from '../src/types';
import type { VitalLogSettings, Vitamin, Metric } from '../src/types';

function vitamin(id: string, displayName: string, propertyKey: string): Vitamin {
  return { id, displayName, propertyKey, defaultAmount: 1, unit: 'mg' };
}

function settingsWith(over: Partial<VitalLogSettings>): VitalLogSettings {
  return { ...DEFAULT_SETTINGS, vitamins: [], metrics: [], customModals: [], ...over };
}

describe('reconcileSnapshot', () => {
  it('baselines an entity created after the snapshot was taken', () => {
    const before = settingsWith({ vitamins: [vitamin('a', 'Vitamin C', 'vitaminC')] });
    const snapshot = buildSnapshot(before);

    const after = settingsWith({
      vitamins: [vitamin('a', 'Vitamin C', 'vitaminC'), vitamin('b', 'Vyvanse', 'vyvanse')],
    });
    const { snapshot: next, changed } = reconcileSnapshot(snapshot, after);

    expect(changed).toBe(true);
    expect(next.records.find((r) => r.id === 'b')?.propertyKey).toBe('vyvanse');
  });

  it('detects a rename of an entity that only got its baseline from reconciling', () => {
    // The whole point: create Vyvanse, save, rename it — without ever having
    // opened the diagnostic dialog in between.
    const created = settingsWith({ vitamins: [vitamin('b', 'Vyvanse', 'vyvanse')] });
    const { snapshot } = reconcileSnapshot(undefined, created);

    const renamed = settingsWith({ vitamins: [vitamin('b', 'Vyvanse SS', 'vyvanseSS')] });
    const { snapshot: reconciled } = reconcileSnapshot(snapshot, renamed);
    const changes = detectChanges(reconciled, renamed);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldKey: 'vyvanse', newKey: 'vyvanseSS' });
  });

  it('keeps the recorded key when the current key differs, so the rename stays detectable', () => {
    const before = settingsWith({ vitamins: [vitamin('a', 'Vyvanse', 'vyvanse')] });
    const snapshot = buildSnapshot(before);

    const after = settingsWith({ vitamins: [vitamin('a', 'Vyvanse', 'vyvanseSS')] });
    const { snapshot: next } = reconcileSnapshot(snapshot, after);

    expect(next.records.find((r) => r.id === 'a')?.propertyKey).toBe('vyvanse');
  });

  it('refreshes the display name while leaving the recorded key alone', () => {
    const before = settingsWith({ vitamins: [vitamin('a', 'Vyvanse', 'vyvanse')] });
    const snapshot = buildSnapshot(before);

    const after = settingsWith({ vitamins: [vitamin('a', 'Vyvanse SS', 'vyvanse')] });
    const { snapshot: next, changed } = reconcileSnapshot(snapshot, after);

    expect(changed).toBe(true);
    const record = next.records.find((r) => r.id === 'a');
    expect(record?.entityName).toBe('Vyvanse SS');
    expect(record?.propertyKey).toBe('vyvanse');
  });

  it('drops records for deleted entities', () => {
    const before = settingsWith({
      vitamins: [vitamin('a', 'Vitamin C', 'vitaminC'), vitamin('b', 'Vyvanse', 'vyvanse')],
    });
    const snapshot = buildSnapshot(before);

    const after = settingsWith({ vitamins: [vitamin('a', 'Vitamin C', 'vitaminC')] });
    const { snapshot: next, changed } = reconcileSnapshot(snapshot, after);

    expect(changed).toBe(true);
    expect(next.records.map((r) => r.id)).toEqual(['a']);
  });

  it('reports no change when nothing moved', () => {
    const settings = settingsWith({ vitamins: [vitamin('a', 'Vitamin C', 'vitaminC')] });
    const { snapshot: next, changed } = reconcileSnapshot(buildSnapshot(settings), settings);

    expect(changed).toBe(false);
    expect(next.records).toHaveLength(1);
  });

  it('builds a fresh snapshot when none exists yet', () => {
    const settings = settingsWith({ vitamins: [vitamin('a', 'Vitamin C', 'vitaminC')] });
    const { snapshot, changed } = reconcileSnapshot(undefined, settings);

    expect(changed).toBe(true);
    expect(snapshot.records).toHaveLength(1);
  });

  it('baselines a new tracker with its entry sub-key so both halves are detectable', () => {
    const metric = (valueName: string, propertyKey: string): Metric => ({
      id: 'm1',
      displayName: 'Mood',
      propertyKey,
      valueName,
      trackerType: 'rating',
      icon: 'activity',
      min: 1,
      max: 10,
      target: 0,
      step: 1,
    });

    const { snapshot } = reconcileSnapshot(undefined, settingsWith({ metrics: [metric('mood', 'moodLog')] }));
    const after = settingsWith({ metrics: [metric('rating', 'moodTrack')] });
    const changes = detectChanges(reconcileSnapshot(snapshot, after).snapshot, after);

    expect(changes).toHaveLength(1);
    expect(changes[0].changeType).toBe('both');
    expect(changes[0]).toMatchObject({
      oldKey: 'moodLog',
      newKey: 'moodTrack',
      oldValueName: 'mood',
      newValueName: 'rating',
    });
  });
});

describe('changeSignature', () => {
  it('is stable for the same rename and distinct across different ones', () => {
    const base = settingsWith({ vitamins: [vitamin('a', 'Vyvanse', 'vyvanse')] });
    const snapshot = buildSnapshot(base);

    const renamed = settingsWith({ vitamins: [vitamin('a', 'Vyvanse', 'vyvanseSS')] });
    const first = detectChanges(snapshot, renamed)[0];
    expect(changeSignature(first)).toBe(changeSignature(detectChanges(snapshot, renamed)[0]));

    const renamedAgain = settingsWith({ vitamins: [vitamin('a', 'Vyvanse', 'vyvanseXR')] });
    expect(changeSignature(detectChanges(snapshot, renamedAgain)[0])).not.toBe(changeSignature(first));
  });
});
