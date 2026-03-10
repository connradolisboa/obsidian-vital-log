// ============================================================
// Vital Log — YAML Manager
// All frontmatter read/write/edit/delete logic.
// Zero UI code — only vault I/O and YAML operations.
// ============================================================

import { App, Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import { isArray } from './types';

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
  const body = content.slice(closeIndex + 4); // skip "\n---"
  // body may start with \n — preserve it
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
