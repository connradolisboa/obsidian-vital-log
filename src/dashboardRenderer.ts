// ============================================================
// Vital Log — Dashboard renderer
//
// One render function reused by the dashboard pane (ItemView), the
// dashboard modal, and the `vital-dashboard` embed. Single-day view
// shows Goals, a "to take / do today" schedule, and "logged today".
// Range view shows per-tracker SVG sparklines + a range summary.
// ============================================================

import { setIcon } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { TrackerConfig, TallyCounterConfig, ScheduleItem, StatType } from './types';
import { STAT_LABELS, defaultDisplayStats } from './types';
import {
  fromISODate,
  toISODate,
  todayISO,
  resolveGoal,
  getGoalPlan,
  setGoalFromToday,
  getScheduledForDate,
  dateRange,
} from './planManager';
import {
  getFrontmatterForDate,
  extractTrackerValues,
  computeStat,
  trackerPrimaryStat,
  readTallyValue,
  isScheduleItemDone,
  computeGoalStreak,
} from './statsEngine';
import { resolveDailyNote } from './dailyNoteResolver';
import { logVitamin, logPack, logStack } from './vitaminManager';
import { logTracker } from './trackerManager';
import { updateTallyValue } from './tallyManager';
import { HistoryModal } from './historyModal';

function nowHHmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type Fm = Record<string, unknown>;

export interface DashboardOptions {
  date?: string;             // single-day ISO; default today
  range?: [string, string];  // [startISO, endISO] → range view
  trackerFilter?: string[];  // tracker ids or display names; undefined = all
  view?: 'day' | 'sparkline';
  navigable?: boolean;       // show ◀ date ▶ header
}

export async function renderDashboard(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  opts: DashboardOptions
): Promise<void> {
  container.empty();
  container.addClass('vital-log-dashboard');
  if (opts.range) {
    await renderRangeDashboard(plugin, container, opts);
  } else {
    await renderDayDashboard(plugin, container, opts);
  }
}

// ── Tracker selection ───────────────────────────────────────

function resolveTrackers(plugin: VitalLogPlugin, filter?: string[]): TrackerConfig[] {
  const all = plugin.settings.trackers ?? [];
  if (!filter || filter.length === 0) return all;
  const wanted = filter.map((s) => s.toLowerCase());
  return all.filter(
    (t) => wanted.includes(t.id.toLowerCase()) || wanted.includes(t.displayName.toLowerCase())
  );
}

function shiftISO(iso: string, deltaDays: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + deltaDays);
  return toISODate(d);
}

