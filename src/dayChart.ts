// ============================================================
// Vital Log — Day chart
// One day on an hour axis: a line per rating tracker (each scaled to
// its own min–max), an optional dashed comparison line per tracker,
// substances and events as lettered dots in a lane under the plot, and
// time markers (wake up, bed time) as labelled lines, and Time Tracker
// sessions as shaded bands. Hover (or tap, on mobile) any mark for its
// details. Zero-dependency inline SVG,
// re-laid out when the container width changes.
// ============================================================

import type { DayLog } from './dayLog';
import type { ChartPoint } from './dayStats';
import { formatMinutes } from './managementTracker';
import { SEVERITY_LABELS } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tracker line colours, in order; Obsidian's palette variables follow the theme. */
const LINE_COLORS = [
  'var(--color-blue)',
  'var(--color-orange)',
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-pink)',
  'var(--color-cyan)',
  'var(--color-yellow)',
  'var(--color-red)',
];

const PAD_LEFT = 26;
const PAD_RIGHT = 12;
const PLOT_TOP = 14;
const PLOT_HEIGHT = 120;
const DOT_RADIUS = 8;
const DOT_GAP = 2;
const MAX_DOT_ROWS = 4;
const AXIS_HEIGHT = 18;

// ── Pure helpers (exported for tests) ────────────────────────

