import { describe, expect, it } from 'vitest';
import { parseTimes } from '../src/planManager';

describe('reminder times', () => {
  it('reads times however they are separated, sorted and once each', () => {
    expect(parseTimes('21:30, 8:00')).toEqual(['08:00', '21:30']);
    expect(parseTimes('08:00 08:00;12h30')).toEqual(['08:00', '12:30']);
    expect(parseTimes('')).toEqual([]);
  });
  it('refuses what is not a time', () => {
    expect(parseTimes('8am')).toBeNull();
    expect(parseTimes('25:00')).toBeNull();
  });
});
