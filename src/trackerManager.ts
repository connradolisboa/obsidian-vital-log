// ============================================================
// Vital Log — Tracker Manager
// Business logic for logging tracker entries (mood, energy, etc.).
// Zero UI, zero direct file I/O — delegates to yamlManager.
// ============================================================

import { App, TFile } from 'obsidian';
import type { TrackerConfig, VitalLogSettings } from './types';
import * as yaml from './yamlManager';

const DEFAULT_TRACKER_TEMPLATE = '- {time} {name}: {value}';

function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  result = result.replace(/ {2,}/g, ' ').trimEnd();
  return result;
}

/**
 * Log a single tracker entry (e.g. mood: 3 at 14:00).
 * Writes to the tracker's propertyKey in frontmatter.
 * Pass `appendToNote: true` to also write a line to the note body using the template from settings.
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
  opts: { time: string; value: number; note?: string; appendToNote?: boolean },
  settings?: VitalLogSettings
): Promise<void> {
  const entry: Record<string, unknown> = {
    time: opts.time,
    [tracker.valueName]: opts.value,
  };
  if (opts.note) {
    entry['note'] = opts.note;
  }
  await yaml.appendEntry(app, file, tracker.propertyKey, entry);

  if (opts.appendToNote) {
    const template = settings?.noteContentTemplate_trackers || DEFAULT_TRACKER_TEMPLATE;
    const line = applyTemplate(template, {
      time: opts.time,
      name: tracker.displayName,
      value: String(opts.value),
      note: opts.note ?? '',
    });
    await yaml.appendLineToBody(app, file, line);
  }
}
