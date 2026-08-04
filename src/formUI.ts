// ============================================================
// Vital Log — Shared form UI helpers
// One place for the interaction details every editor in the plugin needs:
// unsaved-work tracking, guarded dismissal, inline field errors, native
// Obsidian toggles, and keyboard ergonomics for inline forms.
// ============================================================

import { App, Modal, ToggleComponent } from 'obsidian';
import { confirm } from './confirmModal';

// ── Unsaved-work tracking ────────────────────────────────────
// Dirtiness lives on the DOM node itself rather than in a registry, so a form
// that gets removed by a re-render takes its dirty flag with it — no bookkeeping.

const DIRTY_ATTR = 'data-vital-log-dirty';

/** Flag `formEl` as unsaved the moment the user edits anything inside it. */
export function trackFormDirty(formEl: HTMLElement): void {
  const mark = (): void => formEl.setAttribute(DIRTY_ATTR, 'true');
  formEl.addEventListener('input', mark);
  formEl.addEventListener('change', mark);
}

/** Forget any pending edits in `formEl` — call after a successful save. */
export function clearFormDirty(formEl: HTMLElement): void {
  formEl.removeAttribute(DIRTY_ATTR);
}

/** True when `root`, or anything inside it, holds edits the user hasn't saved. */
export function hasDirtyForm(root: HTMLElement): boolean {
  if (root.getAttribute(DIRTY_ATTR) === 'true') return true;
  return root.querySelector(`[${DIRTY_ATTR}="true"]`) !== null;
}

/** Ask whether to throw away pending edits. Resolves true when it's safe to proceed. */
export function confirmDiscard(app: App): Promise<boolean> {
  return confirm(app, {
    title: 'Discard unsaved changes?',
    message: 'You have edits that have not been saved yet. Closing now will lose them.',
    confirmText: 'Discard',
    cancelText: 'Keep editing',
  });
}

/**
 * Run `action`, but stop first to confirm if `root` holds unsaved edits.
 * Wrap any handler that re-renders or navigates away from an open form.
 */
export async function guardUnsaved(
  app: App,
  root: HTMLElement,
  action: () => void | Promise<void>
): Promise<void> {
  if (hasDirtyForm(root) && !(await confirmDiscard(app))) return;
  await action();
}

// ── Guarded modal ────────────────────────────────────────────

/**
 * A Modal that refuses to vanish while an editor inside it has unsaved work.
 *
 * Obsidian routes both the background click and the Escape key through
 * `close()`, so overriding it covers every accidental-dismissal path.
 */
export abstract class GuardedModal extends Modal {
  private bypassGuard = false;
  private askingToDiscard = false;

  /** Report whether closing right now would lose the user's work. */
  protected abstract hasUnsavedWork(): boolean;

  close(): void {
    if (this.bypassGuard || !this.hasUnsavedWork()) {
      super.close();
      return;
    }
    // A prompt is already up — ignore further dismissal attempts behind it.
    if (this.askingToDiscard) return;
    this.askingToDiscard = true;
    void confirmDiscard(this.app).then((discard) => {
      this.askingToDiscard = false;
      if (discard) this.closeWithoutGuard();
    });
  }

  /** Close unconditionally. Use after a successful save, or for an explicit Cancel. */
  protected closeWithoutGuard(): void {
    this.bypassGuard = true;
    this.close();
  }
}

// ── Native Obsidian toggles ──────────────────────────────────

/**
 * A labelled row carrying a real Obsidian toggle, so the control inherits the
 * user's theme instead of rendering as a bare browser checkbox.
 */
export function createToggleRow(
  parent: HTMLElement,
  opts: { label: string; value: boolean; hint?: string; onChange?: (value: boolean) => void }
): { rowEl: HTMLElement; toggle: ToggleComponent } {
  const rowEl = parent.createDiv('vital-log-form-row vital-log-form-row--toggle');
  rowEl.createEl('label', { text: opts.label });
  const toggle = new ToggleComponent(rowEl).setValue(opts.value);
  if (opts.onChange) toggle.onChange(opts.onChange);
  if (opts.hint) rowEl.createEl('span', { cls: 'vital-log-form-hint', text: opts.hint });
  return { rowEl, toggle };
}

/**
 * The "Also add to note content" control shared by the log modals: a full-width
 * clickable row with the label on the left and a native toggle on the right.
 */
export function createAppendToggle(
  parent: HTMLElement,
  opts: { label: string; value: boolean; onChange: (value: boolean) => void }
): ToggleComponent {
  const rowEl = parent.createDiv('vital-log-append-row');
  rowEl.createSpan({ cls: 'vital-log-append-label', text: opts.label });
  const toggle = new ToggleComponent(rowEl).setValue(opts.value).onChange(opts.onChange);
  // The whole row is a hit target — much easier than a 16px checkbox on mobile.
  rowEl.addEventListener('click', (e) => {
    if (rowEl.querySelector('.checkbox-container')?.contains(e.target as Node)) return;
    toggle.setValue(!toggle.getValue());
    opts.onChange(toggle.getValue());
  });
  return toggle;
}

// ── Inline field errors ──────────────────────────────────────

export interface FieldError {
  /** Show `message` under the row and outline the offending control. */
  show(message: string): void;
  /** Hide the message and clear the outline. */
  clear(): void;
}

/**
 * Attach an error slot directly beneath `rowEl`. Errors belong next to the
 * field they describe — a corner toast is too easy to miss, and a silent
 * no-op is worse still.
 */
export function attachFieldError(rowEl: HTMLElement, control?: HTMLElement): FieldError {
  const errorEl = createDiv({ cls: 'vital-log-error' });
  errorEl.style.display = 'none';
  rowEl.insertAdjacentElement('afterend', errorEl);

  const target = control ?? rowEl.querySelector('input, select, textarea');

  return {
    show(message: string): void {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
      target?.addClass('vital-log-input-invalid');
    },
    clear(): void {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      target?.removeClass('vital-log-input-invalid');
    },
  };
}

/**
 * Validate on save: shows `message` and focuses the field when it's empty.
 * Returns true when the field has a value.
 */
export function requireValue(
  input: HTMLInputElement | HTMLSelectElement,
  error: FieldError,
  message: string
): boolean {
  if (input.value.trim()) {
    error.clear();
    return true;
  }
  error.show(message);
  input.focus();
  return false;
}

// ── Inline form ergonomics ───────────────────────────────────

/**
 * Wire up the behaviour every inline form should have had from the start:
 * dirty tracking, focus on the first field, Enter to save, Escape to cancel.
 *
 * Escape is stopped at the form so it cancels the form rather than closing the
 * surrounding modal, and Enter is ignored inside a textarea where it means
 * "new line".
 */
export function initInlineForm(
  formEl: HTMLElement,
  opts: { onSave: () => void; onCancel: () => void; autoFocus?: boolean }
): void {
  trackFormDirty(formEl);

  formEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onCancel();
      return;
    }
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement) return;
    // Let the datalist dropdown claim Enter for its own selection.
    if (target instanceof HTMLInputElement && target.hasAttribute('list')) return;
    e.preventDefault();
    opts.onSave();
  });

  if (opts.autoFocus === false) return;
  // A form appended below a long list is otherwise offscreen.
  formEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const first = formEl.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea');
  first?.focus();
}
