// ============================================================
// Vital Log — Shared Types
// ============================================================

export interface Vitamin {
  id: string;
  displayName: string;   // e.g. "Vitamin C"
  propertyKey: string;   // e.g. "vitaminC" — unique across all vitamins
  defaultAmount: number;
  unit: string;          // free-form: "mg", "IU", "mcg", etc.
  archived?: boolean;
}

export interface PackItem {
  vitaminId: string;
  amount: number;        // overrides vitamin's defaultAmount
}

export interface Pack {
  id: string;
  displayName: string;   // e.g. "Multivitamin"
  items: PackItem[];
  archived?: boolean;
}

export type StackItemType =
  | { type: 'pack'; packId: string }
  | { type: 'vitamin'; vitaminId: string; amount?: number };

export interface Stack {
  id: string;
  displayName: string;       // e.g. "Morning Stack"
  schedulingHint: string;    // "Morning" | "Evening" | "Pre-workout" | "Post-workout" | "Custom"
  items: StackItemType[];
  archived?: boolean;
}

export interface VitalLogSettings {
  dailyNotePath: string;     // template with {{YYYY}}, {{Q}}, {{YYYY-MM-DD dddd}}
  vitamins: Vitamin[];
  packs: Pack[];
  stacks: Stack[];
  metrics: Metric[];          // unified trackers + tally counters
  trackers?: TrackerConfig[];        // legacy — migrated into `metrics` on load
  tallyCounters?: TallyCounterConfig[]; // legacy — migrated into `metrics` on load
  customModals: CustomModalConfig[];  // user-defined log modals
  plannedLogs: PlannedLogs;  // dashboard goals + supplement/tally schedule
  sameFolderPrefix: string;  // reserved for future use
  logMode: 'perVitamin' | 'substances'; // perVitamin: each vitamin gets its own key; substances: all go into substances[]
  logSource: boolean;         // whether to include the source field on entries
  logPackEntries: boolean;    // whether to write a packs[] entry when logging a pack
  logStackEntries: boolean;   // whether to write a stacks[] entry when logging a stack
  appendToNoteDefault_supplements: boolean; // default state of "append to note content" checkbox in log modal
  appendToNoteDefault_trackers: boolean;    // default state of "append to note content" checkbox in tracker modal
  appendToNoteDefault_tallies: boolean;     // default state of "append to note content" checkbox in tally modal
  noteContentTemplate_supplements: string; // template for supplement note lines. Tokens: {time} {name} {amount} {unit} {note}
  noteContentTemplate_trackers: string;    // template for tracker note lines. Tokens: {time} {name} {value} {note}
  noteContentTemplate_tallies: string;     // template for tally note lines. Tokens: {name} {value} {target}
  noteContentTemplate_specificNoteTally: string; // template for per-tally specific-note lines. Tokens: {dailyNote} {time} {name} {value} {target}
  mirrorExcludedKeys?: string[]; // property keys never shown in the "Other Properties" section of mirror modals
  propertyKeySnapshot?: PropertyKeySnapshot; // snapshot of all property keys for rename detection
  eventTypes: EventType[];
  eventsPropertyKey: string;            // frontmatter key for events list (default: "events")
  showEventsInGraph: boolean;           // show event markers on dashboard sparklines
  graphEventSeverityMin: number;        // minimum severity (1–5) to show as a sparkline marker
  appendToNoteDefault_events: boolean;
  noteContentTemplate_events: string;   // tokens: {time} {name} {severity} {note}
}

// Shape written to frontmatter per vitamin property (list element)
export interface VitaminEntry {
  time: string;          // "HH:mm"
  amount: number;
  unit: string;
  note?: string;
  source?: string;       // "manual" | pack displayName | stack displayName
}

// Shape written to frontmatter for substances[] array element (flat log mode)
export interface SubstanceEntry {
  name: string;
  amount: number;
  unit: string;
  time: string;          // "HH:mm"
  source?: string;
  note?: string;
}

// Shape written to frontmatter for packs[] array element
export interface PackEntry {
  time: string;
  name: string;
  source?: string;       // "manual" | stack displayName
}

// Shape written to frontmatter for stacks[] array element
export interface StackEntry {
  time: string;
  name: string;
}

// ── Type guards ──────────────────────────────────────────────

export function isSubstanceEntry(v: unknown): v is SubstanceEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['name'] === 'string' &&
    typeof o['amount'] === 'number' &&
    typeof o['unit'] === 'string' &&
    typeof o['time'] === 'string'
  );
}

export function isVitaminEntry(v: unknown): v is VitaminEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['time'] === 'string' &&
    typeof o['amount'] === 'number' &&
    typeof o['unit'] === 'string'
  );
}

export function isPackEntry(v: unknown): v is PackEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['time'] === 'string' && typeof o['name'] === 'string';
}

