// ============================================================
// Vital Log — Day viewer (`vital-day` code block)
//
// A read-only view of everything logged in a daily note, with tabs.
// Styled as a `vital-log` embed and configured the same way:
//
//   ```vital-day
//   Day
//   -
//   ```
//
// Lines, all optional:
//   <tab name>          — tab to open on: chart, timeline, substances,
//                         trackers, symptoms, events, time, week, insights
//   <title>             — header text (default "Day")
//   + / -               — collapsible, starting open / collapsed
//   tabs: a, b, …       — which tabs to show, in order
//
// The note shown is the one the block sits in when that's a daily note.
// Blocks injected by other plugins (Virtual Content) or rendered from a
// non-daily note follow the active note instead. The open tab, chart
// comparison, and collapsed state are kept for the session, so a
// re-render doesn't reset them but a fresh start uses the block's own.
// ============================================================

import { Component, MarkdownRenderChild, Notice, setIcon, TFile } from 'obsidian';
import type VitalLogPlugin from '../main';
import { getDailyNoteIfExists, noteDateForTemplate } from './dailyNoteResolver';
import { formatMinutes, getManagementApi, type ManagementApi } from './managementTracker';
import type { RenderDayOptions } from './api';
import { DAY_TABS, type DayTab } from './dayTabs';
import * as yaml from './yamlManager';
import {
  collectDayLog,
  isEmptyDay,
  substanceTotals,
  timeline,
  type DayLog,
  type TimelineItem,
} from './dayLog';
import { renderSparkline } from './dashboardRenderer';
import { renderDayChart, minutesOf, hourRange } from './dayChart';
import { attachSessions, loadHistory, loggedDays, symptomsCarriedInto } from './dayHistory';
import { findInsights, heatmapRow, hourlyAverage, symptomsAfterDoses, trackerPoints, type ChartPoint } from './dayStats';
import { symptomCalendar, symptomEpisodes, symptomsNextDay, weeklySymptomTotals } from './symptomStats';
import { shieldFromEditor } from './embedRenderer';
import { VitalLogModal, type LogTab } from './vitalLogModal';
import { SEVERITY_LABELS, seriesMetrics } from './types';
import { toISODate } from './planManager';

type CompareMode = 'none' | 'yesterday' | 'week';

const ALL_TABS: readonly { id: DayTab; label: string; icon: string }[] = DAY_TABS;

const COMPARE_MODES: { id: CompareMode; label: string }[] = [
  { id: 'none', label: 'Today' },
  { id: 'yesterday', label: 'vs yesterday' },
  { id: 'week', label: 'vs 7-day avg' },
];

const HEATMAP_SPANS = [7, 14, 30];
const INSIGHT_DAYS = 30;

/** Which log-modal tab the "+" button opens from each viewer tab. */
const LOG_TAB_FOR: Record<DayTab, LogTab> = {
  chart: 'trackers',
  timeline: 'supplements',
  substances: 'supplements',
  trackers: 'trackers',
  symptoms: 'symptoms',
  events: 'events',
  time: 'trackers', // unused: "+" opens the Time Tracker on this tab
  week: 'trackers',
  insights: 'supplements',
};

const TIME_BUCKETS: { title: string; test: (hour: number | null) => boolean }[] = [
  { title: 'Anytime', test: (h) => h === null },
  { title: 'Morning', test: (h) => h !== null && h < 12 },
  { title: 'Afternoon', test: (h) => h !== null && h >= 12 && h < 18 },
  { title: 'Evening', test: (h) => h !== null && h >= 18 },
];

interface ViewerOptions {
  /** Key for the session state; blocks with the same title share it. */
  stateKey: string;
  tabs: DayTab[];
  defaultTab: DayTab;
  collapsible: boolean;
  defaultOpen: boolean;
  title: string;
}

interface ViewerState {
  tab: DayTab;
  collapsed: boolean;
  compare: CompareMode;
  heatmapTrackerId: string;
  heatmapDays: number;
  symptomRange: number;
}

/**
 * View state per title, for the session — the same behaviour as
 * `vital-log` embeds' collapse, so a re-render (Virtual Content
 * re-injecting the block, a note switch) keeps what the user picked while
 * a fresh session starts from the block's own options.
 */
const sessionState = new Map<string, ViewerState>();

// ── Options + per-device state ───────────────────────────────

export function parseDayViewerOptions(source: string): ViewerOptions {
  const valid = new Set(ALL_TABS.map((t) => t.id));
  let title = '';
  let collapsible = false;
  let defaultOpen = true;
  let tabs: DayTab[] = [];
  let requested: string | undefined;

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line === '+' || line === '-') {
      collapsible = true;
      defaultOpen = line === '+';
      continue;
    }
    if (valid.has(line.toLowerCase() as DayTab)) {
      requested = line.toLowerCase();
      continue;
    }
    const idx = line.indexOf(':');
    const key = idx === -1 ? '' : line.slice(0, idx).trim().toLowerCase();
    const value = idx === -1 ? '' : line.slice(idx + 1).trim();
    if (key === 'tabs') {
      tabs = value
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t): t is DayTab => valid.has(t as DayTab));
    } else if (key === 'default') {
      requested = value.toLowerCase();
    } else if (!title) {
      title = line;
    }
  }

  const resolvedTabs = tabs.length > 0 ? tabs : ALL_TABS.map((t) => t.id);
  return {
    stateKey: title || 'Day',
    tabs: resolvedTabs,
    defaultTab: requested && resolvedTabs.includes(requested as DayTab) ? (requested as DayTab) : resolvedTabs[0],
    collapsible,
    defaultOpen,
    title: title || 'Day',
  };
}

