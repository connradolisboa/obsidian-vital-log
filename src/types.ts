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
  sameFolderPrefix: string;  // reserved for future use
}

// Shape written to frontmatter per vitamin property (list element)
export interface VitaminEntry {
  time: string;          // "HH:mm"
  amount: number;
  unit: string;
  note?: string;
  source?: string;       // "manual" | pack displayName | stack displayName
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
  sameFolderPrefix: '',
};
