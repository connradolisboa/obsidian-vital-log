// ============================================================
// Vital Log — Tally Manager
// Business logic for reading/writing tally counter entries.
// Zero UI code — only coordinates yamlManager calls.
// ============================================================

import { App, TFile } from 'obsidian';
import type { TallyCounterConfig, TallyEntry } from './types';
import { readTallyEntry, setTallyEntry, appendLineToBody } from './yamlManager';
import { applyTemplate } from './template';

export async function readTally(
  app: App,
  file: TFile,
  config: TallyCounterConfig
): Promise<TallyEntry> {
  return readTallyEntry(app, file, config.propertyKey);
}

export async function updateTallyValue(
  app: App,
  file: TFile,
  config: TallyCounterConfig,
  newValue: number
): Promise<void> {
  const existing = await readTallyEntry(app, file, config.propertyKey);
  await setTallyEntry(app, file, config.propertyKey, { ...existing, value: newValue });
}

export async function saveTallyNote(
  app: App,
  file: TFile,
  config: TallyCounterConfig,
  note: string
): Promise<void> {
  const existing = await readTallyEntry(app, file, config.propertyKey);
  await setTallyEntry(app, file, config.propertyKey, {
    ...existing,
    note: note.trim() || undefined,
  });
}

export async function appendTallyToNote(
  app: App,
  file: TFile,
  config: TallyCounterConfig,
  entry: TallyEntry,
  template: string
): Promise<void> {
  const line = applyTemplate(template, {
    name: config.displayName,
    value: String(entry.value),
    target: String(config.target),
  });
  await appendLineToBody(app, file, line);
}