function loadState(opts: ViewerOptions): ViewerState {
  let state = sessionState.get(opts.stateKey);
  if (!state || !opts.tabs.includes(state.tab)) {
    state = {
      tab: opts.defaultTab,
      collapsed: opts.collapsible && !opts.defaultOpen,
      compare: 'week',
      heatmapTrackerId: '',
      heatmapDays: 14,
      symptomRange: 30,
      ...(state ? { collapsed: state.collapsed } : {}),
    };
    sessionState.set(opts.stateKey, state);
  }
  if (!opts.collapsible) state.collapsed = false;
  return state;
}

// ── Mounting ─────────────────────────────────────────────────

/** Which note a viewer shows, and for what day. */
interface ViewerTarget {
  file: TFile | null;
  date: Date | null;
  /** True when the note was picked as "the active note" and must follow it. */
  followsActive: boolean;
}

interface Viewer {
  plugin: VitalLogPlugin;
  el: HTMLElement;
  opts: ViewerOptions;
  state: ViewerState;
  target: ViewerTarget;
  /** Shown in the body when there's no note to show. */
  emptyText: string;
  redraw: () => void;
}

/**
 * Draw a viewer into `el` and keep it current for as long as `component`
 * lives: when the note's frontmatter changes, when the note is created,
 * when Management Tracker's sessions change, and (for blocks that follow
 * it) when the active note changes.
 */
function mountViewer(
  plugin: VitalLogPlugin,
  el: HTMLElement,
  component: Component,
  opts: ViewerOptions,
  resolve: () => ViewerTarget,
  emptyText: string
): void {
  shieldFromEditor(el);

  let drawing = false;
  let pending = false;
  let mtUnsubscribe: (() => void) | null = null;
  let mtTimer: number | null = null;

  const viewer: Viewer = {
    plugin,
    el,
    opts,
    state: loadState(opts),
    target: resolve(),
    emptyText,
    redraw: () => void draw(),
  };

  // Management Tracker may load after Vital Log, so subscribe on the first
  // draw that finds its API rather than only at mount.
  const subscribeToSessions = (): void => {
    if (mtUnsubscribe) return;
    const api = getManagementApi(plugin.app);
    if (!api) return;
    mtUnsubscribe = api.onChange(() => {
      // The index changes on many edits; coalesce bursts into one redraw.
      if (mtTimer !== null) window.clearTimeout(mtTimer);
      mtTimer = window.setTimeout(() => {
        mtTimer = null;
        void draw();
      }, 300);
    });
  };

  async function draw(): Promise<void> {
    if (drawing) {
      pending = true;
      return;
    }
    drawing = true;
    try {
      subscribeToSessions();
      await renderViewer(viewer);
    } catch (err) {
      el.empty();
      el.createDiv({ cls: 'vital-log-dashboard-error', text: 'Vital Log: failed to render day view.' });
      console.error('Vital Log day viewer:', err);
    } finally {
      drawing = false;
      if (pending) {
        pending = false;
        void draw();
      }
    }
  }

  void draw();

  component.register(() => {
    mtUnsubscribe?.();
    mtUnsubscribe = null;
    if (mtTimer !== null) window.clearTimeout(mtTimer);
  });
  component.registerEvent(
    plugin.app.metadataCache.on('changed', (file) => {
      if (viewer.target.file && file.path === viewer.target.file.path) void draw();
    })
  );
  // A day whose note didn't exist yet gets one (e.g. logged via "+").
  component.registerEvent(
    plugin.app.vault.on('create', () => {
      if (viewer.target.file) return;
      viewer.target = resolve();
      if (viewer.target.file) void draw();
    })
  );
  component.registerEvent(
    plugin.app.workspace.on('file-open', (file) => {
      if (!viewer.target.followsActive || (file?.path ?? null) === (viewer.target.file?.path ?? null)) return;
      viewer.target = resolve();
      void draw();
    })
  );
}

export function registerDayViewer(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('vital-day', (source, el, ctx) => {
    const opts = parseDayViewerOptions(source);
    const child = new MarkdownRenderChild(el);
    ctx.addChild(child);

    // The note the block sits in when that's a daily note; otherwise
    // (Virtual Content with an unexpected path, a non-daily note) the active note.
    const resolve = (): ViewerTarget => {
      const { app, settings } = plugin;
      const source = app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (source instanceof TFile) {
        const date = noteDateForTemplate(source.path, settings.dailyNotePath);
        if (date) return { file: source, date, followsActive: false };
      }
      const file = app.workspace.getActiveFile() ?? (source instanceof TFile ? source : null);
      const date = file ? noteDateForTemplate(file.path, settings.dailyNotePath) : null;
      return { file, date, followsActive: true };
    };

    mountViewer(plugin, el, child, opts, resolve, 'No note is open.');
  });
}

/**
 * Public API entry point: draw the day viewer for a fixed date into `el`,
 * with its listeners registered on `component`. Unlike the code block it
 * never falls back to the active note — a day without a note shows an empty
 * state, and fills in if the note is created later.
 */
