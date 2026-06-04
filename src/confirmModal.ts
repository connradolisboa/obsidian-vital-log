// ============================================================
// Vital Log — Confirm Modal
// A small reusable yes/no dialog for destructive or lossy actions.
// Use the `confirm()` helper — it resolves true on confirm, false otherwise.
// ============================================================

import { App, Modal } from 'obsidian';

export interface ConfirmOptions {
  title: string;
  /** Body text. Pass an array for multiple paragraphs. */
  message: string | string[];
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmText?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelText?: string;
  /** Style the confirm button as a destructive (warning) action. Defaults to true. */
  destructive?: boolean;
}

class ConfirmModal extends Modal {
  private opts: ConfirmOptions;
  private resolve: (value: boolean) => void;
  private settled = false;

  constructor(app: App, opts: ConfirmOptions, resolve: (value: boolean) => void) {
    super(app);
    this.opts = opts;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('vital-log-modal');
    contentEl.createEl('h3', { text: this.opts.title });

    const paragraphs = Array.isArray(this.opts.message) ? this.opts.message : [this.opts.message];
    for (const text of paragraphs) {
      contentEl.createEl('p', { text });
    }

    const actions = contentEl.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', {
      text: this.opts.cancelText ?? 'Cancel',
      cls: 'vital-log-btn',
    });
    const confirmBtn = actions.createEl('button', {
      text: this.opts.confirmText ?? 'Confirm',
      cls: 'vital-log-btn ' + (this.opts.destructive === false ? 'mod-cta' : 'mod-warning'),
    });

    cancelBtn.addEventListener('click', () => this.settle(false));
    confirmBtn.addEventListener('click', () => this.settle(true));
    confirmBtn.focus();
  }

  private settle(value: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve(value);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
    // If closed via Escape / clicking outside, treat as cancel.
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }
}

/** Open a confirmation dialog. Resolves true if confirmed, false if cancelled/dismissed. */
export function confirm(app: App, opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmModal(app, opts, resolve).open();
  });
}