function prettyDate(iso: string): string {
  const d = fromISODate(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtStat(stat: StatType, value: number | null): string {
  if (value === null) return '—';
  return `${STAT_LABELS[stat]} ${value}`;
}

// ── Single-day dashboard ────────────────────────────────────

async function renderDayDashboard(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  opts: DashboardOptions
): Promise<void> {
  let currentISO = opts.date ?? todayISO();

  const paint = async (): Promise<void> => {
    container.empty();
    const date = fromISODate(currentISO);
    const fm = await getFrontmatterForDate(plugin.app, plugin.settings, date);
    const isToday = currentISO === todayISO();

    // Header
    const header = container.createDiv('vital-log-dashboard-header');
    if (opts.navigable) {
      const prev = header.createEl('button', { cls: 'vital-log-dashboard-nav' });
      setIcon(prev, 'chevron-left');
      prev.addEventListener('click', () => {
        currentISO = shiftISO(currentISO, -1);
        void paint();
      });
    }
    header.createDiv({ cls: 'vital-log-dashboard-date', text: prettyDate(currentISO) });
    if (opts.navigable) {
      const next = header.createEl('button', { cls: 'vital-log-dashboard-nav' });
      setIcon(next, 'chevron-right');
      next.addEventListener('click', () => {
        currentISO = shiftISO(currentISO, 1);
        void paint();
      });
      const editLog = header.createEl('button', { cls: 'vital-log-dashboard-nav' });
      setIcon(editLog, 'pencil');
      editLog.setAttribute('aria-label', 'Edit log entries for this day');
      editLog.addEventListener('click', () => {
        const modal = new HistoryModal(plugin.app, plugin.settings, () => plugin.saveSettings(), date);
        const origClose = modal.onClose.bind(modal);
        modal.onClose = () => {
          origClose();
          void paint();
        };
        modal.open();
      });

      const refresh = header.createEl('button', { cls: 'vital-log-dashboard-nav' });
      setIcon(refresh, 'refresh-cw');
      refresh.setAttribute('aria-label', 'Refresh');
      refresh.addEventListener('click', () => void paint());
    }

    buildGoalsSection(plugin, container, currentISO, fm, isToday, paint);
    buildScheduleSection(plugin, container, currentISO, fm, isToday, paint);
    await buildLoggedSection(plugin, container, currentISO, fm);
  };

  await paint();
}

function buildGoalsSection(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  dateISO: string,
  fm: Fm | null,
  isToday: boolean,
  repaint: () => Promise<void>
): void {
  const plans = (plugin.settings.plannedLogs.trackerGoals ?? []).filter((p) => p.enabled);
  if (plans.length === 0) return;

  const section = container.createDiv('vital-log-dashboard-section');
  section.createEl('h3', { text: 'Goals', cls: 'vital-log-dashboard-section-title' });

  for (const plan of plans) {
    const tracker = (plugin.settings.trackers ?? []).find((t) => t.id === plan.trackerId);
    if (!tracker) continue;

    const values = extractTrackerValues(fm, tracker);
    const primary = trackerPrimaryStat(tracker);
    const current = computeStat(values, primary);
    const goal = resolveGoal(plan, dateISO);

    const row = section.createDiv('vital-log-goal-row');

    const head = row.createDiv('vital-log-goal-head');
    const label = head.createDiv('vital-log-goal-label');
    if (tracker.icon) {
      const ic = label.createSpan({ cls: 'vital-log-goal-icon' });
      setIcon(ic, tracker.icon);
    }
    label.createSpan({ text: tracker.displayName });

    // value / goal
    const valueText = current === null ? '0' : String(current);
    const goalControls = head.createDiv('vital-log-goal-value');
    goalControls.createSpan({ text: valueText, cls: 'vital-log-goal-current' });
    goalControls.createSpan({ text: ' / ' });
    if (isToday) {
      const input = goalControls.createEl('input', {
        type: 'number',
        cls: 'vital-log-goal-input',
        value: goal !== null ? String(goal) : '',
      });
      input.placeholder = '—';
      input.addEventListener('change', async () => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          setGoalFromToday(plugin.settings, tracker.id, v);
          await plugin.saveSettings();
          await repaint();
        }
      });
    } else {
      goalControls.createSpan({ text: goal !== null ? String(goal) : '—' });
    }

    // progress bar
    if (goal && goal > 0) {
      const pct = Math.max(0, Math.min(1, (current ?? 0) / goal));
      const bar = row.createDiv('vital-log-goal-bar');
      const fill = bar.createDiv('vital-log-goal-bar-fill');
      fill.style.width = `${Math.round(pct * 100)}%`;
      if ((current ?? 0) >= goal) fill.addClass('is-complete');
    }

    // display stats
    const stats = tracker.displayStats ?? defaultDisplayStats(tracker.trackerType);
    if (stats.length > 0) {
      const statsEl = row.createDiv('vital-log-goal-stats');
      statsEl.setText(stats.map((s) => fmtStat(s, computeStat(values, s))).join(' · '));
    }

    if (isToday) {
      buildTrackerInlineLog(plugin, row, tracker, repaint);
    }
  }
}