export function renderDayView(
  plugin: VitalLogPlugin,
  el: HTMLElement,
  options: RenderDayOptions,
  component: Component
): void {
  const date = parseDayOption(options.date);
  if (!date) {
    el.empty();
    el.createDiv({ cls: 'vital-log-embed-empty', text: `Vital Log: invalid date "${String(options.date)}".` });
    return;
  }

  // Build options directly rather than via the block parser, so a title that
  // happens to be a tab name (or an unknown tab) can't be misread.
  const opts = parseDayViewerOptions(
    options.tabs && options.tabs.length > 0 ? `tabs: ${options.tabs.join(', ')}` : ''
  );
  const tab = options.tab?.trim().toLowerCase() as DayTab | undefined;
  if (tab && opts.tabs.includes(tab)) opts.defaultTab = tab;
  opts.title = options.title?.trim() || 'Day';
  opts.stateKey = `api:${opts.title}`;

  const iso = toISODate(date);
  mountViewer(
    plugin,
    el,
    component,
    opts,
    () => ({ file: getDailyNoteIfExists(plugin.app, plugin.settings, date), date, followsActive: false }),
    `No daily note for ${iso}.`
  );
}

function parseDayOption(value: string | Date): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!m) return null;
  const date = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12);
  return isNaN(date.getTime()) || toISODate(date) !== m[0] ? null : date;
}

// ── Rendering ────────────────────────────────────────────────

/** Tabs to show right now: the Time tab needs Management Tracker. */
function visibleTabs(opts: ViewerOptions, mt: ManagementApi | null): DayTab[] {
  return opts.tabs.filter((t) => t !== 'time' || mt !== null);
}

async function renderViewer(viewer: Viewer): Promise<void> {
  const { plugin, el, opts, state } = viewer;
  const { file: target, date: noteDate } = viewer.target;
  const fm = target ? await yaml.readAllFrontmatter(plugin.app, target) : {};
  // Symptoms still active from earlier days carry into this one.
  const carried = noteDate ? symptomsCarriedInto(plugin.app, plugin.settings, noteDate) : new Map();
  const log = collectDayLog(fm, plugin.settings, carried);

  const mt = getManagementApi(plugin.app);
  if (noteDate) attachSessions(plugin.app, log, noteDate);

  const tabs = visibleTabs(opts, mt);
  if (tabs.length > 0 && !tabs.includes(state.tab)) state.tab = tabs[0];

  el.empty();
  el.addClass('vital-log-embed', 'vital-log-day');
  el.toggleClass('vital-log-embed--collapsed', state.collapsed);

  // ── Header (same structure and classes as a vital-log embed) ──
  const header = el.createDiv('vital-log-embed-header');
  if (opts.collapsible) {
    header.addClass('vital-log-embed-header--collapsible');
    const chevron = header.createEl('button', {
      cls: 'vital-log-embed-header-btn vital-log-embed-header-chevron' + (state.collapsed ? ' is-collapsed' : ''),
      attr: { 'aria-label': 'Toggle' },
    });
    setIcon(chevron, 'chevron-down');
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.vital-log-day-add')) return;
      state.collapsed = !state.collapsed;
      el.toggleClass('vital-log-embed--collapsed', state.collapsed);
      chevron.toggleClass('is-collapsed', state.collapsed);
    });
  }
  header.createSpan({ cls: 'vital-log-embed-header-title', text: opts.title });
  renderSummary(header.createDiv('vital-log-day-summary'), log);

  const onTimeTab = state.tab === 'time' && mt !== null;
  const addBtn = header.createEl('button', {
    cls: 'vital-log-embed-header-btn vital-log-day-add',
    attr: { 'aria-label': onTimeTab ? 'Open Time Tracker' : 'Log something' },
  });
  setIcon(addBtn, 'plus');
  addBtn.addEventListener('click', () => {
    if (state.tab === 'time' && mt) {
      mt.openTimeTracker();
      return;
    }
    new VitalLogModal(plugin.app, plugin.settings, () => plugin.saveSettings(), {
      tab: LOG_TAB_FOR[state.tab],
      date: noteDate ?? undefined,
    }).open();
  });

  // ── Body ──
  const body = el.createDiv('vital-log-embed-body');
  if (!target) {
    body.createDiv({ cls: 'vital-log-embed-empty', text: viewer.emptyText });
    return;
  }

  if (tabs.length > 1) {
    const tabBar = body.createDiv('vital-log-day-tabs');
    for (const t of tabs.map((id) => ALL_TABS.find((x) => x.id === id)!)) {
      const count = tabCount(log, t.id);
      const btn = tabBar.createEl('button', {
        cls: 'vital-log-day-tab' + (state.tab === t.id ? ' is-active' : ''),
        attr: { 'aria-pressed': String(state.tab === t.id), 'aria-label': t.label },
      });
      setIcon(btn.createSpan('vital-log-day-tab-icon'), t.icon);
      btn.createSpan({ cls: 'vital-log-day-tab-label', text: t.label });
      if (count > 0) btn.createSpan({ cls: 'vital-log-day-tab-count', text: String(count) });
      btn.addEventListener('click', () => {
        if (state.tab === t.id) return;
        state.tab = t.id;
        viewer.redraw();
      });
    }
  }

  const panel = body.createDiv('vital-log-day-panel');
  switch (state.tab) {
    case 'chart': renderChartTab(plugin, panel, log, state, noteDate, viewer.redraw); break;
    case 'week': renderWeekTab(plugin, panel, state, noteDate ?? new Date(), viewer.redraw); break;
    case 'insights': renderInsightsTab(plugin, panel, noteDate ?? new Date()); break;
    case 'time': if (mt) renderTimeTab(panel, log, mt); break;
    case 'timeline': renderTimeline(panel, log); break;
    case 'substances': renderSubstances(panel, log); break;
    case 'trackers': renderTrackers(panel, log); break;
    case 'symptoms': renderSymptoms(plugin, panel, log, state, noteDate ?? new Date(), viewer.redraw); break;
    case 'events': renderEvents(panel, log); break;
  }
}

