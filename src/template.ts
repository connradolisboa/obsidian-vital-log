// ============================================================
// Vital Log — Note-content template helper
// Shared {token} substitution used by every "append to note" template
// (supplements, trackers, tallies). One implementation so the rules —
// global replace, unknown tokens → empty, collapse double spaces, trim —
// stay consistent everywhere.
// ============================================================

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
