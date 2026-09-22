// ============================================================
// Vital Log — Event Manager
// Business logic for logging life events (sick, traveling, etc.)
// to the daily note's frontmatter.
// ============================================================

import type { App, TFile } from 'obsidian';
import type { VitalLogSettings, EventEntry, EventType } from './types';
import { appendEntry, appendLineToBody } from './yamlManager';
import { applyTemplate, noteContentHeading } from './template';

export async function logEvent(
  app: App,
  file: TFile,
  entry: EventEntry,
  settings: VitalLogSettings,
  appendToNote: boolean
): Promise<void> {
  let frontmatterEntry: EventEntry = entry;
  if (settings.logNoteInFrontmatter === false && entry.note) {
    frontmatterEntry = { ...entry };
    delete frontmatterEntry.note;
  }
  await appendEntry(app, file, settings.eventsPropertyKey, frontmatterEntry);

  if (appendToNote) {
    const line = applyTemplate(settings.noteContentTemplate_events, {
      time: entry.time,
      name: entry.name,
      severity: String(entry.severity),
      note: entry.note ?? '',
    });
    await appendLineToBody(app, file, line, noteContentHeading(settings));
  }
}

/**
 * Ensure an event name is persisted in settings.eventTypes.
 * Call after a successful log when the user typed a new name.
 */
export function ensureEventType(settings: VitalLogSettings, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const exists = settings.eventTypes.some(
    (t) => t.displayName.toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) return false;
  const newType: EventType = {
    id: crypto.randomUUID(),
    displayName: trimmed,
  };
  settings.eventTypes.push(newType);
  return true;
}