function tabCount(log: DayLog, tab: DayTab): number {
  switch (tab) {
    case 'chart':
    case 'week':
    case 'insights':
      return 0;
    case 'time': return log.sessions.length;
    case 'symptoms': return log.symptoms.length;
    case 'timeline': return timeline(log).length;
    case 'substances': return substanceTotals(log).length + log.packs.length + log.stacks.length;
    case 'trackers': return log.trackers.length + log.tallies.length + log.habits.length;
    case 'events': return log.events.length;
  }
}

/** Compact counts shown in the header, most useful when collapsed. */
function renderSummary(container: HTMLElement, log: DayLog): void {
  const parts: [string, number][] = [
    ['pill', log.doses.length],
    ['activity', log.trackers.reduce((n, t) => n + t.readings.length, 0)],
    ['check-circle', log.tallies.length + log.habits.length],
    ['thermometer', log.symptoms.length],
    ['calendar-clock', log.events.length],
  ];
  for (const [icon, count] of parts) {
    if (count === 0) continue;
    const chip = container.createSpan('vital-log-day-summary-chip');
    setIcon(chip.createSpan('vital-log-day-summary-icon'), icon);
    chip.createSpan({ text: String(count) });
  }
  const minutes = log.sessions.reduce((sum, s) => sum + s.minutes, 0);
  if (minutes > 0) {
    const chip = container.createSpan('vital-log-day-summary-chip');
    setIcon(chip.createSpan('vital-log-day-summary-icon'), 'timer');
    chip.createSpan({ text: formatMinutes(minutes) });
  }
}

// ── Time tab (Management Tracker sessions) ───────────────────

function renderTimeTab(panel: HTMLElement, log: DayLog, mt: ManagementApi): void {
  if (log.sessions.length === 0) {
    empty(panel, 'No sessions on this day.');
    return;
  }
  const list = panel.createDiv('vital-log-day-list');
  for (const session of log.sessions) {
    const row = list.createDiv('vital-log-day-row vital-log-day-row--session is-clickable');
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `Edit session: ${session.title || 'Session'}`);
    row.createSpan({ cls: 'vital-log-day-time vital-log-day-time--range', text: `${session.time}–${session.end}` });
    setIcon(row.createSpan('vital-log-day-row-icon'), session.source === 'koreader' ? 'book-open' : 'timer');

    const main = row.createDiv('vital-log-day-row-main');
    main.createSpan({ cls: 'vital-log-day-row-text', text: session.title || 'Session' });
    if (session.countsToward) main.createSpan({ cls: 'vital-log-day-row-note', text: session.countsToward });
    const meta = [session.area, ...session.tags.map((t) => (t.startsWith('#') ? t : `#${t}`))].filter(Boolean);
    if (meta.length > 0) main.createSpan({ cls: 'vital-log-day-row-meta', text: meta.join(' · ') });

    row.createSpan({ cls: 'vital-log-day-amount', text: formatMinutes(session.minutes) });

    const edit = (): void => {
      if (!mt.editSession(session.notePath, session.id)) {
        new Notice('Vital Log: that session could not be found — it may have been moved or deleted.');
      }
    };
    row.addEventListener('click', edit);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        edit();
      }
    });
  }
  const total = log.sessions.reduce((sum, s) => sum + s.minutes, 0);
  const footer = panel.createDiv('vital-log-day-total');
  footer.createSpan({ text: 'Total' });
  footer.createSpan({ cls: 'vital-log-day-amount', text: formatMinutes(total) });
}

function empty(panel: HTMLElement, text: string): void {
  panel.createDiv({ cls: 'vital-log-embed-empty', text });
}

function renderRow(list: HTMLElement, item: { time: string | null; icon?: string; text: string; note?: string }): HTMLElement {
  const row = list.createDiv('vital-log-day-row');
  row.createSpan({ cls: 'vital-log-day-time', text: item.time ?? '' });
  const icon = row.createSpan('vital-log-day-row-icon');
  if (item.icon) setIcon(icon, item.icon);
  const main = row.createDiv('vital-log-day-row-main');
  main.createSpan({ cls: 'vital-log-day-row-text', text: item.text });
  if (item.note) main.createSpan({ cls: 'vital-log-day-row-note', text: item.note });
  return row;
}

function severityBadge(row: HTMLElement, severity: number): void {
  if (!severity) return;
  const badge = row.createSpan({
    cls: `vital-log-day-severity vital-log-day-severity--${Math.min(5, Math.max(1, severity))}`,
    text: String(severity),
  });
  badge.setAttribute('aria-label', SEVERITY_LABELS[severity] ?? `Severity ${severity}`);
}

function renderTimeline(panel: HTMLElement, log: DayLog): void {
  if (isEmptyDay(log)) return empty(panel, 'Nothing logged yet.');
  const items = timeline(log);
  for (const bucket of TIME_BUCKETS) {
    const inBucket = items.filter((i: TimelineItem) => {
      const hour = i.time ? parseInt(i.time.split(':')[0], 10) : null;
      return bucket.test(hour === null || isNaN(hour) ? null : hour);
    });
    if (inBucket.length === 0) continue;
    panel.createDiv({ cls: 'vital-log-day-group-title', text: bucket.title });
    const list = panel.createDiv('vital-log-day-list');
    for (const item of inBucket) {
      const row = renderRow(list, item);
      row.addClass(`vital-log-day-row--${item.kind}`);
      if (item.severity !== undefined) severityBadge(row, item.severity);
    }
  }
}

