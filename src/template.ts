// ============================================================
// Vital Log — Note-content template helper
// Shared {token} substitution used by every "append to note" template
// (supplements, trackers, tallies). One implementation so the rules —
// global replace, unknown tokens → empty, collapse double spaces, trim —
// stay consistent everywhere.
// ============================================================

import type { VitalLogSettings } from './types';

/**
 * Substitute {token} placeholders in a template string.
 * Unknown/missing tokens are replaced with empty string.
 * Collapses runs of spaces left by empty tokens and trims the trailing edge.
 */
export function applyTemplate(template: string, vars: Record<string, string>): string {
  let result = template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  result = result.replace(/ {2,}/g, ' ').trimEnd();
  return result;
}

/**
 * The heading to pass to `appendLineToBody`, or undefined to append at the
 * end of the file — per the user's "append below a heading" setting.
 */
export function noteContentHeading(settings?: Pick<VitalLogSettings, 'noteContentUseHeading' | 'noteContentHeading'>): string | undefined {
  return settings?.noteContentUseHeading ? settings.noteContentHeading : undefined;
}
