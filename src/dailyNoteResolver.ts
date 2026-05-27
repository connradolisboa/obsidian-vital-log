// ============================================================
// Vital Log — Note Resolver
// Resolves path templates to note files for any date,
// creating the file and intermediate folders if absent.
// ============================================================

import { App, Notice, TFile } from 'obsidian';
import type { VitalLogSettings } from './types';

// moment is bundled with Obsidian — accessed via the global
declare const moment: (date?: Date | string) => {
  format: (fmt: string) => string;
  quarter: () => number;
  isoWeek: () => number;
};

/**
 * Resolve a path template for the given date.
 * Tokens (order matters — longest patterns first to avoid partial matches):
 *   {{YYYY-MM-DD dddd}} → e.g. "2025-03-10 Monday"
 *   {{YYYY-MM-DD}}      → e.g. "2025-03-10"
 *   {{YYYY-MM}}         → e.g. "2025-03"
 *   {{YYYY}}            → 4-digit year
 *   {{YY}}              → 2-digit year
 *   {{MMMM}}            → full month name (e.g. "March")
 *   {{MM}}              → zero-padded month (01–12)
 *   {{DD}}              → zero-padded day (01–31)
 *   {{dddd}}            → full weekday name (e.g. "Monday")
 *   {{ddd}}             → short weekday name (e.g. "Mon")
 *   {{WW}}              → ISO week number, zero-padded (01–53)
 *   {{Q}}               → quarter (1–4)
 */
export function resolvePathTemplate(template: string, date: Date = new Date()): string {
  const m = moment(date);

  return template
    // Longest compound tokens first
    .replace(/\{\{YYYY-MM-DD dddd\}\}/g, m.format('YYYY-MM-DD dddd'))
    .replace(/\{\{YYYY-MM-DD\}\}/g, m.format('YYYY-MM-DD'))
    .replace(/\{\{YYYY-MM\}\}/g, m.format('YYYY-MM'))
    // Year
    .replace(/\{\{YYYY\}\}/g, m.format('YYYY'))
    .replace(/\{\{YY\}\}/g, m.format('YY'))
    // Month
    .replace(/\{\{MMMM\}\}/g, m.format('MMMM'))
    .replace(/\{\{MM\}\}/g, m.format('MM'))
    // Day
    .replace(/\{\{DD\}\}/g, m.format('DD'))
    .replace(/\{\{dddd\}\}/g, m.format('dddd'))
    .replace(/\{\{ddd\}\}/g, m.format('ddd'))
    // Week
    .replace(/\{\{WW\}\}/g, String(m.isoWeek()).padStart(2, '0'))
    // Quarter
    .replace(/\{\{Q\}\}/g, String(m.quarter()));
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
  return resolveNote(app, settings.dailyNotePath, date);
}

/**
 * Generic note resolver — takes any path template + date.
 * Returns existing file or creates a new one with empty frontmatter.
 * Returns { file, created } so callers can trigger Templater on new files.
 */
export async function resolveNote(
  app: App,
  pathTemplate: string,
  date: Date = new Date()
): Promise<TFile | null> {
  const resolvedPath = resolvePathTemplate(pathTemplate, date) + '.md';

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
    new Notice(`Vital Log: Failed to create note at "${resolvedPath}".`);
    console.error('Vital Log noteResolver:', err);
    return null;
  }
}

/**
 * Check whether a note exists for the given path template + date without creating it.
 */
export function getNoteIfExists(
  app: App,
  pathTemplate: string,
  date: Date = new Date()
): TFile | null {
  const resolvedPath = resolvePathTemplate(pathTemplate, date) + '.md';
  const file = app.vault.getAbstractFileByPath(resolvedPath);
  return file instanceof TFile ? file : null;
}

/**
 * Check whether a daily note exists for the given date without creating it.
 */
export function getDailyNoteIfExists(
  app: App,
  settings: VitalLogSettings,
  date: Date = new Date()
): TFile | null {
  return getNoteIfExists(app, settings.dailyNotePath, date);
}

const TEMPLATE_TOKEN_RE =
  /\{\{(YYYY-MM-DD dddd|YYYY-MM-DD|YYYY-MM|YYYY|YY|MMMM|MM|DD|dddd|ddd|WW|Q)\}\}/g;

const TOKEN_REGEX_MAP: Record<string, string> = {
  'YYYY-MM-DD dddd': '\\d{4}-\\d{2}-\\d{2} [A-Za-z]+',
  'YYYY-MM-DD': '\\d{4}-\\d{2}-\\d{2}',
  'YYYY-MM': '\\d{4}-\\d{2}',
  'YYYY': '\\d{4}',
  'YY': '\\d{2}',
  'MMMM': '[A-Za-z]+',
  'MM': '\\d{2}',
  'DD': '\\d{2}',
  'dddd': '[A-Za-z]+',
  'ddd': '[A-Za-z]{3}',
  'WW': '\\d{2}',
  'Q': '[1-4]',
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function templateToRegex(template: string): RegExp {
  let pattern = '';
  let lastIndex = 0;
  TEMPLATE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TEMPLATE_TOKEN_RE.exec(template)) !== null) {
    pattern += escapeRegex(template.substring(lastIndex, match.index));
    pattern += TOKEN_REGEX_MAP[match[1]];
    lastIndex = TEMPLATE_TOKEN_RE.lastIndex;
  }
  pattern += escapeRegex(template.substring(lastIndex)) + '\\.md';
  return new RegExp('^' + pattern + '$');
}

/**
 * Returns true if `path` could have been produced by `pathTemplate` for some date.
 * Used so embeds know whether the note they live in is "the" periodic note
 * the modal targets (and should be operated on directly).
 */
export function pathMatchesTemplate(path: string, pathTemplate: string): boolean {
  if (!pathTemplate.trim()) return false;
  try {
    return templateToRegex(pathTemplate).test(path);
  } catch {
    return false;
  }
}

/**
 * Brute-force search ±5 years around today for a date that resolves
 * `pathTemplate` to `path`. Returns the matching Date, or null if none.
 */
export function extractDateFromPath(path: string, pathTemplate: string): Date | null {
  if (!pathMatchesTemplate(path, pathTemplate)) return null;
  const target = path.endsWith('.md') ? path.substring(0, path.length - 3) : path;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const MAX_DAYS = 365 * 5;
  for (let offset = 0; offset <= MAX_DAYS; offset++) {
    const past = new Date(today);
    past.setDate(today.getDate() - offset);
    if (resolvePathTemplate(pathTemplate, past) === target) return past;
    if (offset > 0) {
      const future = new Date(today);
      future.setDate(today.getDate() + offset);
      if (resolvePathTemplate(pathTemplate, future) === target) return future;
    }
  }
  return null;
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
