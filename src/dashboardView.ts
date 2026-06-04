// ============================================================
// Vital Log — Dashboard pane (ItemView)
// A persistent, navigable single-day dashboard in a workspace leaf.
// ============================================================

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type VitalLogPlugin from '../main';
import { renderDashboard } from './dashboardRenderer';

export const VIEW_TYPE_VITAL_DASHBOARD = 'vital-log-dashboard';

export class DashboardView extends ItemView {
  private plugin: VitalLogPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: VitalLogPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_VITAL_DASHBOARD;
  }

  getDisplayText(): string {
    return 'Vital Log Dashboard';
  }

  getIcon(): string {
    return 'layout-dashboard';
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    await renderDashboard(this.plugin, root, { navigable: true });
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