function renderSubstances(panel: HTMLElement, log: DayLog): void {
  const totals = substanceTotals(log);
  if (totals.length === 0 && log.packs.length === 0 && log.stacks.length === 0) {
    return empty(panel, 'No substances logged.');
  }
  if (totals.length > 0) {
    const list = panel.createDiv('vital-log-day-list');
    for (const t of totals) {
      const row = list.createDiv('vital-log-day-row vital-log-day-row--total');
      setIcon(row.createSpan('vital-log-day-row-icon'), 'pill');
      const main = row.createDiv('vital-log-day-row-main');
      main.createSpan({ cls: 'vital-log-day-row-text', text: t.name });
      const detail = t.times.length > 0 ? t.times.join(' · ') : `${t.doses}×`;
      main.createSpan({ cls: 'vital-log-day-row-note', text: detail });
      if (t.total !== null) {
        row.createSpan({
          cls: 'vital-log-day-amount',
          text: `${Math.round(t.total * 100) / 100}${t.unit ? ' ' + t.unit : ''}`,
        });
      }
    }
  }
  for (const [title, entries, icon] of [
    ['Packs', log.packs, 'package'],
    ['Stacks', log.stacks, 'layers'],
  ] as const) {
    if (entries.length === 0) continue;
    panel.createDiv({ cls: 'vital-log-day-group-title', text: title });
    const list = panel.createDiv('vital-log-day-list');
    for (const e of entries) renderRow(list, { time: e.time, icon, text: e.name });
  }
}

function renderTrackers(panel: HTMLElement, log: DayLog): void {
  if (log.trackers.length === 0 && log.tallies.length === 0 && log.habits.length === 0) {
    return empty(panel, 'No trackers logged.');
  }

  for (const { tracker, readings } of log.trackers) {
    const card = panel.createDiv('vital-log-day-card');
    const head = card.createDiv('vital-log-day-card-head');
    setIcon(head.createSpan('vital-log-day-row-icon'), tracker.icon ?? 'activity');
    head.createSpan({ cls: 'vital-log-day-card-title', text: tracker.displayName });

    const values = readings.map((r) => r.value);
    const isMinutes = tracker.trackerType === 'minutes';
    const stat = card.createDiv('vital-log-day-card-stats');
    if (isMinutes) {
      stat.setText(`${values.reduce((a, b) => a + b, 0)} min total`);
    } else if (values.length > 1) {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      stat.setText(`avg ${Math.round(avg * 10) / 10} · min ${Math.min(...values)} · max ${Math.max(...values)}`);
    }
    if (!isMinutes && values.length > 1) renderSparkline(card, values);

    const readingsEl = card.createDiv('vital-log-day-readings');
    for (const r of readings) {
      const chip = readingsEl.createSpan('vital-log-day-reading');
      if (r.time) chip.createSpan({ cls: 'vital-log-day-time', text: r.time });
      chip.createSpan({ cls: 'vital-log-day-reading-value', text: `${r.value}${isMinutes ? ' min' : ''}` });
      if (r.note) chip.setAttribute('aria-label', r.note);
    }
  }

  if (log.tallies.length > 0 || log.habits.length > 0) {
    panel.createDiv({ cls: 'vital-log-day-group-title', text: 'Counters & habits' });
    const list = panel.createDiv('vital-log-day-list');
    for (const { tally, value } of log.tallies) {
      const row = list.createDiv('vital-log-day-row');
      setIcon(row.createSpan('vital-log-day-row-icon'), tally.icon ?? 'hash');
      const main = row.createDiv('vital-log-day-row-main');
      main.createSpan({ cls: 'vital-log-day-row-text', text: tally.displayName });
      const bar = main.createDiv('vital-log-day-progress');
      const pct = tally.target > 0 ? Math.min(100, (value / tally.target) * 100) : 100;
      bar.createDiv('vital-log-day-progress-fill').style.width = `${pct}%`;
      row.createSpan({ cls: 'vital-log-day-amount', text: `${value}/${tally.target}` });
      if (value >= tally.target) row.addClass('is-complete');
    }
    for (const habit of log.habits) {
      const row = list.createDiv('vital-log-day-row is-complete');
      setIcon(row.createSpan('vital-log-day-row-icon'), habit.icon ?? 'check');
      row.createDiv('vital-log-day-row-main').createSpan({ cls: 'vital-log-day-row-text', text: habit.displayName });
      setIcon(row.createSpan('vital-log-day-check'), 'check');
    }
  }
}

function renderEvents(panel: HTMLElement, log: DayLog): void {
  if (log.events.length === 0) return empty(panel, 'No events logged.');
  const list = panel.createDiv('vital-log-day-list');
  for (const e of log.events) {
    const row = renderRow(list, { time: e.time, icon: e.icon ?? 'calendar-clock', text: e.name, note: e.note });
    severityBadge(row, e.severity);
  }
}

// ── Chart tab ────────────────────────────────────────────────

/** A row of small toggle buttons, like the tab strip but compact. */
function renderSegmented<T extends string | number>(
  parent: HTMLElement,
  options: { id: T; label: string }[],
  current: T,
  onPick: (id: T) => void
): void {
  const row = parent.createDiv('vital-log-day-segmented');
  for (const o of options) {
    const btn = row.createEl('button', {
      text: o.label,
      cls: 'vital-log-day-segment' + (o.id === current ? ' is-active' : ''),
      attr: { 'aria-pressed': String(o.id === current) },
    });
    btn.addEventListener('click', () => {
      if (o.id !== current) onPick(o.id);
    });
  }
}

