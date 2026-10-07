// ============================================================
// Vital Log — Multi-day stats for the day view
// Pure helpers over a run of DayLogs: the "usual day" comparison
// line, heatmap rows, and with/without insights. No vault access —
// dayHistory.ts loads the logs.
// ============================================================

import type { DayLog } from './dayLog';
import type { Metric } from './types';
import { minutesOf } from './dayChart';

export interface ChartPoint {
  minutes: number;
  value: number;
}

/** A tracker's readings from one day as chart points (untimed readings dropped). */
export function trackerPoints(log: DayLog, trackerId: string): ChartPoint[] {
  const day = log.trackers.find((t) => t.tracker.id === trackerId);
  if (!day) return [];
  const out: ChartPoint[] = [];
  for (const r of day.readings) {
    const minutes = minutesOf(r.time);
    if (minutes !== null) out.push({ minutes, value: r.value });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

/**
 * A "usual day" line: every reading across `logs`, averaged per clock
 * hour and placed at the half hour. Hours with no readings are skipped.
 */
export function hourlyAverage(logs: DayLog[], trackerId: string): ChartPoint[] {
  const sums = new Map<number, { total: number; count: number }>();
  for (const log of logs) {
    for (const p of trackerPoints(log, trackerId)) {
      const hour = Math.floor(p.minutes / 60);
      const bucket = sums.get(hour) ?? { total: 0, count: 0 };
      bucket.total += p.value;
      bucket.count++;
      sums.set(hour, bucket);
    }
  }
  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, b]) => ({ minutes: hour * 60 + 30, value: b.total / b.count }));
}

/**
 * One heatmap row: for each hour in [startHour, endHour), the latest
 * reading at or before the end of that hour — carried forward from the
 * day's first reading until its last, null outside that span.
 */
export function heatmapRow(log: DayLog, trackerId: string, startHour: number, endHour: number): (number | null)[] {
  const points = trackerPoints(log, trackerId);
  const row: (number | null)[] = [];
  if (points.length === 0) {
    for (let h = startHour; h < endHour; h++) row.push(null);
    return row;
  }
  const firstHour = Math.floor(points[0].minutes / 60);
  const lastHour = Math.floor(points[points.length - 1].minutes / 60);
  for (let h = startHour; h < endHour; h++) {
    if (h < firstHour || h > lastHour) {
      row.push(null);
      continue;
    }
    const end = (h + 1) * 60;
    let value: number | null = null;
    for (const p of points) {
      if (p.minutes < end) value = p.value;
      else break;
    }
    row.push(value);
  }
  return row;
}