export function isStackEntry(v: unknown): v is StackEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['time'] === 'string' && typeof o['name'] === 'string';
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

// ── Tracker types (mood, energy, etc.) ──────────────────────

export type TrackerType = 'rating' | 'minutes' | 'tally' | 'checkbox';

// Aggregation applied to a day's tracker values for the dashboard.
export type StatType = 'sum' | 'average' | 'min' | 'max' | 'count' | 'latest';

export const STAT_TYPES: StatType[] = ['sum', 'average', 'min', 'max', 'count', 'latest'];

export const STAT_LABELS: Record<StatType, string> = {
  sum: 'Total',
  average: 'Average',
  min: 'Lowest',
  max: 'Highest',
  count: 'Count',
  latest: 'Latest',
};

// Default stat config when a tracker hasn't customised it.
export function defaultPrimaryStat(type: TrackerType | undefined): StatType {
  return type === 'minutes' ? 'sum' : 'average';
}

export function defaultDisplayStats(type: TrackerType | undefined): StatType[] {
  return type === 'minutes'
    ? ['sum', 'count']
    : ['average', 'min', 'max', 'count'];
}

// ── Unified Metric model (trackers + tally counters) ────────
//
// A Metric is a single user-defined numeric thing logged per day. Its
// `trackerType` is the one axis that decides storage shape, input UX, and
// stats:
//
//   'rating'  — pick a value on a min–max scale; logged as a LIST of
//               timestamped entries (e.g. moodLog: [{time, mood}, …]).
//   'minutes' — log a duration; also a LIST of timestamped entries, summed.
//   'tally'   — a SINGLE running value per day (e.g. outreachTally:
//               {value, note}), incremented/decremented by `step`.
//
// 'rating' and 'minutes' are "series" (list) metrics; 'tally' is a "scalar"
// (single-value) metric. Helpers below derive that distinction. Fields that
// only apply to one type are populated with harmless defaults for the others
// so the rest of the code can treat them as definite.
export interface Metric {
  id: string;
  displayName: string;   // e.g. "Mood", "Energy", "Outreach"
  propertyKey: string;   // frontmatter key, e.g. "moodLog" / "outreachTally"
  icon: string;          // Obsidian icon name, e.g. "smile", "zap", "hash"
  trackerType?: TrackerType; // 'rating' (default) | 'minutes' | 'tally'
  description?: string;   // helper text shown in modals (mainly tally)

  // ── series ('rating' / 'minutes') fields ──
  valueName: string;     // field name inside entries, e.g. "mood"; '' for tally
  min: number;           // rating range min; 0 for minutes/tally
  max: number;           // rating range max; 0 for minutes/tally
  primaryStat?: StatType;    // aggregation used for the dashboard goal bar
  displayStats?: StatType[]; // which stats to show on the dashboard

  // ── scalar ('tally') fields ──
  target: number;        // visual goal (tally); 0 for series
  step: number;          // increment/decrement amount per click (tally); 1 for series
  showInStatusBar?: boolean; // show current/target in the status bar
  appendToNoteName?: string; // vault path (no .md) of note to append tally lines to
  archived?: boolean;
}

// Legacy aliases — both former config types are now structural views of Metric.
export type TrackerConfig = Metric;

/** A tally is a scalar (single value per day) metric; everything else is a series. */
export function isTallyMetric(m: Metric): boolean {
  return m.trackerType === 'tally';
}

/** Filter a settings object's metrics to the series ('rating' / 'minutes') metrics. */
export function seriesMetrics(settings: { metrics: Metric[] }): Metric[] {
  return settings.metrics.filter((m) => m.trackerType !== 'tally' && m.trackerType !== 'checkbox');
}

/** Filter a settings object's metrics to the scalar ('tally') metrics. */
export function scalarMetrics(settings: { metrics: Metric[] }): Metric[] {
  return settings.metrics.filter((m) => m.trackerType === 'tally');
}

/** Filter a settings object's metrics to the checkbox metrics. */
export function checkboxMetrics(settings: { metrics: Metric[] }): Metric[] {
  return settings.metrics.filter((m) => m.trackerType === 'checkbox');
}

/** Find a metric by id regardless of type. */
export function findMetric(settings: { metrics: Metric[] }, id: string): Metric | undefined {
  return settings.metrics.find((m) => m.id === id);
}