function renderChartTab(
  plugin: VitalLogPlugin,
  panel: HTMLElement,
  log: DayLog,
  state: ViewerState,
  noteDate: Date | null,
  rerender: () => void
): void {
  const day = noteDate ?? new Date();
  const isToday = toISODate(day) === toISODate(new Date());

  let compare: { label: string; byTracker: Map<string, ChartPoint[]> } | undefined;
  if (state.compare !== 'none' && log.trackers.length > 0) {
    const byTracker = new Map<string, ChartPoint[]>();
    if (state.compare === 'yesterday') {
      const [yesterday] = loadHistory(plugin.app, plugin.settings, day, 1, false);
      for (const t of log.trackers) {
        byTracker.set(t.tracker.id, yesterday.log ? trackerPoints(yesterday.log, t.tracker.id) : []);
      }
      compare = { label: 'Yesterday', byTracker };
    } else {
      const past = loggedDays(loadHistory(plugin.app, plugin.settings, day, 7, false));
      for (const t of log.trackers) byTracker.set(t.tracker.id, hourlyAverage(past, t.tracker.id));
      compare = { label: '7-day average', byTracker };
    }
  }

  if (log.trackers.some((t) => t.tracker.trackerType !== 'minutes')) {
    renderSegmented(panel, COMPARE_MODES, state.compare, (id) => {
      state.compare = id;
      rerender();
    });
  }

  const now = new Date();
  const drawn = renderDayChart(panel, log, {
    nowMinutes: isToday ? minutesOf(`${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`) ?? undefined : undefined,
    compare,
  });
  if (!drawn) empty(panel, 'Nothing with a time logged yet.');
}

// ── Week tab (heatmap) ───────────────────────────────────────

/** Red (low) → green (high) for a 0–1 share of the tracker's range. */
function heatColor(fraction: number): string {
  const f = Math.max(0, Math.min(1, fraction));
  return `hsl(${Math.round(f * 125)}, 60%, 45%)`;
}

function renderWeekTab(
  plugin: VitalLogPlugin,
  panel: HTMLElement,
  state: ViewerState,
  endDate: Date,
  rerender: () => void
): void {
  const trackers = seriesMetrics(plugin.settings).filter((t) => !t.archived && t.trackerType !== 'minutes');
  if (trackers.length === 0) return empty(panel, 'No rating trackers configured.');
  const tracker = trackers.find((t) => t.id === state.heatmapTrackerId) ?? trackers[0];

  const controls = panel.createDiv('vital-log-day-controls');
  renderSegmented(controls, trackers.map((t) => ({ id: t.id, label: t.displayName })), tracker.id, (id) => {
    state.heatmapTrackerId = id;
    rerender();
  });
  renderSegmented(controls, HEATMAP_SPANS.map((n) => ({ id: n, label: `${n}d` })), state.heatmapDays, (n) => {
    state.heatmapDays = n;
    rerender();
  });

  const history = loadHistory(plugin.app, plugin.settings, endDate, state.heatmapDays).reverse();
  const minutes = history.flatMap((d) => (d.log ? trackerPoints(d.log, tracker.id).map((p) => p.minutes) : []));
  if (minutes.length === 0) return empty(panel, `No ${tracker.displayName.toLowerCase()} readings in the last ${state.heatmapDays} days.`);
  const [startHour, endHour] = hourRange(minutes);
  const hours = endHour - startHour;
  const range = tracker.max - tracker.min || 1;

  const grid = panel.createDiv('vital-log-heatmap');
  grid.style.gridTemplateColumns = `auto repeat(${hours}, minmax(0, 1fr))`;

  // Hour header, labelled every 3 hours.
  grid.createDiv('vital-log-heatmap-corner');
  for (let h = startHour; h < endHour; h++) {
    grid.createDiv({ cls: 'vital-log-heatmap-hour', text: (h - startHour) % 3 === 0 ? String(h).padStart(2, '0') : '' });
  }

  const todayISO = toISODate(new Date());
  for (const day of history) {
    grid.createDiv({
      cls: 'vital-log-heatmap-day' + (toISODate(day.date) === todayISO ? ' is-today' : ''),
      text: day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
    });
    const row = day.log ? heatmapRow(day.log, tracker.id, startHour, endHour) : new Array<number | null>(hours).fill(null);
    row.forEach((value, i) => {
      const cell = grid.createDiv('vital-log-heatmap-cell');
      if (value === null) return;
      cell.style.background = heatColor((value - tracker.min) / range);
      cell.setAttribute('aria-label', `${tracker.displayName} ${value} at ${String(startHour + i).padStart(2, '0')}:00`);
      cell.title = `${String(startHour + i).padStart(2, '0')}:00 · ${tracker.displayName} ${value}`;
    });
  }

  const legend = panel.createDiv('vital-log-heatmap-legend');
  legend.createSpan({ text: String(tracker.min) });
  const bar = legend.createSpan('vital-log-heatmap-scale');
  bar.style.background = `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})`;
  legend.createSpan({ text: String(tracker.max) });
  legend.createSpan({ cls: 'vital-log-heatmap-hint', text: 'Each hour shows the latest reading so far that day.' });
}

// ── Insights tab ─────────────────────────────────────────────

