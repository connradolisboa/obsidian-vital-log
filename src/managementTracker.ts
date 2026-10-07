// ============================================================
// Vital Log — Management Tracker integration
// Reads Time Tracker sessions through Management Tracker's public API
// (`app.plugins.plugins['management-tracker'].api`, version >= 1).
// Optional: every caller copes with the plugin being absent, disabled,
// or loaded after Vital Log.
// ============================================================

import type { App } from 'obsidian';

/** One session as Management Tracker's API returns it. */
export interface MtSession {
  id: string;
  date: string;
  /** `HH:mm` start. */
  time: string;
  /** `HH:mm` end; may pass midnight (`24:10`). */
  end: string;
  minutes: number;
  title: string;
  /** What it counts toward, readable; empty when nothing. */
  countsToward: string;
  targetPath: string | null;
  area: string;
  tags: string[];
  note: string;
  source: 'timer' | 'koreader';
  notePath: string;
  line: number;
}

export interface ManagementApi {
  version: number;
  sessionsOn(date: string): MtSession[];
  minutesOn(date: string): number;
  onChange(callback: () => void): () => void;
  editSession(notePath: string, id: string): boolean;
  openTimeTracker(where?: 'tab' | 'sidebar'): void;
}

/** The API when Management Tracker is enabled and new enough, else null. */
export function getManagementApi(app: App): ManagementApi | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { api?: unknown }> } }).plugins;
  const api = plugins?.plugins?.['management-tracker']?.api as Partial<ManagementApi> | undefined;
  if (!api || typeof api.version !== 'number' || api.version < 1) return null;
  if (typeof api.sessionsOn !== 'function' || typeof api.onChange !== 'function') return null;
  return api as ManagementApi;
}

/** "1h 25m", "45m", "2h". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