/** Coerce a legacy tracker config into a unified series Metric (fills tally defaults). */
export function metricFromLegacyTracker(t: Record<string, unknown>): Metric {
  return {
    id: String(t['id'] ?? crypto.randomUUID()),
    displayName: String(t['displayName'] ?? ''),
    propertyKey: String(t['propertyKey'] ?? ''),
    icon: typeof t['icon'] === 'string' && t['icon'] ? (t['icon'] as string) : 'activity',
    valueName: String(t['valueName'] ?? ''),
    trackerType: t['trackerType'] === 'minutes' ? 'minutes' : (t['trackerType'] === 'rating' ? 'rating' : undefined),
    min: typeof t['min'] === 'number' ? (t['min'] as number) : 1,
    max: typeof t['max'] === 'number' ? (t['max'] as number) : 5,
    primaryStat: t['primaryStat'] as StatType | undefined,
    displayStats: Array.isArray(t['displayStats']) ? (t['displayStats'] as StatType[]) : undefined,
    target: 0,
    step: 1,
  };
}

/** Coerce a legacy tally-counter config into a unified 'tally' Metric (fills series defaults). */
export function metricFromLegacyTally(t: Record<string, unknown>): Metric {
  return {
    id: String(t['id'] ?? crypto.randomUUID()),
    displayName: String(t['displayName'] ?? ''),
    propertyKey: String(t['propertyKey'] ?? ''),
    icon: typeof t['icon'] === 'string' && t['icon'] ? (t['icon'] as string) : 'hash',
    trackerType: 'tally',
    description: typeof t['description'] === 'string' ? (t['description'] as string) : undefined,
    valueName: '',
    min: 0,
    max: 0,
    target: typeof t['target'] === 'number' ? (t['target'] as number) : 0,
    step: typeof t['step'] === 'number' ? Math.max(1, t['step'] as number) : 1,
    showInStatusBar: t['showInStatusBar'] === true ? true : undefined,
    appendToNoteName: typeof t['appendToNoteName'] === 'string' ? (t['appendToNoteName'] as string) : undefined,
  };
}

export interface TrackerEntry {
  time: string;          // "HH:mm"
  [valueName: string]: string | number | undefined;  // dynamic value field
  note?: string;
}

export function isTrackerEntry(v: unknown, valueName: string): v is TrackerEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['time'] === 'string' && typeof o[valueName] === 'number';
}

// ── Tally Counter types ─────────────────────────────────────

export type TallyCounterConfig = Metric;

export interface TallyEntry {
  value: number;
  note?: string;
}

// ── Planned Logs: goals + schedule (dashboard) ──────────────

// A single goal value effective from a given date forward.
// History is kept sorted ascending by effectiveFrom; the goal for a
// viewed date is the latest record whose effectiveFrom <= that date.
export interface GoalRecord {
  value: number;
  effectiveFrom: string; // "YYYY-MM-DD"
}

export interface TrackerGoalPlan {
  trackerId: string;
  enabled: boolean;          // show this tracker's goal in the dashboard
  goalHistory: GoalRecord[];
}

export type Frequency =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }              // 0=Sun … 6=Sat
  | { type: 'everyNDays'; n: number; anchor: string }; // anchor = "YYYY-MM-DD"

export type ScheduleKind = 'vitamin' | 'pack' | 'stack' | 'tally' | 'checkbox';

export interface ScheduleItem {
  id: string;
  kind: ScheduleKind;
  refId: string;             // vitaminId / packId / stackId / tallyCounterId
  frequency: Frequency;
}

export interface PlannedLogs {
  trackerGoals: TrackerGoalPlan[];
  schedule: ScheduleItem[];
}

// ── Custom Modal types ──────────────────────────────────────

export type CustomFieldType =
  | 'slider'    // outputs number, configurable min/max/step
  | 'text'      // single-line text input
  | 'textarea'  // multi-line text box
  | 'number'    // number input
  | 'date'      // date picker (outputs "YYYY-MM-DD")
  | 'checkbox'  // toggle (outputs true/false)
  | 'dropdown'  // select from options (outputs string)
  | 'time'      // time picker (outputs "HH:mm")
  | 'rating'    // button grid (outputs number)
  | 'tags';     // multi-select tag input (outputs string[])

export interface CustomField {
  id: string;
  propertyKey: string;      // frontmatter key, e.g. "dayReview"
  parentKey?: string;       // if set, written as parentKey.propertyKey in frontmatter
  displayName: string;      // label shown in modal, e.g. "Day Review"
  description: string;      // helper text, e.g. "Review your day from 1-10"
  fieldType: CustomFieldType;
  min?: number;             // slider, rating
  max?: number;             // slider, rating
  step?: number;            // slider (default 1)
  options?: string[];       // dropdown options
}

export interface CustomButtonConfig {
  id: string;
  displayName: string;
  buttonType: 'filelink' | 'command';
  target: string;           // vault-relative file path or Obsidian command ID
  icon?: string;
}

