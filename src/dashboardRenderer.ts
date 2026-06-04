// ============================================================
// Vital Log — Dashboard renderer
//
// One render function reused by the dashboard pane (ItemView), the
// dashboard modal, and the `vital-dashboard` embed. Single-day view
// shows Goals, a "to take / do today" schedule, and "logged today".
// Range view shows per-tracker SVG sparklines + a range summary.
// ============================================================

import { setIcon, Modal } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { TrackerConfig, ScheduleItem, StatType } from './types';
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
} from './statsEngine';
import { LogModal } from './logModal';
import { TrackerModal } from './trackerModal';

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
      const refresh = header.createEl('button', { cls: 'vital-log-dashboard-nav' });
      setIcon(refresh, 'refresh-cw');
      refresh.setAttribute('aria-label', 'Refresh');
      refresh.addEventListener('click', () => void paint());
    }

    buildGoalsSection(plugin, container, currentISO, fm, isToday, paint);
    buildScheduleSection(plugin, container, currentISO, fm, isToday, paint);
    buildLoggedSection(plugin, container, fm);
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
      row.addClass('is-clickable');
      label.addEventListener('click', () => {
        openWithRefresh(
          new TrackerModal(plugin.app, plugin.settings, () => plugin.saveSettings(), tracker.id),
          repaint
        );
      });
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

    // Tally shows value/target
    if (item.kind === 'tally') {
      const t = plugin.settings.tallyCounters.find((x) => x.id === item.refId);
      if (t) {
        row.createSpan({
          cls: 'vital-log-schedule-meta',
          text: `${readTallyValue(fm, t.propertyKey)}/${t.target}`,
        });
      }
    }

    // Vitamins/packs/stacks can be logged from the existing LogModal (targets today's note)
    if (isToday && item.kind !== 'tally' && !done) {
      row.addClass('is-clickable');
      const type = item.kind as 'vitamin' | 'pack' | 'stack';
      row.addEventListener('click', () => {
        openWithRefresh(
          new LogModal(plugin.app, plugin.settings, () => plugin.saveSettings(), type),
          repaint
        );
      });
    }
  }
}

function buildLoggedSection(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  fm: Fm | null
): void {
  const section = container.createDiv('vital-log-dashboard-section');
  section.createEl('h3', { text: 'Logged today', cls: 'vital-log-dashboard-section-title' });
  const list = section.createDiv('vital-log-logged-list');
  let any = false;

  // Trackers with entries
  for (const tracker of plugin.settings.trackers ?? []) {
    const values = extractTrackerValues(fm, tracker);
    if (values.length === 0) continue;
    any = true;
    const primary = trackerPrimaryStat(tracker);
    addLoggedChip(list, tracker.icon, `${tracker.displayName}: ${computeStat(values, primary)}`);
  }

  // Tallies with a value
  for (const t of plugin.settings.tallyCounters ?? []) {
    const v = readTallyValue(fm, t.propertyKey);
    if (v <= 0) continue;
    any = true;
    addLoggedChip(list, t.icon, `${t.displayName}: ${v}/${t.target}`);
  }

  // Vitamins / packs / stacks present in the note
  if (fm) {
    for (const v of plugin.settings.vitamins ?? []) {
      const arr = fm[v.propertyKey];
      if (Array.isArray(arr) && arr.length > 0) {
        any = true;
        addLoggedChip(list, 'pill', `${v.displayName} ×${arr.length}`);
      }
    }
  }

  if (!any) {
    list.createDiv({ cls: 'vital-log-logged-empty', text: 'Nothing logged yet.' });
  }
}

function addLoggedChip(list: HTMLElement, icon: string | undefined, text: string): void {
  const chip = list.createDiv('vital-log-logged-chip');
  if (icon) {
    const ic = chip.createSpan({ cls: 'vital-log-logged-icon' });
    setIcon(ic, icon);
  }
  chip.createSpan({ text });
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

// ── Helpers ─────────────────────────────────────────────────

/** Open a modal and refresh the dashboard once it closes. */
function openWithRefresh(modal: Modal, repaint: () => Promise<void>): void {
  const origClose = modal.onClose.bind(modal);
  modal.onClose = () => {
    origClose();
    void repaint();
  };
  modal.open();
}