/** Inline rating buttons / minutes stepper + optional note, writing straight to today's note. */
function buildTrackerInlineLog(
  plugin: VitalLogPlugin,
  row: HTMLElement,
  tracker: TrackerConfig,
  repaint: () => Promise<void>
): void {
  const wrap = row.createDiv('vital-log-goal-log');

  const noteInput = wrap.createEl('input', {
    type: 'text',
    cls: 'vital-log-inline-note-input',
    attr: { placeholder: 'Note (optional)' },
  });

  const doLog = async (value: number): Promise<void> => {
    const file = await resolveDailyNote(plugin.app, plugin.settings);
    if (!file) return;
    await logTracker(plugin.app, file, tracker, {
      time: nowHHmm(),
      value,
      note: noteInput.value.trim() || undefined,
    }, plugin.settings);
    await repaint();
  };

  if (tracker.trackerType === 'minutes') {
    const controls = wrap.createDiv('vital-log-embed-tally-controls');
    const input = controls.createEl('input', {
      type: 'number',
      cls: 'vital-log-embed-tracker-minutes-input',
      attr: { min: '0', step: '1', placeholder: '0' },
    });
    const logBtn = controls.createEl('button', {
      text: '✓',
      cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--inc',
      attr: { 'aria-label': `Log ${tracker.displayName}` },
    });
    logBtn.addEventListener('click', () => {
      const v = parseFloat(input.value);
      if (!isNaN(v)) void doLog(v);
    });
  } else {
    const controls = wrap.createDiv('vital-log-embed-tracker-rating-controls vital-log-embed-tally-controls');
    for (let v = tracker.min; v <= tracker.max; v++) {
      const btn = controls.createEl('button', {
        text: String(v),
        cls: 'vital-log-tracker-value-btn vital-log-tracker-value-btn--embed',
        attr: { 'aria-label': `${tracker.displayName}: ${v}` },
      });
      btn.addEventListener('click', () => void doLog(v));
    }
  }
}

function scheduleItemDisplay(
  plugin: VitalLogPlugin,
  item: ScheduleItem
): { name: string; icon?: string } | null {
  switch (item.kind) {
    case 'vitamin': {
      const v = plugin.settings.vitamins.find((x) => x.id === item.refId);
      return v ? { name: v.displayName } : null;
    }
    case 'pack': {
      const p = plugin.settings.packs.find((x) => x.id === item.refId);
      return p ? { name: p.displayName, icon: 'package' } : null;
    }
    case 'stack': {
      const s = plugin.settings.stacks.find((x) => x.id === item.refId);
      return s ? { name: s.displayName, icon: 'layers' } : null;
    }
    case 'tally': {
      const t = plugin.settings.tallyCounters.find((x) => x.id === item.refId);
      return t ? { name: t.displayName, icon: t.icon } : null;
    }
  }
}

function buildScheduleSection(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  dateISO: string,
  fm: Fm | null,
  isToday: boolean,
  repaint: () => Promise<void>
): void {
  const items = getScheduledForDate(plugin.settings, fromISODate(dateISO));
  if (items.length === 0) return;

  const section = container.createDiv('vital-log-dashboard-section');
  section.createEl('h3', { text: 'To take / do today', cls: 'vital-log-dashboard-section-title' });

  for (const item of items) {
    const disp = scheduleItemDisplay(plugin, item);
    if (!disp) continue;
    const done = isScheduleItemDone(fm, plugin.settings, item);

    const row = section.createDiv('vital-log-schedule-row');
    if (done) row.addClass('is-done');

    const check = row.createSpan('vital-log-schedule-check');
    setIcon(check, done ? 'check-circle-2' : 'circle');

    if (disp.icon) {
      const ic = row.createSpan({ cls: 'vital-log-schedule-icon' });
      setIcon(ic, disp.icon);
    }
    row.createSpan({ text: disp.name, cls: 'vital-log-schedule-name' });

    if (item.kind === 'tally') {
      const t = plugin.settings.tallyCounters.find((x) => x.id === item.refId);
      if (t) buildTallyScheduleControls(plugin, row, check, t, fm, isToday, repaint);
    } else if (isToday && !done) {
      buildSupplementInlineLog(plugin, section, row, item, repaint);
    }
  }
}

/**
 * Tally schedule controls. A tally with target <= 1 behaves as a checkbox
 * habit — clicking the row toggles it done/not-done. Larger targets get an
 * inline +/- stepper instead.
 */
