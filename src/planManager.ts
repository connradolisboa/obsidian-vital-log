// ============================================================
// Vital Log — Planned Logs: goal resolution + scheduling
//
// Pure helpers (no Obsidian I/O). Goals are date-versioned: the goal
// for a viewed date is the latest record whose effectiveFrom <= that
// date. Editing a goal always pivots at *today* (today-forward), so
// past dates keep whatever goal was in effect then.
// ============================================================

import type {
  VitalLogSettings,
  TrackerGoalPlan,
  GoalRecord,
  ScheduleItem,
  Frequency,
} from './types';

// ── Date helpers (local-time ISO "YYYY-MM-DD") ──────────────

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Parse "YYYY-MM-DD" as a local-time Date at midnight. */
export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Whole days from `a` to `b` (b - a), ignoring time-of-day. */
export function daysBetween(a: Date, b: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((db - da) / MS);
}

/** Shift an ISO date by a number of days (can be negative). */
export function shiftDaysISO(iso: string, deltaDays: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + deltaDays);
  return toISODate(d);
}

/** Inclusive list of ISO dates from start to end. */
export function dateRange(startISO: string, endISO: string): string[] {
  const start = fromISODate(startISO);
  const end = fromISODate(endISO);
  const out: string[] = [];
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    out.push(toISODate(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// ── Goal resolution ─────────────────────────────────────────

/** The goal value in effect on `dateISO`, or null if none yet. */
export function resolveGoal(plan: TrackerGoalPlan, dateISO: string): number | null {
  let best: GoalRecord | null = null;
  for (const rec of plan.goalHistory) {
    if (rec.effectiveFrom <= dateISO) {
      if (!best || rec.effectiveFrom > best.effectiveFrom) best = rec;
    }
  }
  return best ? best.value : null;
}

export function getGoalPlan(
  settings: VitalLogSettings,
  trackerId: string
): TrackerGoalPlan | undefined {
  return settings.plannedLogs.trackerGoals.find((p) => p.trackerId === trackerId);
}

/**
 * Set a tracker's goal effective from today forward. Creates the plan if
 * missing, replaces any record already dated today, and keeps history sorted.
 * Returns the (possibly new) plan. Caller is responsible for saving settings.
 */
export function setGoalFromToday(
  settings: VitalLogSettings,
  trackerId: string,
  value: number
): TrackerGoalPlan {
  let plan = getGoalPlan(settings, trackerId);
  if (!plan) {
    plan = { trackerId, enabled: true, goalHistory: [] };
    settings.plannedLogs.trackerGoals.push(plan);
  }
  const today = todayISO();
  const existing = plan.goalHistory.find((r) => r.effectiveFrom === today);
  if (existing) {
    existing.value = value;
  } else {
    plan.goalHistory.push({ value, effectiveFrom: today });
  }
  plan.goalHistory.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return plan;
}

// ── Scheduling ──────────────────────────────────────────────

/** Whether a scheduled item is due on the given date. */
export function isScheduledOn(item: ScheduleItem, date: Date): boolean {
  return frequencyMatches(item.frequency, date);
}

export function frequencyMatches(freq: Frequency, date: Date): boolean {
  switch (freq.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return freq.days.includes(date.getDay());
    case 'everyNDays': {
      if (freq.n <= 0) return false;
      const anchor = fromISODate(freq.anchor);
      const diff = daysBetween(anchor, date);
      return diff >= 0 && diff % freq.n === 0;
    }
  }
}

export function getScheduledForDate(
  settings: VitalLogSettings,
  date: Date
): ScheduleItem[] {
  return settings.plannedLogs.schedule.filter((item) => isScheduledOn(item, date));
}

export function describeFrequency(freq: Frequency): string {
  switch (freq.type) {
    case 'daily':
      return 'Every day';
    case 'weekdays': {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = [...freq.days].sort((a, b) => a - b).map((d) => names[d]);
      return days.length ? days.join(', ') : 'No days';
    }
    case 'everyNDays':
      return freq.n === 1 ? 'Every day' : `Every ${freq.n} days`;
  }
}