export type CustomModalItem =
  | { type: 'field'; field: CustomField }
  | { type: 'tally'; tallyCounterId: string; tallySnapshot?: TallyCounterConfig }
  | { type: 'tracker'; trackerId: string; trackerSnapshot?: TrackerConfig }
  | { type: 'button'; button: CustomButtonConfig }
  | { type: 'header'; text: string }
  | { type: 'divider' }
  | { type: 'section'; title: string; defaultOpen: boolean; color?: string }
  | { type: 'section-end' };

export interface MirrorConditionalPin {
  id: string;
  conditionType: 'tag' | 'folder';
  conditionValue: string;   // e.g. "#work" or "Work/"
  pinnedIds: string[];      // field IDs or tallyCounterIds to always show when condition matches
}

export interface CustomModalConfig {
  id: string;
  displayName: string;      // e.g. "Daily Review"
  icon: string;             // Obsidian icon name
  notePath: string;         // path template, e.g. "Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}"
  useTemplater: boolean;    // trigger Templater on new note creation
  templatePath: string;     // path to template file for Templater
  items: CustomModalItem[];
  archived?: boolean;                          // archived modals are hidden from commands/ribbon but still resolve for embeds
  mirrorMode?: boolean;                        // only show properties that already exist in the current note
  mirrorModePinnedIds?: string[];              // field IDs or tallyCounterIds that always show in mirror mode
  mirrorModeConditionalPins?: MirrorConditionalPin[]; // tag/folder-conditional pins
  showOtherProperties?: boolean;               // show collapsed "Other Properties" section with remaining modal fields
}

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  'slider', 'text', 'textarea', 'number', 'date',
  'checkbox', 'dropdown', 'time', 'rating', 'tags',
];

export const SCHEDULING_HINTS = [
  'Morning',
  'Evening',
  'Pre-workout',
  'Post-workout',
  'Custom',
] as const;

export type SchedulingHint = (typeof SCHEDULING_HINTS)[number];

// ── Key Snapshot types ───────────────────────────────────────

export interface SnapshotRecord {
  id: string;
  entityType: 'tracker' | 'tally' | 'checkbox' | 'vitamin' | 'customField';
  entityName: string;
  propertyKey: string;
  valueName?: string;    // trackers: sub-key within each entry object
  parentKey?: string;    // custom fields: parent container key
  modalId?: string;      // custom fields only
  modalName?: string;    // custom fields only
}

export interface PropertyKeySnapshot {
  records: SnapshotRecord[];
  capturedAt: string;
}

// ── Event types ──────────────────────────────────────────────

/** A reusable event template saved in settings (e.g. "Sick", "Traveling"). */
export interface EventType {
  id: string;
  displayName: string;
  icon?: string;
  archived?: boolean;
}

/** A logged event entry written to the daily note frontmatter. */
export interface EventEntry {
  time: string;      // "HH:mm"
  name: string;      // matches EventType.displayName or free-form
  severity: number;  // 1–5
  note?: string;
}

export function isEventEntry(v: unknown): v is EventEntry {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['time'] === 'string' &&
    typeof o['name'] === 'string' &&
    typeof o['severity'] === 'number'
  );
}

/** Human labels for the 1–5 severity scale. */
export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Minor',
  2: 'Low',
  3: 'Moderate',
  4: 'High',
  5: 'Severe',
};

export const DEFAULT_SETTINGS: VitalLogSettings = {
  dailyNotePath: 'Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}',
  vitamins: [],
  packs: [],
  stacks: [],
  metrics: [
    { id: 'mood-default', displayName: 'Mood', propertyKey: 'moodLog', valueName: 'mood', trackerType: 'rating', min: 1, max: 5, icon: 'smile', target: 0, step: 1 },
    { id: 'energy-default', displayName: 'Energy', propertyKey: 'energyLog', valueName: 'energy', trackerType: 'rating', min: 1, max: 5, icon: 'zap', target: 0, step: 1 },
  ],
  customModals: [],
  plannedLogs: { trackerGoals: [], schedule: [] },
  sameFolderPrefix: '',
  logMode: 'perVitamin',
  logSource: true,
  logPackEntries: true,
  logStackEntries: true,
  appendToNoteDefault_supplements: false,
  appendToNoteDefault_trackers: false,
  appendToNoteDefault_tallies: false,
  appendToNoteDefault_events: false,
  noteContentTemplate_supplements: '- {time} {name} {amount}{unit}',
  noteContentTemplate_trackers: '- {time} {name}: {value}',
  noteContentTemplate_tallies: '- {name}: {value}/{target}',
  noteContentTemplate_specificNoteTally: '- [[{dailyNote}]] {time} : {value}/{target}',
  noteContentTemplate_events: '- {time} {name} (severity: {severity})',
  mirrorExcludedKeys: [],
  eventTypes: [],
  eventsPropertyKey: 'events',
  showEventsInGraph: false,
  graphEventSeverityMin: 1,
};
