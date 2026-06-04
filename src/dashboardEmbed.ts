// ============================================================
// Vital Log — Dashboard embed (`vital-dashboard` code block)
//
// Renders a (non-navigable) dashboard inline in a note.
//
// Usage (one `key: value` per line, all optional):
//   ```vital-dashboard
//   date: 2026-06-03
//   ```
//   ```vital-dashboard
//   range: 2026-06-01..2026-06-07
//   trackers: mood, meditation
//   view: sparkline
//   ```
//
// Defaults: with no `date`/`range`, uses the note's own date (when the
// note path matches the daily-note template) or today. `view: sparkline`
// implies a range; without an explicit range it spans the last 7 days.
// ============================================================

import type VitalLogPlugin from '../main';
import { extractDateFromPath } from './dailyNoteResolver';
import { renderDashboard, type DashboardOptions } from './dashboardRenderer';
import { toISODate, todayISO, shiftDaysISO } from './planManager';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerDashboardEmbed(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('vital-dashboard', async (source, el, ctx) => {
    const params = parseParams(source);
    const opts = buildOptions(plugin, params, ctx.sourcePath);
    try {
      await renderDashboard(plugin, el, opts);
    } catch (err) {
      el.empty();
      el.createDiv({ cls: 'vital-log-dashboard-error', text: 'Vital Log: failed to render dashboard.' });
      console.error('Vital Log dashboard embed:', err);
    }
  });
}

function parseParams(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function buildOptions(
  plugin: VitalLogPlugin,
  params: Record<string, string>,
  sourcePath?: string
): DashboardOptions {
  const opts: DashboardOptions = {};

  if (params['trackers']) {
    opts.trackerFilter = params['trackers']
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const view = params['view'];
  if (view === 'sparkline' || view === 'day') opts.view = view;

  // Range: "YYYY-MM-DD..YYYY-MM-DD"
  if (params['range']) {
    const [a, b] = params['range'].split('..').map((s) => s.trim());
    if (ISO_RE.test(a) && ISO_RE.test(b)) {
      opts.range = [a, b];
      return opts;
    }
  }

  // sparkline without an explicit range → last 7 days ending on the resolved date
  const baseDate = resolveBaseDate(plugin, params, sourcePath);
  if (opts.view === 'sparkline') {
    opts.range = [shiftDaysISO(baseDate, -6), baseDate];
    return opts;
  }

  opts.date = baseDate;
  return opts;
}

function resolveBaseDate(
  plugin: VitalLogPlugin,
  params: Record<string, string>,
  sourcePath?: string
): string {
  if (params['date'] && ISO_RE.test(params['date'])) return params['date'];
  if (sourcePath) {
    const d = extractDateFromPath(sourcePath, plugin.settings.dailyNotePath);
    if (d) return toISODate(d);
  }
  return todayISO();
}
