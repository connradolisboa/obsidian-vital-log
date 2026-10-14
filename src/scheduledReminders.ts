// ============================================================
// Vital Log — reminders for scheduled items
//
// A schedule item with reminder times (types.ts ScheduleItem.times) is
// reminded about by Telegram Capture's relay, by Telegram or ntfy, unless
// it's already logged that day. This gives the relay what's due and done,
// and logs an item when a reminder's button says it was taken. The relay's
// events reach here when Obsidian next opens, so a log goes to the day and
// time the button was tapped.
// ============================================================

import type { App } from 'obsidian';
import type { ScheduleItem, ScheduleKind, VitalLogSettings } from './types';
import { checkboxMetrics, scalarMetrics, seriesMetrics } from './types';
import { getScheduledForDate } from './planManager';
import { getFrontmatterForDate, isScheduleItemDone, readTallyValue } from './statsEngine';
import { resolveDailyNote } from './dailyNoteResolver';
import { logPack, logStack, logVitamin } from './vitaminManager';
import { logTracker } from './trackerManager';
import { updateTallyValue } from './tallyManager';
import { setCheckboxValue } from './checkboxManager';
import { logicalDay } from './dayBoundary';

export interface ScheduledReminder {
  /** The schedule item's id. */
  id: string;
  kind: ScheduleKind;
  name: string;
  /** `HH:mm`, sorted. */
  times: string[];
  /** Already logged on the day asked about. */
  done: boolean;
  /**
   * How a reminder's button logs it: `take` logs it as configured (default
   * amount, pack, stack, +1, ticked); `value` needs a number, from `range`.
   */
  action: 'take' | 'value';
  range?: { min: number; max: number };
  unit?: string;
}

/** What's due on a day with reminder times, and whether each is logged. */
export async function scheduledReminders(app: App, settings: VitalLogSettings, date: Date = logicalDay()): Promise<ScheduledReminder[]> {
  const items = getScheduledForDate(settings, date).filter((item) => item.times?.length);
  if (!items.length) return [];
  const fm = await getFrontmatterForDate(app, settings, date);
  const out: ScheduledReminder[] = [];
  for (const item of items) {
    const described = describe(settings, item);
    if (!described) continue;
    out.push({ id: item.id, kind: item.kind, times: [...(item.times ?? [])].sort(), done: isScheduleItemDone(fm, settings, item), ...described });
  }
  return out;
}

function describe(settings: VitalLogSettings, item: ScheduleItem): Pick<ScheduledReminder, 'name' | 'action' | 'range' | 'unit'> | null {
  switch (item.kind) {
    case 'vitamin': {
      const v = settings.vitamins.find((x) => x.id === item.refId);
      return v ? { name: v.displayName, action: 'take' } : null;
    }
    case 'pack': {
      const p = settings.packs.find((x) => x.id === item.refId);
      return p ? { name: p.displayName, action: 'take' } : null;
    }
    case 'stack': {
      const s = settings.stacks.find((x) => x.id === item.refId);
      return s ? { name: s.displayName, action: 'take' } : null;
    }
    case 'tally': {
      const t = scalarMetrics(settings).find((x) => x.id === item.refId);
      return t ? { name: t.displayName, action: 'take' } : null;
    }
    case 'checkbox': {
      const t = checkboxMetrics(settings).find((x) => x.id === item.refId);
      return t ? { name: t.displayName, action: 'take' } : null;
    }
    case 'metric': {
      const m = seriesMetrics(settings).find((x) => x.id === item.refId);
      if (!m) return null;
      const bounded = m.max > m.min && m.max - m.min <= 10;
      return {
        name: m.displayName,
        action: 'value',
        ...(bounded ? { range: { min: m.min, max: m.max } } : {}),
        ...(m.trackerType === 'minutes' ? { unit: 'min' } : {}),
      };
    }
  }
}

/** Log a scheduled item as its reminder's button asks: as configured, or with `value`. */
export async function logScheduled(
  app: App,
  settings: VitalLogSettings,
  id: string,
  opts: { date?: Date; value?: number } = {},
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const item = settings.plannedLogs.schedule.find((s) => s.id === id);
  if (!item) return { ok: false, error: 'That reminder is no longer in the schedule.' };
  const at = opts.date ?? new Date();
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const file = await resolveDailyNote(app, settings, logicalDay(at));
  if (!file) return { ok: false, error: 'The daily note couldn\'t be opened.' };

  switch (item.kind) {
    case 'vitamin': {
      const v = settings.vitamins.find((x) => x.id === item.refId);
      if (!v) break;
      await logVitamin(app, file, v, { time, amount: opts.value ?? v.defaultAmount, source: 'telegram' }, settings);
      return { ok: true, summary: `${v.displayName} @ ${time}` };
    }
    case 'pack': {
      const p = settings.packs.find((x) => x.id === item.refId);
      if (!p) break;
      await logPack(app, file, p, settings, { time });
      return { ok: true, summary: `${p.displayName} @ ${time}` };
    }
    case 'stack': {
      const s = settings.stacks.find((x) => x.id === item.refId);
      if (!s) break;
      await logStack(app, file, s, settings, { time });
      return { ok: true, summary: `${s.displayName} @ ${time}` };
    }
    case 'tally': {
      const t = scalarMetrics(settings).find((x) => x.id === item.refId);
      if (!t) break;
      const fm = await getFrontmatterForDate(app, settings, logicalDay(at));
      await updateTallyValue(app, file, t, readTallyValue(fm, t.propertyKey) + (opts.value ?? 1));
      return { ok: true, summary: `${t.displayName} +${opts.value ?? 1}` };
    }
    case 'checkbox': {
      const t = checkboxMetrics(settings).find((x) => x.id === item.refId);
      if (!t) break;
      await setCheckboxValue(app, file, t, true);
      return { ok: true, summary: `${t.displayName} ✓` };
    }
    case 'metric': {
      const m = seriesMetrics(settings).find((x) => x.id === item.refId);
      if (!m) break;
      if (opts.value === undefined) return { ok: false, error: `${m.displayName} needs a value.` };
      await logTracker(app, file, m, { time, value: opts.value }, settings);
      return { ok: true, summary: `${m.displayName} ${opts.value} @ ${time}` };
    }
  }
  return { ok: false, error: 'What that reminder was for no longer exists.' };
}