/** "08:31" → 511. Null for anything that isn't HH:mm. */
export function minutesOf(time: string | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** "24:10" → 1450: like minutesOf, but lets a session's end run past midnight. */
export function clockMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Whole-hour axis range covering every mark: at least 06:00–22:00 so a
 * sparse morning doesn't stretch to fill the width, widened to include any
 * early or late entry (and `now`, for today's note).
 */
export function hourRange(minutes: number[]): [number, number] {
  if (minutes.length === 0) return [6, 22];
  const lo = Math.min(...minutes);
  const hi = Math.max(...minutes);
  const start = Math.min(6, Math.floor(lo / 60));
  const end = Math.min(24, Math.max(22, Math.ceil((hi + 1) / 60)));
  return [start, end];
}

/**
 * Stack dots that would overlap: each dot takes the lowest row where it
 * clears every dot already placed in that row. Returns a row per input x
 * (inputs must be sorted ascending).
 */
export function stackRows(xs: number[], minGap: number, maxRows: number): number[] {
  const lastXInRow: number[] = [];
  return xs.map((x) => {
    for (let row = 0; row < maxRows; row++) {
      if (lastXInRow[row] === undefined || x - lastXInRow[row] >= minGap) {
        lastXInRow[row] = x;
        return row;
      }
    }
    // Out of rows: overlap on the top row rather than grow without bound.
    lastXInRow[maxRows - 1] = x;
    return maxRows - 1;
  });
}

function fmtNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// ── Rendering ────────────────────────────────────────────────

interface Mark {
  minutes: number;
}

interface TrackerSeries {
  id: string;
  name: string;
  color: string;
  min: number;
  max: number;
  points: (Mark & { value: number; note?: string })[];
}

export interface DayChartOptions {
  /** Minutes since midnight to draw a "now" line at, for today's note. */
  nowMinutes?: number;
  /** Dashed comparison line per tracker id, e.g. yesterday or a 7-day average. */
  compare?: { label: string; byTracker: Map<string, ChartPoint[]> };
}

/** Times before this (04:00) on a marker are read as after midnight, e.g. a 00:30 bed time. */
const AFTER_MIDNIGHT = 4 * 60;

/** Render the chart into `container`. Returns false when there's nothing timed to plot. */
export function renderDayChart(container: HTMLElement, log: DayLog, opts: DayChartOptions = {}): boolean {
  const series: TrackerSeries[] = [];
  for (const { tracker, readings } of log.trackers) {
    // Minutes trackers are durations, not a level through the day — they
    // don't belong on a shared 0–1 axis.
    if (tracker.trackerType === 'minutes') continue;
    const points: TrackerSeries['points'] = [];
    for (const r of readings) {
      const minutes = minutesOf(r.time);
      if (minutes !== null) points.push({ minutes, value: r.value, note: r.note });
    }
    if (points.length === 0) continue;
    series.push({
      id: tracker.id,
      name: tracker.displayName,
      color: LINE_COLORS[series.length % LINE_COLORS.length],
      min: tracker.min,
      max: tracker.max,
      points,
    });
  }

  const doses = log.doses
    .map((d) => ({ ...d, minutes: minutesOf(d.time) }))
    .filter((d): d is typeof d & Mark => d.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);

  const events = log.events
    .map((e) => ({ ...e, minutes: minutesOf(e.time) }))
    .filter((e): e is typeof e & Mark => e.minutes !== null);

  const markers = log.markers
    .map((m) => ({ ...m, minutes: minutesOf(m.time) }))
    .filter((m): m is typeof m & Mark => m.minutes !== null);

  // Substances and events share the dot lane, so they stack around each other.
  type Dot =
    | { kind: 'dose'; minutes: number; letter: string; lines: string[] }
    | { kind: 'event'; minutes: number; letter: string; lines: string[]; severity: number };
  const dots: Dot[] = [
    ...doses.map((d): Dot => ({
      kind: 'dose',
      minutes: d.minutes,
      letter: d.name.trim().charAt(0).toUpperCase(),
      lines: [
        `${d.name}${d.amount !== null ? ` ${fmtNum(d.amount)}${d.unit ? ' ' + d.unit : ''}` : ''}`,
        d.time ?? '',
        ...(d.note ? [d.note] : []),
      ],
    })),
    ...events.map((e): Dot => ({
      kind: 'event',
      minutes: e.minutes,
      letter: e.name.trim().charAt(0).toUpperCase(),
      severity: Math.min(5, Math.max(1, e.severity || 1)),
      lines: [
        e.name,
        `${e.time} · severity ${e.severity}${SEVERITY_LABELS[e.severity] ? ` (${SEVERITY_LABELS[e.severity]})` : ''}`,
        ...(e.note ? [e.note] : []),
      ],
    })),
  ].sort((a, b) => a.minutes - b.minutes);

  const sessions = log.sessions
    .map((s) => {
      const start = minutesOf(s.time);
      const end = clockMinutes(s.end);
      return start === null || end === null ? null : { ...s, start, stop: Math.min(end, 24 * 60) };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null && s.stop > s.start);

  if (series.length === 0 && dots.length === 0 && markers.length === 0 && sessions.length === 0) return false;

  const wrap = container.createDiv('vital-log-chart');
  const svgHost = wrap.createDiv('vital-log-chart-svg');
  const tip = wrap.createDiv('vital-log-chart-tip');
  tip.hide();

  // Legend: one swatch per tracker line, with its latest value.
  if (series.length > 0 || dots.length > 0 || sessions.length > 0) {
    const legend = wrap.createDiv('vital-log-chart-legend');
    for (const s of series) {
      const item = legend.createSpan('vital-log-chart-legend-item');
      const swatch = item.createSpan('vital-log-chart-legend-swatch');
      swatch.style.background = s.color;
      item.createSpan({ text: s.name });
      item.createSpan({ cls: 'vital-log-chart-legend-value', text: fmtNum(s.points[s.points.length - 1].value) });
    }
    if (opts.compare && series.some((s) => (opts.compare!.byTracker.get(s.id) ?? []).length > 0)) {
      const item = legend.createSpan('vital-log-chart-legend-item');
      item.createSpan('vital-log-chart-legend-swatch vital-log-chart-legend-swatch--dashed');
      item.createSpan({ text: opts.compare.label });
    }
    if (sessions.length > 0) {
      const item = legend.createSpan('vital-log-chart-legend-item');
      item.createSpan('vital-log-chart-legend-band');
      item.createSpan({ text: 'Sessions' });
    }
    if (doses.length > 0) {
      const item = legend.createSpan('vital-log-chart-legend-item');
      item.createSpan({ cls: 'vital-log-chart-legend-dot', text: 'A' });
      item.createSpan({ text: 'Substances' });
    }
    if (events.length > 0) {
      const item = legend.createSpan('vital-log-chart-legend-item');
      item.createSpan({ cls: 'vital-log-chart-legend-dot vital-log-chart-legend-dot--event', text: 'E' });
      item.createSpan({ text: 'Events' });
    }
  }

  const allMinutes = [
    ...series.flatMap((s) => s.points.map((p) => p.minutes)),
    ...dots.map((d) => d.minutes),
    ...sessions.flatMap((s) => [s.start, s.stop - 1]),
    ...markers.filter((m) => m.minutes >= AFTER_MIDNIGHT).map((m) => m.minutes),
    ...(opts.nowMinutes !== undefined ? [opts.nowMinutes] : []),
  ];
  const [startHour, endHour] = hourRange(allMinutes);

  let pinned: Element | null = null;
  const hideTip = (): void => {
    pinned = null;
    tip.hide();
  };

  const showTip = (lines: string[], x: number, y: number, width: number): void => {
    tip.empty();
    lines.forEach((line, i) => tip.createDiv({ cls: i === 0 ? 'vital-log-chart-tip-title' : '', text: line }));
    tip.show();
    // Centre over the mark, clamped inside the chart; flip below when near the top.
    const tipW = tip.offsetWidth;
    const left = Math.max(0, Math.min(width - tipW, x - tipW / 2));
    tip.style.left = `${left}px`;
    if (y - tip.offsetHeight - 8 < 0) {
      tip.style.top = `${y + 12}px`;
    } else {
      tip.style.top = `${y - tip.offsetHeight - 8}px`;
    }
  };

  /** Hover on desktop; tap to pin on touch. Tapping the same mark again, or elsewhere, closes it. */
  const bindTip = (el: Element, lines: string[], x: number, y: number, width: number): void => {
    el.addEventListener('pointerenter', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse' && !pinned) showTip(lines, x, y, width);
    });
    el.addEventListener('pointerleave', (e) => {
      if ((e as PointerEvent).pointerType === 'mouse' && !pinned) tip.hide();
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pinned === el) return hideTip();
      pinned = el;
      showTip(lines, x, y, width);
    });
  };
  wrap.addEventListener('click', hideTip);

  const draw = (width: number): void => {
    svgHost.empty();
    hideTip();

    const plotLeft = PAD_LEFT;
    const plotRight = width - PAD_RIGHT;
    const plotWidth = Math.max(40, plotRight - plotLeft);
    const x = (minutes: number): number =>
      plotLeft + ((minutes - startHour * 60) / ((endHour - startHour) * 60)) * plotWidth;
    const plotBottom = PLOT_TOP + PLOT_HEIGHT;

    const dotRows = stackRows(dots.map((d) => x(d.minutes)), DOT_RADIUS * 2 + DOT_GAP, MAX_DOT_ROWS);
    const laneRows = dots.length > 0 ? Math.max(...dotRows) + 1 : 0;
    const laneTop = plotBottom + 6;
    const laneHeight = laneRows * (DOT_RADIUS * 2 + DOT_GAP);
    const axisTop = laneTop + laneHeight + (laneRows > 0 ? 4 : 0);
    const height = axisTop + AXIS_HEIGHT;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Day chart');
    svgHost.appendChild(svg);

    const add = <K extends keyof SVGElementTagNameMap>(
      tag: K,
      attrs: Record<string, string | number>,
      cls?: string
    ): SVGElementTagNameMap[K] => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      if (cls) node.setAttribute('class', cls);
      svg.appendChild(node);
      return node;
    };

    // ── Grid + hour labels ──
    const span = endHour - startHour;
    const step = width < 360 ? (span > 12 ? 4 : 3) : span > 12 ? 3 : 2;
    for (let h = startHour; h <= endHour; h++) {
      const gx = x(h * 60);
      const major = (h - startHour) % step === 0;
      add('line', { x1: gx, y1: PLOT_TOP, x2: gx, y2: axisTop - 2 }, major ? 'vital-log-chart-grid' : 'vital-log-chart-grid vital-log-chart-grid--minor');
      if (major) {
        const label = add('text', { x: gx, y: axisTop + 12, 'text-anchor': 'middle' }, 'vital-log-chart-axis');
        label.textContent = String(h % 24).padStart(2, '0');
      }
    }
    // Horizontal guides at low / mid / high.
    for (const f of [0, 0.5, 1]) {
      const gy = PLOT_TOP + (1 - f) * PLOT_HEIGHT;
      add('line', { x1: plotLeft, y1: gy, x2: plotRight, y2: gy }, 'vital-log-chart-grid vital-log-chart-grid--minor');
    }
    // Y labels: real values when every line shares one scale, otherwise low/high.
    const shared = series.length > 0 && series.every((s) => s.min === series[0].min && s.max === series[0].max);
    const yLabels: [number, string][] = shared
      ? [[0, fmtNum(series[0].min)], [0.5, fmtNum((series[0].min + series[0].max) / 2)], [1, fmtNum(series[0].max)]]
      : series.length > 0 ? [[0, 'low'], [1, 'high']] : [];
    for (const [f, text] of yLabels) {
      const label = add('text', { x: plotLeft - 6, y: PLOT_TOP + (1 - f) * PLOT_HEIGHT + 3.5, 'text-anchor': 'end' }, 'vital-log-chart-axis');
      label.textContent = text;
    }

    // ── Sessions: shaded bands behind everything else ──
    for (const sess of sessions) {
      const x1 = x(sess.start);
      const x2 = Math.max(x1 + 2, x(sess.stop));
      const band = add('rect', {
        x: x1, y: PLOT_TOP, width: x2 - x1, height: PLOT_HEIGHT, rx: 2,
      }, 'vital-log-chart-session vital-log-chart-hit');
      bindTip(band, [
        sess.title || 'Session',
        `${sess.time}–${sess.end} · ${formatMinutes(sess.minutes)}`,
        ...(sess.countsToward ? [sess.countsToward] : []),
      ], (x1 + x2) / 2, PLOT_TOP + 4, width);
      if (x2 - x1 > 44) {
        const label = add('text', { x: x1 + 4, y: PLOT_TOP + PLOT_HEIGHT - 5 }, 'vital-log-chart-session-label');
        // Trim to roughly what fits; SVG text doesn't ellipsize.
        const fit = Math.max(3, Math.floor((x2 - x1 - 8) / 6));
        const title = sess.title || 'Session';
        label.textContent = title.length > fit ? title.slice(0, fit - 1) + '…' : title;
      }
    }

    // ── Now line ──
    if (opts.nowMinutes !== undefined) {
      const nx = x(opts.nowMinutes);
      add('line', { x1: nx, y1: PLOT_TOP - 4, x2: nx, y2: axisTop - 2 }, 'vital-log-chart-now');
    }

    // ── Events: a faint tick through the plot (their dots are in the lane) ──
    for (const e of events) {
      const ex = x(e.minutes);
      add('line', { x1: ex, y1: PLOT_TOP, x2: ex, y2: plotBottom }, 'vital-log-chart-event-line');
    }

    // ── Time markers (wake up, bed time): a labelled line ──
    for (const m of markers) {
      // A bed time of 00:30 belongs at the right edge, not the morning.
      const pos = m.minutes < AFTER_MIDNIGHT ? endHour * 60 : m.minutes;
      const mx = x(Math.min(pos, endHour * 60));
      add('line', { x1: mx, y1: PLOT_TOP - 2, x2: mx, y2: plotBottom }, 'vital-log-chart-marker-line');
      const anchor = mx > width - 60 ? 'end' : mx < plotLeft + 30 ? 'start' : 'middle';
      const label = add('text', { x: mx, y: PLOT_TOP - 5, 'text-anchor': anchor }, 'vital-log-chart-marker-label vital-log-chart-hit');
      label.textContent = m.label;
      bindTip(label, [m.label, m.time], mx, PLOT_TOP - 8, width);
    }

    // ── Tracker lines (comparison first, so today's line draws on top) ──
    for (const s of series) {
      const range = s.max - s.min || 1;
      const y = (v: number): number => PLOT_TOP + (1 - (Math.min(s.max, Math.max(s.min, v)) - s.min) / range) * PLOT_HEIGHT;
      const ref = opts.compare?.byTracker.get(s.id) ?? [];
      if (ref.length > 1) {
        const refLine = add('polyline', {
          points: ref.map((p) => `${x(p.minutes)},${y(p.value)}`).join(' '),
          fill: 'none',
        }, 'vital-log-chart-line vital-log-chart-line--compare');
        refLine.style.stroke = s.color;
      }
      const pts = [...s.points].sort((a, b) => a.minutes - b.minutes);
      if (pts.length > 1) {
        const line = add('polyline', {
          points: pts.map((p) => `${x(p.minutes)},${y(p.value)}`).join(' '),
          fill: 'none',
        }, 'vital-log-chart-line');
        line.style.stroke = s.color;
      }
      for (const p of pts) {
        const px = x(p.minutes);
        const py = y(p.value);
        const dot = add('circle', { cx: px, cy: py, r: 3.5 }, 'vital-log-chart-point');
        dot.style.fill = s.color;
        // A larger invisible target so points are tappable on a phone.
        const hit = add('circle', { cx: px, cy: py, r: 11 }, 'vital-log-chart-hit vital-log-chart-hit-area');
        const time = `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
        bindTip(hit, [`${s.name}: ${fmtNum(p.value)}`, time, ...(p.note ? [p.note] : [])], px, py, width);
      }
    }

    // ── Substance and event dots ──
    dots.forEach((d, i) => {
      const dx = x(d.minutes);
      const dy = laneTop + laneHeight - DOT_RADIUS - dotRows[i] * (DOT_RADIUS * 2 + DOT_GAP);
      const cls = d.kind === 'event'
        ? `vital-log-chart-dot vital-log-chart-dot--event vital-log-chart-event--${d.severity} vital-log-chart-hit`
        : 'vital-log-chart-dot vital-log-chart-dose vital-log-chart-hit';
      const g = add('g', {}, cls);
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(dx));
      circle.setAttribute('cy', String(dy));
      circle.setAttribute('r', String(DOT_RADIUS));
      g.appendChild(circle);
      const letter = document.createElementNS(SVG_NS, 'text');
      letter.setAttribute('x', String(dx));
      letter.setAttribute('y', String(dy + 3.5));
      letter.setAttribute('text-anchor', 'middle');
      letter.textContent = d.letter;
      g.appendChild(letter);
      bindTip(g, d.lines, dx, dy - DOT_RADIUS, width);
    });
  };

  // Lay out at the container's real width, and again whenever it changes
  // (pane resize, phone rotation, the embed being expanded from collapsed).
  let lastWidth = 0;
  const relayout = (): void => {
    const width = Math.floor(svgHost.clientWidth);
    if (width <= 0 || width === lastWidth) return;
    lastWidth = width;
    draw(width);
  };
  const observer = new ResizeObserver(() => {
    if (!wrap.isConnected) {
      observer.disconnect();
      return;
    }
    relayout();
  });
  observer.observe(svgHost);
  // Before the first observation fires, draw at a sensible width so the
  // block doesn't render empty (e.g. while still detached).
  lastWidth = Math.floor(svgHost.clientWidth);
  draw(lastWidth || 320);

  return true;
}
