// ============================================================
// Vital Log — Icon picker field
// A text input for an Obsidian (Lucide) icon name with autocomplete and a
// live preview swatch, so users don't have to guess valid icon names.
// ============================================================

import { getIconIds, setIcon } from 'obsidian';

const SHARED_LIST_ID = 'vital-log-icon-datalist';

let cachedNames: string[] | null = null;

/** All available icon names (Lucide ids with the `lucide-` prefix stripped), sorted & deduped. */
function iconNames(): string[] {
  if (cachedNames) return cachedNames;
  const names = getIconIds().map((id) => id.replace(/^lucide-/, ''));
  cachedNames = Array.from(new Set(names)).sort();
  return cachedNames;
}

/** Create (once) a shared <datalist> of icon names attached to the document body. */
function ensureSharedDatalist(): string {
  if (!document.getElementById(SHARED_LIST_ID)) {
    const dl = document.body.createEl('datalist');
    dl.id = SHARED_LIST_ID;
    for (const name of iconNames()) dl.createEl('option', { value: name });
  }
  return SHARED_LIST_ID;
}

/**
 * Render an icon field (preview swatch + autocompleting text input) into `row`.
 * Returns the input element so callers read `.value` exactly as before.
 */
export function createIconField(
  row: HTMLElement,
  opts: { value?: string; placeholder?: string } = {}
): HTMLInputElement {
  const wrap = row.createDiv('vital-log-icon-field');
  const preview = wrap.createSpan('vital-log-icon-preview');
  const input = wrap.createEl('input', { type: 'text', value: opts.value ?? '' });
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.setAttribute('list', ensureSharedDatalist());

  const renderPreview = (): void => {
    preview.empty();
    const name = input.value.trim();
    if (name) {
      try {
        setIcon(preview, name);
      } catch {
        // Unknown icon name — leave the swatch empty.
      }
    }
  };
  renderPreview();
  input.addEventListener('input', renderPreview);
  return input;
}
