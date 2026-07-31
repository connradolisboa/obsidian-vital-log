// ============================================================
// Vital Log — YAML Manager
// All frontmatter read/write/edit/delete logic.
// Zero UI code — only vault I/O and YAML operations.
// ============================================================

import { App, Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import { isArray } from './types';
import type { TallyEntry } from './types';

// ── Types ────────────────────────────────────────────────────

type FrontmatterRecord = Record<string, unknown>;

// ── Public API ───────────────────────────────────────────────

/**
 * Append one entry to a list property in the file's frontmatter.
 * - If the property does not exist it is created as a list.
 * - If the property exists and IS a list, the entry is appended.
 * - If the property exists but is NOT a list, a Notice is shown and the
 *   operation is aborted (never corrupt non-plugin data).
 */
export async function appendEntry(
  app: App,
  file: TFile,
  propertyKey: string,
  entry: unknown
): Promise<void> {
  await processFrontmatter(app, file, (fm) => {
    const existing = fm[propertyKey];
    if (existing === undefined || existing === null) {
      fm[propertyKey] = [entry];
    } else if (isArray(existing)) {
      existing.push(entry);
    } else {
      new Notice(
        `Vital Log: The property "${propertyKey}" already exists but is not a list. ` +
        `Aborting to protect your data.`
      );
      throw new AbortError('property not a list');
    }
  });
}

/**
 * Remove the entry at `index` from a list property.
 */
export async function removeEntry(
  app: App,
  file: TFile,
  propertyKey: string,
  index: number
): Promise<void> {
  await processFrontmatter(app, file, (fm) => {
    const existing = fm[propertyKey];
    if (!isArray(existing)) {
      new Notice(`Vital Log: Cannot remove entry — "${propertyKey}" is not a list.`);
      throw new AbortError('property not a list');
    }
    if (index < 0 || index >= existing.length) {
      new Notice(`Vital Log: Index ${index} out of bounds for "${propertyKey}".`);
      throw new AbortError('index out of bounds');
    }
    existing.splice(index, 1);
  });
}

/**
 * Replace the entry at `index` with `updated` in a list property.
 */
export async function editEntry(
  app: App,
  file: TFile,
  propertyKey: string,
  index: number,
  updated: unknown
): Promise<void> {
  await processFrontmatter(app, file, (fm) => {
    const existing = fm[propertyKey];
    if (!isArray(existing)) {
      new Notice(`Vital Log: Cannot edit entry — "${propertyKey}" is not a list.`);
      throw new AbortError('property not a list');
    }
    if (index < 0 || index >= existing.length) {
      new Notice(`Vital Log: Index ${index} out of bounds for "${propertyKey}".`);
      throw new AbortError('index out of bounds');
    }
    existing[index] = updated;
  });
}

/**
 * Read all entries from a list property. Returns [] if absent or not a list.
 */
export async function readEntries(
  app: App,
  file: TFile,
  propertyKey: string
): Promise<unknown[]> {
  const content = await app.vault.read(file);
  const fm = extractFrontmatter(content);
  if (!fm) return [];
  const val = fm[propertyKey];
  if (!isArray(val)) return [];
  return val;
}

/**
 * Read ALL frontmatter keys and their values from the file.
 */
export async function readAllFrontmatter(
  app: App,
  file: TFile
): Promise<FrontmatterRecord> {
  const content = await app.vault.read(file);
  return extractFrontmatter(content) ?? {};
}

/**
 * Set (overwrite) top-level frontmatter properties.
 * Existing keys not in `properties` are left untouched.
 */
export async function setProperties(
  app: App,
  file: TFile,
  properties: Record<string, unknown>
): Promise<void> {
  await processFrontmatter(app, file, (fm) => {
    for (const [key, value] of Object.entries(properties)) {
      fm[key] = value;
    }
  });
}

/**
 * Read a tally entry from frontmatter. Returns { value: 0 } if absent or malformed.
 */
export async function readTallyEntry(
  app: App,
  file: TFile,
  propertyKey: string
): Promise<TallyEntry> {
  const fm = await readAllFrontmatter(app, file);
  const val = fm[propertyKey];
  if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    return {
      value: typeof obj['value'] === 'number' ? obj['value'] : 0,
      note: typeof obj['note'] === 'string' ? obj['note'] : undefined,
    };
  }
  return { value: 0 };
}

/**
 * Write a tally entry to frontmatter, replacing any existing value.
 */
export async function setTallyEntry(
  app: App,
  file: TFile,
  propertyKey: string,
  entry: TallyEntry
): Promise<void> {
  await setProperties(app, file, { [propertyKey]: entry });
}

/**
 * Read a checkbox entry from frontmatter. Returns false if absent or not a boolean.
 */
export async function readCheckboxEntry(
  app: App,
  file: TFile,
  propertyKey: string
): Promise<boolean> {
  const fm = await readAllFrontmatter(app, file);
  return fm[propertyKey] === true;
}

/**
 * Write a checkbox entry to frontmatter, replacing any existing value.
 */
export async function setCheckboxEntry(
  app: App,
  file: TFile,
  propertyKey: string,
  value: boolean
): Promise<void> {
  await setProperties(app, file, { [propertyKey]: value });
}