function dailyAverage(log: DayLog, trackerId: string): number | null {
  const day = log.trackers.find((t) => t.tracker.id === trackerId);
  if (!day || day.readings.length === 0) return null;
  return day.readings.reduce((a, r) => a + r.value, 0) / day.readings.length;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface Insight {
  /** What splits the days, e.g. "Theanine" or "Woke before 07:30". */
  subject: string;
  tracker: Metric;
  /** Average on matching days minus average on the other days. */
  delta: number;
  withDays: number;
  withoutDays: number;
}

/** Fewest days on each side of a split before it's worth reporting. */
export const MIN_DAYS_PER_SIDE = 3;

/**
 * Compare each rating tracker's daily average on days that match a
 * condition (took a substance, had an event, woke early) against days
 * that don't. Returns the larger differences first, measured as a share of
 * the tracker's range so mood (1–5) and focus (1–10) rank fairly.
 */
export function findInsights(logs: DayLog[], trackers: Metric[], limit = 8): Insight[] {
  const ratingTrackers = trackers.filter((t) => t.trackerType !== 'minutes');
  const splits: { subject: string; matches: (log: DayLog) => boolean }[] = [];

  const substanceNames = new Set(logs.flatMap((l) => l.doses.map((d) => d.name)));
  for (const name of substanceNames) {
    splits.push({ subject: name, matches: (l) => l.doses.some((d) => d.name === name) });
  }

  const symptomNames = new Set(logs.flatMap((l) => l.symptoms.map((s) => s.name.toLowerCase())));
  for (const name of symptomNames) {
    const label = logs.flatMap((l) => l.symptoms).find((s) => s.name.toLowerCase() === name)?.name ?? name;
    splits.push({ subject: `${label} (symptom)`, matches: (l) => l.symptoms.some((s) => s.name.toLowerCase() === name) });
  }

  const eventNames = new Set(logs.flatMap((l) => l.events.map((e) => e.name.toLowerCase())));
  for (const name of eventNames) {
    const label = logs.flatMap((l) => l.events).find((e) => e.name.toLowerCase() === name)?.name ?? name;
    splits.push({ subject: `${label} (event)`, matches: (l) => l.events.some((e) => e.name.toLowerCase() === name) });
  }

  // Time markers (wake up, bed time): split at the median time.
  const markerLabels = new Set(logs.flatMap((l) => l.markers.map((m) => m.label)));
  for (const label of markerLabels) {
    const times = logs
      .map((l) => minutesOf(l.markers.find((m) => m.label === label)?.time ?? null))
      .filter((m): m is number => m !== null)
      .sort((a, b) => a - b);
    if (times.length < MIN_DAYS_PER_SIDE * 2) continue;
    const median = times[Math.floor(times.length / 2)];
    const hhmm = `${String(Math.floor(median / 60)).padStart(2, '0')}:${String(median % 60).padStart(2, '0')}`;
    splits.push({
      subject: `${label} before ${hhmm}`,
      matches: (l) => {
        const m = minutesOf(l.markers.find((x) => x.label === label)?.time ?? null);
        return m !== null && m < median;
      },
    });
  }

  const found: (Insight & { weight: number })[] = [];
  for (const tracker of ratingTrackers) {
    const range = tracker.max - tracker.min || 1;
    const days = logs
      .map((log) => ({ log, avg: dailyAverage(log, tracker.id) }))
      .filter((d): d is { log: DayLog; avg: number } => d.avg !== null);

    for (const split of splits) {
      const withVals = days.filter((d) => split.matches(d.log)).map((d) => d.avg);
      const withoutVals = days.filter((d) => !split.matches(d.log)).map((d) => d.avg);
      if (withVals.length < MIN_DAYS_PER_SIDE || withoutVals.length < MIN_DAYS_PER_SIDE) continue;
      const delta = mean(withVals) - mean(withoutVals);
      const weight = Math.abs(delta) / range;
      // Ignore differences under 5% of the scale — that's noise at these sample sizes.
      if (weight < 0.05) continue;
      found.push({ subject: split.subject, tracker, delta, withDays: withVals.length, withoutDays: withoutVals.length, weight });
    }
  }

  return found
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map(({ weight: _w, ...rest }) => rest);
}

// ── Symptoms after doses ─────────────────────────────────────

export interface DoseLink {
  substance: string;
  symptom: string;
  windowHours: number;
  /** Days the substance was taken (with a time). */
  doseDays: number;
  /** …of which the symptom began within the window after a dose. */
  doseHits: number;
  /** Days without the substance. */
  otherDays: number;
  /** …of which the symptom began at all. */
  otherHits: number;
}

/** Fewest days with a dose, and dose-day onsets, before a link is worth showing. */
export const MIN_DOSE_DAYS = 3;
export const MIN_DOSE_HITS = 2;

/**
 * For each substance and symptom: how often the symptom began within the
 * substance's window after a dose, against how often it began on days
 * without that substance. Only onsets count — a symptom carried in from an
 * earlier day didn't begin that day. Strongest differences first.
 *
 * @param window hours, either one for all substances or per substance name
 */
export function symptomsAfterDoses(
  logs: DayLog[],
  window: number | ((substance: string) => number),
  limit = 6
): DoseLink[] {
  const windowOf = typeof window === 'number' ? () => window : window;
  const substances = new Set(logs.flatMap((l) => l.doses.map((d) => d.name)));
  const symptomNames = new Set(logs.flatMap((l) => l.symptoms.map((s) => s.name.toLowerCase())));
  const links: (DoseLink & { lift: number })[] = [];

  for (const substance of substances) {
    const windowHours = windowOf(substance);
    const windowMinutes = windowHours * 60;
    for (const symptomKey of symptomNames) {
      let doseDays = 0, doseHits = 0, otherDays = 0, otherHits = 0;
      let label = symptomKey;
      for (const log of logs) {
        const onsetDay = log.symptoms.find((s) => s.name.toLowerCase() === symptomKey && s.carriedIn === null);
        if (onsetDay) label = onsetDay.name;
        const onset = minutesOf(onsetDay?.startTime ?? null);
        const doseTimes = log.doses
          .filter((d) => d.name === substance)
          .map((d) => minutesOf(d.time))
          .filter((m): m is number => m !== null);

        if (log.doses.some((d) => d.name === substance)) {
          if (doseTimes.length === 0) continue; // taken, but untimed: can't judge the window
          doseDays++;
          if (onset !== null && doseTimes.some((t) => onset >= t && onset - t <= windowMinutes)) doseHits++;
        } else {
          otherDays++;
          if (onsetDay) otherHits++;
        }
      }
      if (doseDays < MIN_DOSE_DAYS || doseHits < MIN_DOSE_HITS || otherDays < MIN_DAYS_PER_SIDE) continue;
      const lift = doseHits / doseDays - otherHits / otherDays;
      // Only report when dose days clearly stand out.
      if (lift < 0.2) continue;
      links.push({ substance, symptom: label, windowHours, doseDays, doseHits, otherDays, otherHits, lift });
    }
  }

  return links
    .sort((a, b) => b.lift - a.lift)
    .slice(0, limit)
    .map(({ lift: _l, ...rest }) => rest);
}
