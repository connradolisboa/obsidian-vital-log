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
  PackEntry,
  StackEntry,
  StackItemType,
} from './types';
import * as yaml from './yamlManager';

// ── Public API ───────────────────────────────────────────────

/**
 * Log a single vitamin manually.
 */
export async function logVitamin(
  app: App,
  file: TFile,
  vitamin: Vitamin,
  opts: { time: string; amount: number; note?: string; source?: string }
): Promise<void> {
  const entry: VitaminEntry = {
    time: opts.time,
    amount: opts.amount,
    unit: vitamin.unit,
    ...(opts.note ? { note: opts.note } : {}),
    source: opts.source ?? 'manual',
  };
  await yaml.appendEntry(app, file, vitamin.propertyKey, entry);
}

/**
 * Log a pack (and all its vitamins).
 * @param source - "manual" or a stack displayName
 */
export async function logPack(
  app: App,
  file: TFile,
  pack: Pack,
  settings: VitalLogSettings,
  opts: { time: string; source?: string }
): Promise<void> {
  const source = opts.source ?? 'manual';

  // 1. Append pack entry
  const packEntry: PackEntry = { time: opts.time, name: pack.displayName, source };
  await yaml.appendEntry(app, file, 'packs', packEntry);

  // 2. Append each vitamin entry
  const skipped: string[] = [];
  for (const item of pack.items) {
    const vitamin = settings.vitamins.find((v) => v.id === item.vitaminId);
    if (!vitamin) {
      skipped.push(item.vitaminId);
      continue;
    }
    const entry: VitaminEntry = {
      time: opts.time,
      amount: item.amount,
      unit: vitamin.unit,
      source: pack.displayName,
    };
    await yaml.appendEntry(app, file, vitamin.propertyKey, entry);
  }

  if (skipped.length > 0) {
    new Notice(
      `Vital Log: Pack "${pack.displayName}" references unknown vitamin IDs: ${skipped.join(', ')}. ` +
      `Those items were skipped.`
    );
  }
}

/**
 * Log a stack (and all its packs and standalone vitamins).
 */
export async function logStack(
  app: App,
  file: TFile,
  stack: Stack,
  settings: VitalLogSettings,
  opts: { time: string }
): Promise<void> {
  // 1. Append stack entry
  const stackEntry: StackEntry = { time: opts.time, name: stack.displayName };
  await yaml.appendEntry(app, file, 'stacks', stackEntry);

  // 2. Process each item
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
    // Log pack with stack as the source
    await logPack(app, file, pack, settings, { time: opts.time, source: stack.displayName });
    // Note: logPack already writes the pack entry with source = stack.displayName
    // We need to override the pack's source field — this is handled in logPack via opts.source
  } else {
    // Standalone vitamin in the stack
    const vitamin = settings.vitamins.find((v) => v.id === item.vitaminId);
    if (!vitamin) {
      skipped.push(`vitamin:${item.vitaminId}`);
      return;
    }
    const amount = item.amount ?? vitamin.defaultAmount;
    const entry: VitaminEntry = {
      time: opts.time,
      amount,
      unit: vitamin.unit,
      source: stack.displayName,
    };
    await yaml.appendEntry(app, file, vitamin.propertyKey, entry);
  }
}
