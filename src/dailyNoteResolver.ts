// ============================================================
// Vital Log — Daily Note Resolver
// Resolves path template to today's (or any given date's) note,
// creating the file and intermediate folders if absent.
// ============================================================

import { App, Notice, TFile } from 'obsidian';
import type { VitalLogSettings } from './types';

// moment is bundled with Obsidian — accessed via the global
declare const moment: (date?: Date | string) => {
  format: (fmt: string) => string;
  quarter: () => number;
};

/**
 * Resolve a path template for the given date.
 * Tokens:
 *   {{YYYY}}            → 4-digit year
 *   {{Q}}               → quarter (1–4)
 *   {{YYYY-MM-DD dddd}} → e.g. "2025-03-10 Monday"
 */
export function resolvePathTemplate(template: string, date: Date = new Date()): string {
  const m = moment(date);
  const year = m.format('YYYY');
  const quarter = String(m.quarter());
  const dateName = m.format('YYYY-MM-DD dddd');

  return template
    .replace(/\{\{YYYY\}\}/g, year)
    .replace(/\{\{Q\}\}/g, quarter)
    .replace(/\{\{YYYY-MM-DD dddd\}\}/g, dateName);
}

/**
 * Return the TFile for the daily note at the given date.
 * Creates the file (and any missing folders) if it does not exist.
 */
export async function resolveDailyNote(
  app: App,
  settings: VitalLogSettings,
  date: Date = new Date()
): Promise<TFile | null> {
  const resolvedPath = resolvePathTemplate(settings.dailyNotePath, date) + '.md';

  const existing = app.vault.getAbstractFileByPath(resolvedPath);
  if (existing instanceof TFile) {
    return existing;
  }

  // Ensure the folder tree exists
  const folderPath = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'));
  if (folderPath) {
    await ensureFolderExists(app, folderPath);
  }

  // Create with empty frontmatter
  try {
    const file = await app.vault.create(resolvedPath, '---\n---\n');
    return file;
  } catch (err) {
    new Notice(`Vital Log: Failed to create daily note at "${resolvedPath}".`);
    console.error('Vital Log dailyNoteResolver:', err);
    return null;
  }
}

/**
 * Check whether a daily note exists for the given date without creating it.
 */
export function getDailyNoteIfExists(
  app: App,
  settings: VitalLogSettings,
  date: Date = new Date()
): TFile | null {
  const resolvedPath = resolvePathTemplate(settings.dailyNotePath, date) + '.md';
  const file = app.vault.getAbstractFileByPath(resolvedPath);
  return file instanceof TFile ? file : null;
}

// ── Helpers ─────────────────────────────────────────────────

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const parts = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const node = app.vault.getAbstractFileByPath(current);
    if (!node) {
      try {
        await app.vault.createFolder(current);
      } catch {
        // Another concurrent operation may have created it already; ignore.
      }
    }
  }
}
