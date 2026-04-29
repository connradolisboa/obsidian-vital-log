// ============================================================
// Vital Log — Custom Modal Chooser
// Lists all configured custom modals for quick selection.
// ============================================================

import { App, Modal, setIcon } from 'obsidian';
import type { VitalLogSettings } from './types';
import { CustomLogModal } from './customLogModal';

export class CustomModalChooser extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
  }

  onOpen(): void {
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('vital-log-modal');

    const header = contentEl.createDiv('vital-log-modal-header');
    header.createEl('h2', { text: 'Choose Log Modal' });

    if (this.settings.customModals.length === 0) {
      contentEl.createDiv({
        cls: 'vital-log-no-data',
        text: 'No custom modals configured. Add some in Settings → Vital Log.',
      });
      return;
    }

    const list = contentEl.createDiv('vital-log-chooser-list');
    for (const modal of this.settings.customModals) {
      const btn = list.createEl('button', { cls: 'vital-log-chooser-btn' });

      const iconEl = btn.createDiv({ cls: 'vital-log-chooser-icon' });
      try {
        setIcon(iconEl, modal.icon || 'file-text');
      } catch {
        setIcon(iconEl, 'file-text');
      }

      const info = btn.createDiv({ cls: 'vital-log-chooser-info' });
      info.createDiv({ cls: 'vital-log-chooser-name', text: modal.displayName });
      info.createDiv({
        cls: 'vital-log-chooser-meta',
        text: `${modal.items.length} item${modal.items.length !== 1 ? 's' : ''}`,
      });

      btn.addEventListener('click', () => {
        this.close();
        new CustomLogModal(
          this.app,
          this.settings,
          this.saveSettings,
          modal
        ).open();
      });
    }
  }
}