/**
 * Rename a frontmatter key at an arbitrary dot-path.
 * e.g. "health.bloodPressure" → "health.bp"  or  "moodLog" → "emotionLog"
 * If the old path does not exist in a file, the file is left unchanged.
 */
export async function renameTopLevelKey(
  app: App,
  file: TFile,
  oldDotPath: string,
  newDotPath: string
): Promise<void> {
  await processFrontmatter(app, file, (fm) => {
    const oldParts = oldDotPath.split('.');
    const newParts = newDotPath.split('.');

    // Resolve the value at oldDotPath
    let cursor: unknown = fm;
    for (const part of oldParts) {
      if (typeof cursor !== 'object' || cursor === null || !(part in (cursor as Record<string, unknown>))) return;
      cursor = (cursor as Record<string, unknown>)[part];
    }
    const value = cursor;

    // Delete old key
    deleteNestedKey(fm, oldParts);

    // Set new key
    setNestedKey(fm, newParts, value);
  });
}

/**
 * Rename a sub-key inside every entry of a list property.
 * e.g. rename "meditationTiming" → "minutes" inside all entries of "meditationLog[]"
 */
export async function renameEntrySubKey(
  app: App,
  file: TFile,
  listKey: string,
  oldSubKey: string,
  newSubKey: string
): Promise<void> {
  await processFrontmatter(app, file, (fm) => {
    const entries = fm[listKey];
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue;
      const obj = entry as Record<string, unknown>;
      if (oldSubKey in obj) {
        obj[newSubKey] = obj[oldSubKey];
        delete obj[oldSubKey];
      }
    }
  });
}

function deleteNestedKey(obj: Record<string, unknown>, parts: string[]): void {
  if (parts.length === 0) return;
  if (parts.length === 1) {
    delete obj[parts[0]];
    return;
  }
  const child = obj[parts[0]];
  if (typeof child === 'object' && child !== null) {
    deleteNestedKey(child as Record<string, unknown>, parts.slice(1));
  }
}

function setNestedKey(obj: Record<string, unknown>, parts: string[], value: unknown): void {
  if (parts.length === 0) return;
  if (parts.length === 1) {
    obj[parts[0]] = value;
    return;
  }
  if (typeof obj[parts[0]] !== 'object' || obj[parts[0]] === null) {
    obj[parts[0]] = {};
  }
  setNestedKey(obj[parts[0]] as Record<string, unknown>, parts.slice(1), value);
}

/**
 * Append a line of text to the note body (after the frontmatter).
 * The line is appended at the end of the file, preceded by a newline if needed.
 */
export async function appendLineToBody(
  app: App,
  file: TFile,
  line: string
): Promise<void> {
  await app.vault.process(file, (content: string) => {
    const trimmed = content.trimEnd();
    return trimmed + '\n' + line + '\n';
  });
}

// ── Internal helpers ─────────────────────────────────────────

class AbortError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AbortError';
  }
}

/**
 * Atomically read → parse → mutate → stringify → write the frontmatter.
 * Uses vault.process() for atomic writes (Obsidian API ≥ 1.4).
 * If `mutate` throws an AbortError the write is skipped gracefully.
 */
async function processFrontmatter(
  app: App,
  file: TFile,
  mutate: (fm: FrontmatterRecord) => void
): Promise<void> {
  let abortError: AbortError | null = null;

  await app.vault.process(file, (content: string) => {
    let fm: FrontmatterRecord;
    let body: string;

    const parsed = splitFrontmatter(content);
    if (parsed) {
      try {
        const raw = parseYaml(parsed.yaml) as unknown;
        fm = (typeof raw === 'object' && raw !== null)
          ? (raw as FrontmatterRecord)
          : {};
      } catch {
        fm = {};
      }
      body = parsed.body;
    } else {
      fm = {};
      body = content;
    }

    try {
      mutate(fm);
    } catch (err) {
      if (err instanceof AbortError) {
        abortError = err;
        // Return original content unchanged
        return content;
      }
      throw err;
    }

    const yamlStr = stringifyYaml(fm).trimEnd();
    return `---\n${yamlStr}\n---\n${body}`;
  });

  if (abortError) {
    // Re-throw so callers can detect the abort if needed
    throw abortError;
  }
}

interface SplitFrontmatter {
  yaml: string;
  body: string;
}

/**
 * Split a file's content into its YAML frontmatter block and the rest.
 * Returns null if there is no frontmatter delimiter.
 */
function splitFrontmatter(content: string): SplitFrontmatter | null {
  if (!content.startsWith('---')) return null;

  const afterFirst = content.indexOf('\n', 0);
  if (afterFirst === -1) return null;

  const closeIndex = content.indexOf('\n---', afterFirst);
  if (closeIndex === -1) return null;

  const yaml = content.slice(afterFirst + 1, closeIndex);
  const body = content.slice(closeIndex + 5); // skip "\n---\n"
  return { yaml, body };
}

/**
 * Extract frontmatter as a record (read-only, does not write).
 */
function extractFrontmatter(content: string): FrontmatterRecord | null {
  const parsed = splitFrontmatter(content);
  if (!parsed) return null;
  try {
    const raw = parseYaml(parsed.yaml) as unknown;
    if (typeof raw === 'object' && raw !== null) {
      return raw as FrontmatterRecord;
    }
    return {};
  } catch {
    return null;
  }
}
