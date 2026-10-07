// ============================================================
// Vital Log — Day viewer tabs
// The `vital-day` viewer's tabs, in display order. Kept apart from the
// viewer (which needs Obsidian's UI) so the public API can list them:
// a tab added here appears in both automatically.
// ============================================================

export const DAY_TABS = [
  { id: 'chart', label: 'Chart', icon: 'line-chart' },
  { id: 'timeline', label: 'Timeline', icon: 'clock' },
  { id: 'substances', label: 'Substances', icon: 'pill' },
  { id: 'trackers', label: 'Trackers', icon: 'activity' },
  { id: 'symptoms', label: 'Symptoms', icon: 'thermometer' },
  { id: 'events', label: 'Events', icon: 'calendar-clock' },
  // Only shown when Management Tracker's API is available.
  { id: 'time', label: 'Time', icon: 'timer' },
  { id: 'week', label: 'Week', icon: 'grid-3x3' },
  { id: 'insights', label: 'Insights', icon: 'lightbulb' },
] as const;

export type DayTab = (typeof DAY_TABS)[number]['id'];
