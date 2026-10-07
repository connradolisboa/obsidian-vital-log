// ============================================================
// Vital Log — Substance Conversion
// One-off migration of existing notes into the flat substances[] format:
// per-vitamin lists are folded into substances[], and fields the current
// settings no longer log (source, unit) are stripped from substance entries.
// Zero UI — the settings tab drives it.
// ============================================================

import type { App, TFile } from 'obsidian';
import type { VitalLogSettings, Vitamin } from './types';
import { isArray, isVitaminEntry } from './types';
import * as yaml from './yamlManager';

type Fm = Record<string, unknown>;

export interface NoteConversion {
  /** Per-vitamin entries moved into substances[]. */
  converted: number;
  /** Existing substances[] entries that had source/unit removed. */
  trimmed: number;
  /** Set when the note can't be converted; nothing is changed. */
  skipReason?: string;
}

export interface ConversionPlan {
  files: TFile[];
  converted: number;
  trimmed: number;
  skipped: { file: TFile; reason: string }[];
}

/**
 * Convert one frontmatter record in place.
 *
 * Nothing is ever dropped that settings can't reconstruct: a unit is only
 * removed when it matches the vitamin's configured unit, notes are always kept,
 * and per-vitamin entries that don't look like plugin entries stay where they
 * are. Plain strings already in substances[] (e.g. "- Ritalin") are left alone.
 */
export function convertFrontmatter(fm: Fm, settings: VitalLogSettings): NoteConversion {
  const result: NoteConversion = { converted: 0, trimmed: 0 };

  const existing = fm['substances'];
  if (existing !== undefined && existing !== null && !isArray(existing)) {
    const hasPerVitamin = settings.vitamins.some((v) => {
      const entries = fm[v.propertyKey];
      return isArray(entries) && entries.some(isVitaminEntry);
    });
    return hasPerVitamin ? { ...result, skipReason: '"substances" exists but is not a list' } : result;
  }

  const moved: Fm[] = [];
  for (const vitamin of settings.vitamins) {
    const key = vitamin.propertyKey;
    if (key === 'substances') continue;
    const entries = fm[key];
    if (!isArray(entries)) continue;

    const leftovers: unknown[] = [];
    for (const entry of entries) {
      if (isVitaminEntry(entry)) {
        moved.push(toSubstance({ ...(entry as unknown as Fm), name: vitamin.displayName }, vitamin, settings));
      } else {
        leftovers.push(entry);
      }
    }
    if (leftovers.length === entries.length) continue;

    if (leftovers.length === 0) delete fm[key];
    else fm[key] = leftovers;
  }
  result.converted = moved.length;

  const list: unknown[] = isArray(existing) ? existing : [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const obj = entry as Fm;
    const vitamin = settings.vitamins.find((v) => v.displayName === obj['name']);
    const trimmed = toSubstance(obj, vitamin, settings);
    if (Object.keys(trimmed).length !== Object.keys(obj).length) {
      list[i] = trimmed;
      result.trimmed++;
    }
  }

  if (moved.length > 0) {
    // Stable sort, so same-time entries keep their vitamin order.
    moved.sort((a, b) => String(a['time'] ?? '').localeCompare(String(b['time'] ?? '')));
    list.push(...moved);
    fm['substances'] = list;
  }

  return result;
}

/**
 * Build a substance entry in name/time/amount order, dropping source and
 * unit per settings. Any other keys the entry carries are kept after those.
 */
function toSubstance(entry: Fm, vitamin: Vitamin | undefined, settings: VitalLogSettings): Fm {
  const { name, time, amount, unit, source, ...rest } = entry;
  const unitIsRedundant = vitamin !== undefined && unit === vitamin.unit;
  const keepUnit = unit !== undefined && (settings.logUnit !== false || !unitIsRedundant);
  const keepSource = source !== undefined && settings.logSource !== false;
  return {
    name,
    ...(time !== undefined ? { time } : {}),
    ...(amount !== undefined ? { amount } : {}),
    ...(keepUnit ? { unit } : {}),
    ...rest,
    ...(keepSource ? { source } : {}),
  };
}

/**
 * Dry-run the conversion over every note in the vault. Reads from disk rather
 * than the metadata cache so the plan matches exactly what the write will see.
 */
export async function planConversion(app: App, settings: VitalLogSettings): Promise<ConversionPlan> {
  const plan: ConversionPlan = { files: [], converted: 0, trimmed: 0, skipped: [] };
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = await yaml.readAllFrontmatter(app, file);
    const result = convertFrontmatter(structuredClone(fm), settings);
    if (result.skipReason) {
      plan.skipped.push({ file, reason: result.skipReason });
      continue;
    }
    if (result.converted === 0 && result.trimmed === 0) continue;
    plan.files.push(file);
    plan.converted += result.converted;
    plan.trimmed += result.trimmed;
  }
  return plan;
}

/** Apply the conversion to each file, one atomic write per note. Returns the files that failed. */
export async function applyConversion(
  app: App,
  settings: VitalLogSettings,
  files: TFile[]
): Promise<TFile[]> {
  const failed: TFile[] = [];
  for (const file of files) {
    try {
      await yaml.mutateFrontmatter(app, file, (fm) => {
        convertFrontmatter(fm, settings);
      });
    } catch (err) {
      console.error(`Vital Log: failed to convert "${file.path}"`, err);
      failed.push(file);
    }
  }
  return failed;
}