function buildTallyScheduleControls(
  plugin: VitalLogPlugin,
  row: HTMLElement,
  check: HTMLElement,
  t: TallyCounterConfig,
  fm: Fm | null,
  isToday: boolean,
  repaint: () => Promise<void>
): void {
  const value = readTallyValue(fm, t.propertyKey);
  const isCheckboxHabit = t.target <= 1;

  const write = async (next: number): Promise<void> => {
    const file = await resolveDailyNote(plugin.app, plugin.settings);
    if (!file) return;
    await updateTallyValue(plugin.app, file, t, Math.max(0, next));
    await repaint();
  };

  if (isCheckboxHabit) {
    if (!isToday) return;
    row.addClass('is-clickable');
    row.addEventListener('click', () => void write(value >= t.target ? 0 : t.target));
    return;
  }

  row.createSpan({ cls: 'vital-log-schedule-meta', text: `${value}/${t.target}` });
  if (!isToday) return;

  const controls = row.createDiv('vital-log-embed-tally-controls');
  const dec = controls.createEl('button', {
    text: '−',
    cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--dec',
    attr: { 'aria-label': `Decrease ${t.displayName}` },
  });
  const inc = controls.createEl('button', {
    text: '+',
    cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--inc',
    attr: { 'aria-label': `Increase ${t.displayName}` },
  });
  dec.addEventListener('click', () => void write(value - t.step));
  inc.addEventListener('click', () => void write(value + t.step));
}

/** Inline quick-log for vitamins/packs/stacks: a checkmark button (+ note field for vitamins). */
function buildSupplementInlineLog(
  plugin: VitalLogPlugin,
  section: HTMLElement,
  row: HTMLElement,
  item: ScheduleItem,
  repaint: () => Promise<void>
): void {
  let noteInput: HTMLInputElement | null = null;

  const controls = row.createDiv('vital-log-embed-tally-controls');
  const logBtn = controls.createEl('button', {
    text: '✓',
    cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--inc',
    attr: { 'aria-label': 'Log now' },
  });

  logBtn.addEventListener('click', async () => {
    const file = await resolveDailyNote(plugin.app, plugin.settings);
    if (!file) return;
    const time = nowHHmm();
    const note = noteInput?.value.trim() || undefined;

    if (item.kind === 'vitamin') {
      const v = plugin.settings.vitamins.find((x) => x.id === item.refId);
      if (!v) return;
      await logVitamin(plugin.app, file, v, { time, amount: v.defaultAmount, note, source: 'manual' }, plugin.settings);
    } else if (item.kind === 'pack') {
      const p = plugin.settings.packs.find((x) => x.id === item.refId);
      if (!p) return;
      await logPack(plugin.app, file, p, plugin.settings, { time });
    } else if (item.kind === 'stack') {
      const s = plugin.settings.stacks.find((x) => x.id === item.refId);
      if (!s) return;
      await logStack(plugin.app, file, s, plugin.settings, { time });
    }
    await repaint();
  });

  if (item.kind === 'vitamin') {
    noteInput = section.createEl('input', {
      type: 'text',
      cls: 'vital-log-inline-note-input vital-log-schedule-note',
      attr: { placeholder: 'Note (optional)' },
    });
  }
}

interface LoggedItem {
  time: string | null; // "HH:mm" or null (untimed, e.g. tallies)
  icon?: string;
  text: string;
}

type TimeBucket = 'morning' | 'afternoon' | 'night' | 'anytime';