function renderInsightsTab(plugin: VitalLogPlugin, panel: HTMLElement, endDate: Date): void {
  const logs = loggedDays(loadHistory(plugin.app, plugin.settings, endDate, INSIGHT_DAYS));
  const trackers = seriesMetrics(plugin.settings).filter((t) => !t.archived);
  const insights = findInsights(logs, trackers);

  // Symptoms that tend to begin soon after a dose.
  const fallbackHours = plugin.settings.symptomDoseWindowHours || 6;
  const links = symptomsAfterDoses(logs, (substance) =>
    plugin.settings.vitamins.find((v) => v.displayName === substance)?.symptomWindowHours || fallbackHours
  );
  if (links.length > 0) {
    panel.createDiv({ cls: 'vital-log-day-group-title', text: 'Symptoms after doses' });
    const list = panel.createDiv('vital-log-day-list');
    for (const link of links) {
      const row = list.createDiv('vital-log-day-row vital-log-insight');
      setIcon(row.createSpan('vital-log-day-row-icon'), 'thermometer');
      const main = row.createDiv('vital-log-day-row-main');
      main.createSpan({ cls: 'vital-log-day-row-text', text: `${link.symptom} after ${link.substance}` });
      main.createSpan({
        cls: 'vital-log-day-row-note',
        text: `Began within ${link.windowHours}h of a dose on ${link.doseHits} of ${link.doseDays} days, ` +
          `and on ${link.otherHits} of ${link.otherDays} days without it.`,
      });
      row.createSpan({
        cls: 'vital-log-insight-delta is-down',
        text: `${Math.round((link.doseHits / link.doseDays) * 100)}% vs ${Math.round((link.otherHits / link.otherDays) * 100)}%`,
      });
    }
    if (insights.length > 0) panel.createDiv({ cls: 'vital-log-day-group-title', text: 'Tracker averages' });
  }

  // What tends to hold the day before a symptom begins.
  const nextDay = symptomsNextDay(loadHistory(plugin.app, plugin.settings, endDate, INSIGHT_DAYS));
  if (nextDay.length > 0) {
    panel.createDiv({ cls: 'vital-log-day-group-title', text: 'Symptoms the next day' });
    const list = panel.createDiv('vital-log-day-list');
    for (const link of nextDay) {
      const row = list.createDiv('vital-log-day-row vital-log-insight');
      setIcon(row.createSpan('vital-log-day-row-icon'), 'calendar-arrow-down');
      const main = row.createDiv('vital-log-day-row-main');
      main.createSpan({ cls: 'vital-log-day-row-text', text: `${link.symptom} the day after ${link.condition}` });
      main.createSpan({
        cls: 'vital-log-day-row-note',
        text: `Began the next day after ${link.withHits} of ${link.withDays} such days, ` +
          `and after ${link.withoutHits} of ${link.withoutDays} other days.`,
      });
      row.createSpan({
        cls: 'vital-log-insight-delta is-down',
        text: `${Math.round((link.withHits / link.withDays) * 100)}% vs ${Math.round((link.withoutHits / link.withoutDays) * 100)}%`,
      });
    }
  }

  if (insights.length === 0 && (links.length > 0 || nextDay.length > 0)) {
    panel.createDiv({
      cls: 'vital-log-heatmap-hint',
      text: `Over the last ${INSIGHT_DAYS} days. These are patterns, not causes — small samples can mislead.`,
    });
    return;
  }
  if (insights.length === 0) {
    return empty(
      panel,
      `Not enough data yet. Insights compare days with and without something (a substance, an event, waking early) ` +
      `and need at least 3 of each in the last ${INSIGHT_DAYS} days.`
    );
  }

  const list = panel.createDiv('vital-log-day-list');
  for (const insight of insights) {
    const row = list.createDiv('vital-log-day-row vital-log-insight');
    const main = row.createDiv('vital-log-day-row-main');
    main.createSpan({ cls: 'vital-log-day-row-text', text: insight.subject });
    main.createSpan({
      cls: 'vital-log-day-row-note',
      text: `${insight.withDays} days with · ${insight.withoutDays} without`,
    });
    const sign = insight.delta > 0 ? '+' : '−';
    row.createSpan({
      cls: 'vital-log-insight-delta ' + (insight.delta > 0 ? 'is-up' : 'is-down'),
      text: `${insight.tracker.displayName} ${sign}${Math.abs(Math.round(insight.delta * 10) / 10)}`,
    });
  }
  panel.createDiv({
    cls: 'vital-log-heatmap-hint',
    text: `Daily averages over the last ${INSIGHT_DAYS} days. These are patterns, not causes — small samples can mislead.`,
  });
}

// ── Symptoms tab ─────────────────────────────────────────────

