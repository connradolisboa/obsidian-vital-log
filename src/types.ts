// ============================================================
// Vital Log — Shared Types
// ============================================================

export interface Vitamin {
  id: string;
  displayName: string;   // e.g. "Vitamin C"
  propertyKey: string;   // e.g. "vitaminC" — unique across all vitamins
  defaultAmount: number;
  unit: string;          // free-form: "mg", "IU", "mcg", etc.
}

export interface PackItem {
  vitaminId: string;
  amount: number;        // overrides vitamin's defaultAmount
}

export interface Pack {
  id: string;
  displayName: string;   // e.g. "Multivitamin"
  items: PackItem[];
}

export type StackItemType =
  | { type: 'pack'; packId: string }
  | { type: 'vitamin'; vitaminId: string; amount?: number };

export interface Stack {
  id: string;
  displayName: string;       // e.g. "Morning Stack"
  schedulingHint: string;    // "Morning" | "Evening" | "Pre-workout" | "Post-workout" | "Custom"
  items: StackItemType[];
}

export interface VitalLogSettings {
  dailyNotePath: string;     // template with {{YYYY}}, {{Q}}, {{YYYY-MM-DD dddd}}
  vitamins: Vitamin[];
  packs: Pack[];
  stacks: Stack[];
  trackers: TrackerConfig[];  // mood, energy, etc.
  customModals: CustomModalConfig[];  // user-defined log modals
  sameFolderPrefix: string;  // reserved for future use
  logMode: 'perVitamin' | 'substances'; // perVitamin: each vitamin gets its own key; substances: all go into substances[]
  logSource: boolean;         // whether to include the source field on entries
  logPackEntries: boolean;    // whether to write a packs[] entry when logging a pack
  logStackEntries: boolean;   // whether to write a stacks[] entry when logging a stack
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

export interface TrackerConfig {
  id: string;
  displayName: string;   // e.g. "Mood", "Energy"
  propertyKey: string;   // frontmatter key, e.g. "moodLog"
  valueName: string;     // field name inside entries, e.g. "mood", "energy"
  min: number;           // minimum value (e.g. 1)
  max: number;           // maximum value (e.g. 5)
  icon: string;          // Obsidian icon name, e.g. "smile", "zap"
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
  displayName: string;      // label shown in modal, e.g. "Day Review"
  description: string;      // helper text, e.g. "Review your day from 1-10"
  fieldType: CustomFieldType;
  min?: number;             // slider, rating
  max?: number;             // slider, rating
  step?: number;            // slider (default 1)
  options?: string[];       // dropdown options
}

export interface CustomModalConfig {
  id: string;
  displayName: string;      // e.g. "Daily Review"
  icon: string;             // Obsidian icon name
  notePath: string;         // path template, e.g. "Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}"
  useTemplater: boolean;    // trigger Templater on new note creation
  templatePath: string;     // path to template file for Templater
  fields: CustomField[];
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

export const DEFAULT_SETTINGS: VitalLogSettings = {
  dailyNotePath: 'Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}',
  vitamins: [],
  packs: [],
  stacks: [],
  trackers: [
    { id: 'mood-default', displayName: 'Mood', propertyKey: 'moodLog', valueName: 'mood', min: 1, max: 5, icon: 'smile' },
    { id: 'energy-default', displayName: 'Energy', propertyKey: 'energyLog', valueName: 'energy', min: 1, max: 5, icon: 'zap' },
  ],
  customModals: [],
  sameFolderPrefix: '',
  logMode: 'perVitamin',
  logSource: true,
  logPackEntries: true,
  logStackEntries: true,
};