const TIME_BUCKETS: { key: TimeBucket; title: string }[] = [
  { key: 'anytime', title: 'Anytime' },
  { key: 'morning', title: 'Morning' },
  { key: 'afternoon', title: 'Afternoon' },
  { key: 'night', title: 'Night' },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function amountSuffix(e: Record<string, unknown>): string {
  const amount = e['amount'];
  const unit = typeof e['unit'] === 'string' ? e['unit'] : '';
  return typeof amount === 'number' ? ` ${amount}${unit}` : '';
}

function bucketForTime(time: string | null): TimeBucket {
  if (!time) return 'anytime';
  const hour = parseInt(time.split(':')[0], 10);
  if (isNaN(hour)) return 'anytime';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'night';
}

/** Collect every timed/untimed entry logged in the note into a flat list. */
function collectLoggedItems(plugin: VitalLogPlugin, fm: Fm): LoggedItem[] {
  const items: LoggedItem[] = [];

  // Vitamins — flat substances[] mode, or per-vitamin keys
  if (plugin.settings.logMode === 'substances') {
    const arr = fm['substances'];
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (!isObj(e)) continue;
        const name = asStr(e['name']);
        if (!name) continue;
        items.push({ time: asStr(e['time']), icon: 'pill', text: `${name}${amountSuffix(e)}` });
      }
    }
  } else {
    for (const v of plugin.settings.vitamins ?? []) {
      const arr = fm[v.propertyKey];
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (!isObj(e)) continue;
        items.push({ time: asStr(e['time']), icon: 'pill', text: `${v.displayName}${amountSuffix(e)}` });
      }
    }
  }

  // Packs / stacks (entries carry their own name + time)
  for (const [key, icon] of [['packs', 'package'], ['stacks', 'layers']] as const) {
    const arr = fm[key];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (!isObj(e)) continue;
      const name = asStr(e['name']);
      if (!name) continue;
      items.push({ time: asStr(e['time']), icon, text: name });
    }
  }

  // Trackers — one entry per logged value
  for (const tracker of plugin.settings.trackers ?? []) {
    const arr = fm[tracker.propertyKey];
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      if (!isObj(e)) continue;
      const value = e[tracker.valueName];
      if (typeof value !== 'number') continue;
      items.push({
        time: asStr(e['time']),
        icon: tracker.icon,
        text: `${tracker.displayName}: ${value}`,
      });
    }
  }

  // Tallies — untimed running totals
  for (const t of plugin.settings.tallyCounters ?? []) {
    const v = readTallyValue(fm, t.propertyKey);
    if (v <= 0) continue;
    items.push({ time: null, icon: t.icon, text: `${t.displayName}: ${v}/${t.target}` });
  }

  return items;
}

/** Top-of-section summary: per-tracker primary stat + goal streaks. */
async function buildSummary(
  plugin: VitalLogPlugin,
  section: HTMLElement,
  dateISO: string,
  fm: Fm | null
): Promise<void> {
  const row = section.createDiv('vital-log-summary-row');
  let any = false;

  // Per-tracker primary stat for the day
  for (const tracker of plugin.settings.trackers ?? []) {
    const values = extractTrackerValues(fm, tracker);
    if (values.length === 0) continue;
    const primary = trackerPrimaryStat(tracker);
    const value = computeStat(values, primary);
    if (value === null) continue;
    any = true;
    addSummaryChip(
      row,
      tracker.icon,
      `${tracker.displayName} ${STAT_LABELS[primary].toLowerCase()} ${value}`
    );
  }

  // Goal streaks
  for (const plan of plugin.settings.plannedLogs.trackerGoals ?? []) {
    if (!plan.enabled) continue;
    const tracker = (plugin.settings.trackers ?? []).find((t) => t.id === plan.trackerId);
    if (!tracker) continue;
    const streak = await computeGoalStreak(plugin.app, plugin.settings, tracker, plan, dateISO);
    if (streak <= 0) continue;
    any = true;
    addSummaryChip(row, 'flame', `${tracker.displayName} ${streak}-day streak`, 'is-streak');
  }

  if (!any) row.remove();
}

function addSummaryChip(
  row: HTMLElement,
  icon: string | undefined,
  text: string,
  extraClass?: string
): void {
  const chip = row.createDiv(`vital-log-summary-chip${extraClass ? ' ' + extraClass : ''}`);
  if (icon) {
    const ic = chip.createSpan({ cls: 'vital-log-summary-icon' });
    setIcon(ic, icon);
  }
  chip.createSpan({ text });
}