const SYMPTOM_RANGES = [30, 90];

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderSymptoms(
  plugin: VitalLogPlugin,
  panel: HTMLElement,
  log: DayLog,
  state: ViewerState,
  endDate: Date,
  rerender: () => void
): void {
  const history = loadHistory(plugin.app, plugin.settings, endDate, state.symptomRange);
  const episodes = symptomEpisodes(history);

  // ── This day ──
  if (log.symptoms.length === 0) {
    empty(panel, 'No symptoms on this day.');
  }
  for (const sym of log.symptoms) {
    const card = panel.createDiv('vital-log-day-card');
    const head = card.createDiv('vital-log-day-card-head');
    setIcon(head.createSpan('vital-log-day-row-icon'), sym.icon ?? 'thermometer');
    head.createSpan({ cls: 'vital-log-day-card-title', text: sym.name });
    head.createSpan({ cls: 'vital-log-day-symptom-peak', text: `peak ${sym.peak}/10` });

    const from = sym.carriedIn !== null ? 'from an earlier day' : sym.startTime ? `from ${sym.startTime}` : '';
    const until = sym.activeAtEnd ? 'still active' : sym.endTime ? `gone at ${sym.endTime}` : '';
    let span = [from, until].filter(Boolean).join(', ');
    const start = minutesOf(sym.startTime);
    const end = minutesOf(sym.endTime);
    if (start !== null && end !== null && end > start) span += ` · ${formatMinutes(end - start)}`;
    card.createDiv({ cls: 'vital-log-day-card-stats', text: span });

    // A multi-day episode: which day this is, and its curve so far.
    const episode = episodes.find(
      (ep) => ep.name.toLowerCase() === sym.name.toLowerCase() &&
        ep.startDate.getTime() <= endDate.getTime() &&
        (ep.endDate === null || ep.endDate.getTime() >= new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime())
    );
    if (episode && episode.days > 1) {
      const line = card.createDiv('vital-log-day-episode');
      line.createSpan({
        text: `Day ${episode.days}${episode.startedBefore ? '+' : ''} · since ${shortDate(episode.startDate)}` +
          `${episode.startTime ? ' ' + episode.startTime : ''} · peak ${episode.peak}/10`,
      });
      renderSparkline(line, episode.dailyPeaks);
    }

    const readings = card.createDiv('vital-log-day-readings');
    for (const r of sym.readings) {
      const chip = readings.createSpan('vital-log-day-reading');
      if (r.time) chip.createSpan({ cls: 'vital-log-day-time', text: r.time });
      chip.createSpan({ cls: 'vital-log-day-reading-value', text: r.severity === 0 ? 'gone' : `${r.severity}/10` });
      if (r.note) chip.setAttribute('aria-label', r.note);
    }
  }

  // ── Over the last 30 / 90 days ──
  const calendar = symptomCalendar(history);
  if (calendar.length === 0) return;

  const header = panel.createDiv('vital-log-day-controls vital-log-day-section-head');
  header.createDiv({ cls: 'vital-log-day-group-title', text: `Last ${state.symptomRange} days` });
  renderSegmented(header, SYMPTOM_RANGES.map((n) => ({ id: n, label: `${n}d` })), state.symptomRange, (n) => {
    state.symptomRange = n;
    rerender();
  });

  // Calendar: a row per symptom, a cell per day, shaded by that day's peak.
  const grid = panel.createDiv('vital-log-symptom-calendar');
  grid.style.gridTemplateColumns = `minmax(4em, auto) repeat(${history.length}, minmax(0, 1fr)) auto`;
  for (const row of calendar) {
    grid.createDiv({ cls: 'vital-log-symptom-calendar-name', text: row.name });
    row.cells.forEach((peak, i) => {
      const cell = grid.createDiv('vital-log-symptom-calendar-cell');
      if (history[i].log === null) cell.addClass('is-missing');
      if (peak === null) return;
      cell.style.setProperty('--vl-severity', String(peak / 10));
      cell.addClass('has-symptom');
      cell.title = `${shortDate(history[i].date)} · ${row.name} peak ${peak}/10`;
    });
    grid.createDiv({
      cls: 'vital-log-symptom-calendar-total',
      text: `${row.days}d · ${Math.round(row.averagePeak * 10) / 10}`,
    });
  }
  panel.createDiv({
    cls: 'vital-log-heatmap-hint',
    text: 'Each cell is a day, shaded by that day\'s peak. Right: days with it · average peak.',
  });

  // Weekly totals.
  const weeks = weeklySymptomTotals(history).slice(0, state.symptomRange > 30 ? 13 : 5);
  panel.createDiv({ cls: 'vital-log-day-group-title', text: 'By week' });
  const weekList = panel.createDiv('vital-log-day-list');
  for (const w of weeks) {
    const row = weekList.createDiv('vital-log-day-row');
    row.createSpan({ cls: 'vital-log-day-time vital-log-day-time--range', text: `Week of ${shortDate(w.weekStart)}` });
    const main = row.createDiv('vital-log-day-row-main');
    main.createSpan({
      cls: 'vital-log-day-row-text',
      text: w.symptomDays === 0 ? 'No symptoms' : `${w.symptomDays} of ${w.loggedDays} days with symptoms`,
    });
    if (w.symptomDays > 0) {
      row.createSpan({ cls: 'vital-log-day-amount', text: `avg peak ${Math.round(w.averagePeak * 10) / 10}` });
    }
  }

  // Multi-day episodes.
  const longer = episodes.filter((ep) => ep.days > 1).slice(0, 8);
  if (longer.length > 0) {
    panel.createDiv({ cls: 'vital-log-day-group-title', text: 'Episodes' });
    const list = panel.createDiv('vital-log-day-list');
    for (const ep of longer) {
      const row = list.createDiv('vital-log-day-row');
      setIcon(row.createSpan('vital-log-day-row-icon'), 'thermometer');
      const main = row.createDiv('vital-log-day-row-main');
      main.createSpan({ cls: 'vital-log-day-row-text', text: ep.name });
      main.createSpan({
        cls: 'vital-log-day-row-note',
        text: `${ep.startedBefore ? 'before ' : ''}${shortDate(ep.startDate)} – ` +
          `${ep.endDate ? shortDate(ep.endDate) : 'ongoing'} · ${ep.days} days`,
      });
      renderSparkline(row, ep.dailyPeaks);
      row.createSpan({ cls: 'vital-log-day-amount', text: `peak ${ep.peak}` });
    }
  }
}
