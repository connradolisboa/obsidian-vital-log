// ============================================================
// Vital Log — Vitamin Manager
// Business logic for logging vitamins, packs, and stacks.
// Zero UI, zero direct file I/O — delegates to yamlManager.
// ============================================================

import { App, Notice, TFile } from 'obsidian';
import type {
  Vitamin,
  Pack,
  Stack,
  VitalLogSettings,
  VitaminEntry,
  SubstanceEntry,
  PackEntry,
  StackEntry,
  StackItemType,
} from './types';
import * as yaml from './yamlManager';

// ── Template helper ──────────────────────────────────────────

/**
 * Substitute {token} placeholders in a template string.
 * Unknown/missing tokens are replaced with empty string.
 * Collapses multiple consecutive spaces and trims the result.
 */
function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  // Collapse runs of spaces that result from empty tokens
  result = result.replace(/ {2,}/g, ' ').trimEnd();
  return result;
}

const DEFAULT_SUPPLEMENT_TEMPLATE = '- {time} {name} {amount}{unit}';

// ── Public API ───────────────────────────────────────────────

/**
 * Log a single vitamin manually.
 * Pass `appendToNote: true` to also write a line to the note body using the template from settings.
 */
export async function logVitamin(
  app: App,
  file: TFile,
  vitamin: Vitamin,
  opts: { time: string; amount: number; note?: string; source?: string; appendToNote?: boolean },
  settings: VitalLogSettings
): Promise<void> {
  const includeSource = settings.logSource !== false;

  if (settings.logMode === 'substances') {
    const entry: SubstanceEntry = {
      name: vitamin.displayName,
      amount: opts.amount,
      unit: vitamin.unit,
      time: opts.time,
      ...(opts.note ? { note: opts.note } : {}),
      ...(includeSource && opts.source ? { source: opts.source } : {}),
    };
    await yaml.appendEntry(app, file, 'substances', entry);
  } else {
    const entry: VitaminEntry = {
      time: opts.time,
      amount: opts.amount,
      unit: vitamin.unit,
      ...(opts.note ? { note: opts.note } : {}),
      ...(includeSource ? { source: opts.source ?? 'manual' } : {}),
    };
    await yaml.appendEntry(app, file, vitamin.propertyKey, entry);
  }

  if (opts.appendToNote) {
    const template = settings.noteContentTemplate_supplements || DEFAULT_SUPPLEMENT_TEMPLATE;
    const line = applyTemplate(template, {
      time: opts.time,
      name: vitamin.displayName,
      amount: String(opts.amount),
      unit: vitamin.unit,
      note: opts.note ?? '',
    });
    await yaml.appendLineToBody(app, file, line);
  }
}

/**
 * Log a pack (and all its vitamins).
 * @param source - "manual" or a stack displayName
 * Pass `appendToNote: true` to also write a line to the note body using the template from settings.
 * Note: only the pack name is written to note content — not the individual vitamins.
 */
export async function logPack(
  app: App,
  file: TFile,
  pack: Pack,
  settings: VitalLogSettings,
  opts: { time: string; source?: string; appendToNote?: boolean }
): Promise<void> {
  const source = opts.source ?? 'manual';
  const includeSource = settings.logSource !== false;

  // 1. Append pack entry (optional)
  if (settings.logPackEntries !== false) {
    const packEntry: PackEntry = {
      time: opts.time,
      name: pack.displayName,
      ...(includeSource ? { source } : {}),
    };
    await yaml.appendEntry(app, file, 'packs', packEntry);
  }

  // 2. Append each vitamin entry (no per-vitamin note content — pack handles that)
  const skipped: string[] = [];
  for (const item of pack.items) {
    const vitamin = settings.vitamins.find((v) => v.id === item.vitaminId);
    if (!vitamin) {
      skipped.push(item.vitaminId);
      continue;
    }
    await logVitamin(app, file, vitamin, {
      time: opts.time,
      amount: item.amount,
      source: pack.displayName,
    }, settings);
  }

  if (skipped.length > 0) {
    new Notice(
      `Vital Log: Pack "${pack.displayName}" references unknown vitamin IDs: ${skipped.join(', ')}. ` +
      `Those items were skipped.`
    );
  }

  if (opts.appendToNote) {
    const template = settings.noteContentTemplate_supplements || DEFAULT_SUPPLEMENT_TEMPLATE;
    const line = applyTemplate(template, {
      time: opts.time,
      name: pack.displayName,
      amount: '',
      unit: '',
      note: '',
    });
    await yaml.appendLineToBody(app, file, line);
  }
}

/**
 * Log a stack (and all its packs and standalone vitamins).
 * Pass `appendToNote: true` to write a single line listing all stack items to the note body.
 * The {name} token is replaced with a comma-joined list of items (e.g. "Vitamin C 500mg, Morning Pack").
 */
export async function logStack(
  app: App,
  file: TFile,
  stack: Stack,
  settings: VitalLogSettings,
  opts: { time: string; appendToNote?: boolean }
): Promise<void> {
  // 1. Append stack entry (optional)
  if (settings.logStackEntries !== false) {
    const stackEntry: StackEntry = { time: opts.time, name: stack.displayName };
    await yaml.appendEntry(app, file, 'stacks', stackEntry);
  }

  // 2. Process each item (no per-item note content — stack handles that below)
  const skipped: string[] = [];
  for (const item of stack.items) {
    await processStackItem(app, file, item, stack, settings, opts, skipped);
  }

  if (skipped.length > 0) {
    new Notice(
      `Vital Log: Stack "${stack.displayName}" had unknown references: ${skipped.join(', ')}. ` +
      `Those items were skipped.`
    );
  }

  if (opts.appendToNote) {
    // Build a comma-joined list of all included items
    const itemNames: string[] = [];
    for (const item of stack.items) {
      if (item.type === 'vitamin') {
        const vitamin = settings.vitamins.find((v) => v.id === item.vitaminId);
        if (!vitamin) continue;
        const amount = item.amount ?? vitamin.defaultAmount;
        itemNames.push(`${vitamin.displayName} ${amount}${vitamin.unit}`);
      } else {
        const pack = settings.packs.find((p) => p.id === item.packId);
        if (!pack) continue;
        itemNames.push(pack.displayName);
      }
    }

    const template = settings.noteContentTemplate_supplements || DEFAULT_SUPPLEMENT_TEMPLATE;
    const line = applyTemplate(template, {
      time: opts.time,
      name: itemNames.join(', '),
      amount: '',
      unit: '',
      note: '',
    });
    await yaml.appendLineToBody(app, file, line);
  }
}

// ── Helpers ──────────────────────────────────────────────────

async function processStackItem(
  app: App,
  file: TFile,
  item: StackItemType,
  stack: Stack,
  settings: VitalLogSettings,
  opts: { time: string },
  skipped: string[]
): Promise<void> {
  if (item.type === 'pack') {
    const pack = settings.packs.find((p) => p.id === item.packId);
    if (!pack) {
      skipped.push(`pack:${item.packId}`);
      return;
    }
    await logPack(app, file, pack, settings, { time: opts.time, source: stack.displayName });
  } else {
    const vitamin = settings.vitamins.find((v) => v.id === item.vitaminId);
    if (!vitamin) {
      skipped.push(`vitamin:${item.vitaminId}`);
      return;
    }
    const amount = item.amount ?? vitamin.defaultAmount;
    await logVitamin(app, file, vitamin, {
      time: opts.time,
      amount,
      source: stack.displayName,
    }, settings);
  }
}