async function buildLoggedSection(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  dateISO: string,
  fm: Fm | null
): Promise<void> {
  const section = container.createDiv('vital-log-dashboard-section');
  section.createEl('h3', { text: 'Logged today', cls: 'vital-log-dashboard-section-title' });

  await buildSummary(plugin, section, dateISO, fm);

  const items = fm ? collectLoggedItems(plugin, fm) : [];
  if (items.length === 0) {
    section.createDiv({ cls: 'vital-log-logged-empty', text: 'Nothing logged yet.' });
    return;
  }

  for (const bucket of TIME_BUCKETS) {
    const groupItems = items
      .filter((it) => bucketForTime(it.time) === bucket.key)
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
    if (groupItems.length === 0) continue;

    const group = section.createDiv('vital-log-logged-group');
    group.createDiv({ cls: 'vital-log-logged-group-title', text: bucket.title });
    for (const it of groupItems) {
      const row = group.createDiv('vital-log-logged-entry');
      if (it.icon) {
        const ic = row.createSpan({ cls: 'vital-log-logged-icon' });
        setIcon(ic, it.icon);
      }
      if (it.time) row.createSpan({ cls: 'vital-log-logged-time', text: it.time });
      row.createSpan({ text: it.text });
    }
  }
}

// ── Range dashboard (sparklines) ────────────────────────────

async function renderRangeDashboard(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  opts: DashboardOptions
): Promise<void> {
  if (!opts.range) return;
  const [startISO, endISO] = opts.range;
  const isoDates = dateRange(startISO, endISO);

  const header = container.createDiv('vital-log-dashboard-header');
  header.createDiv({
    cls: 'vital-log-dashboard-date',
    text: `${prettyDate(startISO)} → ${prettyDate(endISO)}`,
  });

  // Read each day's frontmatter once, reuse across all trackers.
  const fmByDate = new Map<string, Fm | null>();
  for (const iso of isoDates) {
    fmByDate.set(iso, await getFrontmatterForDate(plugin.app, plugin.settings, fromISODate(iso)));
  }

  const trackers = resolveTrackers(plugin, opts.trackerFilter);
  const section = container.createDiv('vital-log-dashboard-section');

  for (const tracker of trackers) {
    const primary = trackerPrimaryStat(tracker);
    const points = isoDates.map((iso) => ({
      iso,
      value: computeStat(extractTrackerValues(fmByDate.get(iso) ?? null, tracker), primary),
    }));
    const allValues = isoDates.flatMap((iso) =>
      extractTrackerValues(fmByDate.get(iso) ?? null, tracker)
    );
    const summary = computeStat(allValues, primary);

    const row = section.createDiv('vital-log-range-row');
    const label = row.createDiv('vital-log-range-label');
    if (tracker.icon) {
      const ic = label.createSpan({ cls: 'vital-log-goal-icon' });
      setIcon(ic, tracker.icon);
    }
    label.createSpan({ text: tracker.displayName });

    renderSparkline(row, points.map((p) => p.value));

    row.createDiv({
      cls: 'vital-log-range-summary',
      text: fmtStat(primary, summary),
    });
  }
}

function renderSparkline(container: HTMLElement, values: (number | null)[]): void {
  const W = 120;
  const H = 28;
  const PAD = 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'vital-log-sparkline');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));

  const present = values.filter((v): v is number => v !== null);
  if (present.length > 0) {
    const min = Math.min(...present);
    const max = Math.max(...present);
    const span = max - min || 1;
    const n = values.length;
    const x = (i: number) => PAD + (n <= 1 ? 0 : (i / (n - 1)) * (W - 2 * PAD));
    const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);

    const coords: string[] = [];
    values.forEach((v, i) => {
      if (v !== null) coords.push(`${x(i)},${y(v)}`);
    });
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', coords.join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('class', 'vital-log-sparkline-line');
    svg.appendChild(poly);

    // last-point dot
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('cx', String(x(i)));
        dot.setAttribute('cy', String(y(values[i] as number)));
        dot.setAttribute('r', '2');
        dot.setAttribute('class', 'vital-log-sparkline-dot');
        svg.appendChild(dot);
        break;
      }
    }
  }
  container.createDiv('vital-log-range-chart').appendChild(svg);
}

