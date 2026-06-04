// ============================================================
// Vital Log — Dashboard modal
// Same navigable single-day dashboard as the pane, in a modal.
// ============================================================

import { App, Modal } from 'obsidian';
import type VitalLogPlugin from '../main';
import { renderDashboard } from './dashboardRenderer';

export class DashboardModal extends Modal {
  private plugin: VitalLogPlugin;

  constructor(app: App, plugin: VitalLogPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.modalEl.addClass('vital-log-modal');
    void renderDashboard(this.plugin, this.contentEl, { navigable: true });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
