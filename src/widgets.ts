// ============================================================
// Vital Log — Inline widget builder
// The DOM/event skeleton shared by every inline `tally:` / `counter:` widget
// (registered tally, ad-hoc tally, free-form counter). Each caller supplies
// only what differs: how to format the value, when it's "complete", and how
// to load/persist it. Keeps the span markup and button wiring in one place.
// ============================================================

import { setIcon } from 'obsidian';

/** Stop the editor from grabbing the click (which would dissolve the widget). */
function attachWidgetGuards(widget: HTMLElement): void {
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  widget.addEventListener('mousedown', stop);
  widget.addEventListener('pointerdown', stop);
}

export interface InlineWidgetOptions {
  /** Root span class, e.g. 'vital-log-inline-tally' or 'vital-log-inline-counter'. */
  className: string;
  /** Display label (also used for the +/− aria-labels). */
  name: string;
  /** Optional Lucide icon shown before the name. */
  icon?: string;
  /** Amount each +/− press changes the value by. Defaults to 1. */
  step?: number;
  /** Render the value text, e.g. `${v}/${target}` or `${v}`. */
  format: (value: number) => string;
  /** Whether the widget should show the `is-complete` state for a value. */
  isComplete?: (value: number) => boolean;
  /** Persist a new value (no-op allowed when there's no target note). */
  persist: (value: number) => void | Promise<void>;
  /** Load the initial value (async); the widget refreshes once it resolves. */
  load: () => number | Promise<number>;
}

/**
 * Build an interactive inline widget: `[−] [icon] name value [+]`.
 * Returns the root span; the caller inserts it into the document.
 */
export function buildInlineWidget(opts: InlineWidgetOptions): HTMLElement {
  const step = opts.step ?? 1;

  const widget = document.createElement('span');
  widget.className = opts.className;
  attachWidgetGuards(widget);

  const decBtn = widget.createEl('button', {
    text: '−',
    cls: 'vital-log-inline-btn vital-log-inline-btn--dec',
    attr: { 'aria-label': `Decrease ${opts.name}`, type: 'button' },
  });

  if (opts.icon) {
    const iconSpan = widget.createSpan({ cls: 'vital-log-inline-icon' });
    setIcon(iconSpan, opts.icon);
  }
  widget.createSpan({ cls: 'vital-log-inline-name', text: opts.name });

  let value = 0;
  const valueSpan = widget.createSpan({ cls: 'vital-log-inline-value' });
  const refresh = () => {
    valueSpan.textContent = opts.format(value);
    if (opts.isComplete) widget.toggleClass('is-complete', opts.isComplete(value));
  };
  refresh();

  const incBtn = widget.createEl('button', {
    text: '+',
    cls: 'vital-log-inline-btn vital-log-inline-btn--inc',
    attr: { 'aria-label': `Increase ${opts.name}`, type: 'button' },
  });

  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta * step);
    refresh();
    await opts.persist(value);
  };
  decBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(-1); });
  incBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(1); });

  // Async load of the current value.
  void (async () => {
    value = await opts.load();
    refresh();
  })();

  return widget;
}
