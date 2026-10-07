import { describe, it, expect } from 'vitest';
import { uniquePropertyKey } from '../src/validation';
import { DEFAULT_SETTINGS } from '../src/types';
import type { VitalLogSettings } from '../src/types';

function settings(keys: string[]): VitalLogSettings {
  return {
    ...DEFAULT_SETTINGS,
    vitamins: keys.map((k, i) => ({ id: `v${i}`, displayName: k, propertyKey: k, defaultAmount: 1, unit: 'mg' })),
  };
}

describe('uniquePropertyKey', () => {
  it('slugifies the name', () => {
    expect(uniquePropertyKey('Vitamin D3 ', settings([]))).toBe('Vitamin_D3');
  });

  it('adds a suffix when the key is taken', () => {
    expect(uniquePropertyKey('Zinc', settings(['Zinc', 'Zinc_2']))).toBe('Zinc_3');
  });

  it('avoids keys owned by metrics', () => {
    expect(uniquePropertyKey('moodLog', settings([]))).toBe('moodLog_2');
  });

  it('returns empty for a name with no usable characters', () => {
    expect(uniquePropertyKey('!!', settings([]))).toBe('');
  });
});
