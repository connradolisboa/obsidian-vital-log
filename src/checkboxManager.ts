// ============================================================
// Vital Log — Checkbox Manager
// Handles reading/writing boolean checkbox habits to frontmatter.
// The single write path shared by dashboard, schedule, and inline widgets.
// ============================================================

import { App, TFile } from 'obsidian';
import type { Metric } from './types';
import { readCheckboxEntry, setCheckboxEntry } from './yamlManager';

export async function readCheckbox(app: App, file: TFile, config: Metric): Promise<boolean> {
  return readCheckboxEntry(app, file, config.propertyKey);
}

export async function setCheckboxValue(
  app: App,
  file: TFile,
  config: Metric,
  value: boolean
): Promise<void> {
  await setCheckboxEntry(app, file, config.propertyKey, value);
}

export async function toggleCheckboxValue(
  app: App,
  file: TFile,
  config: Metric
): Promise<boolean> {
  const next = !(await readCheckbox(app, file, config));
  await setCheckboxValue(app, file, config, next);
  return next;
}
