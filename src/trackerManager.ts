// ============================================================
// Vital Log — Tracker Manager
// Business logic for logging tracker entries (mood, energy, etc.).
// Zero UI, zero direct file I/O — delegates to yamlManager.
// ============================================================

import { App, TFile } from 'obsidian';
import type { TrackerConfig } from './types';
import * as yaml from './yamlManager';

/**
 * Log a single tracker entry (e.g. mood: 3 at 14:00).
 * Writes to the tracker's propertyKey in frontmatter.
 *
 * Produces:
 *   moodLog:
 *     - time: "14:00"
 *       mood: 3
 *       note: "feeling okay"
 */
export async function logTracker(
  app: App,
  file: TFile,
  tracker: TrackerConfig,
  opts: { time: string; value: number; note?: string }
): Promise<void> {
  const entry: Record<string, unknown> = {
    time: opts.time,
    [tracker.valueName]: opts.value,
  };
  if (opts.note) {
    entry['note'] = opts.note;
  }
  await yaml.appendEntry(app, file, tracker.propertyKey, entry);
}
