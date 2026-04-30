// ============================================================
// Vital Log — Embedded Code Block Renderer
// Registers the `vital-log` fenced code block processor.
// Usage in a note:
//
//   ```vital-log
//   My Modal Name
//   ```
//
// Renders a compact tally widget that reads/writes the daily
// note's frontmatter without opening a modal.
// ============================================================

import { App, setIcon, TFile } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { TallyCounterConfig, VitalLogSettings } from './types';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';
import { CustomLogModal } from './customLogModal';

export function registerEmbedRenderer(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('vital-log', async (source, el) => {
    await renderEmbed(plugin, el, source.trim());
  });
}

async function renderEmbed(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  modalName: string
): Promise<void> {
  container.empty();
  container.addClass('vital-log-embed');

  const { app, settings } = plugin;
  const saveSettings = () => plugin.saveSettings();

  const modalConfig = settings.customModals.find(
    (m) => m.displayName.toLowerCase() === modalName.toLowerCase()
  );

  if (!modalConfig) {
    container.createDiv({
      cls: 'vital-log-embed-error',
      text: `Vital Log: no modal named "${modalName}"`,
    });
    return;
  }

  // ── Tally rows ────────────────────────────────────────────
  const tallyItems = modalConfig.items.filter((item) => item.type === 'tally');

  if (tallyItems.length === 0) {
    container.createDiv({
      cls: 'vital-log-embed-empty',
      text: 'No tallies in this modal.',
    });
    return;
  }

  const dailyNote = getDailyNoteIfExists(app, settings);

  // Read all frontmatter once to avoid serial awaits per tally
  const fm: Record<string, unknown> = dailyNote
    ? await yaml.readAllFrontmatter(app, dailyNote)
    : {};

  const tallyCount = tallyItems.filter((item) => {
    if (item.type !== 'tally') return false;
    return settings.tallyCounters.some((t) => t.id === item.tallyCounterId);
  }).length;

  const talliesCls = tallyCount > 1
    ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
    : 'vital-log-embed-tallies';
  const talliesEl = container.createDiv(talliesCls);

  for (const item of tallyItems) {
    if (item.type !== 'tally') continue;
    const config = settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
    if (!config) continue;

    const raw = fm[config.propertyKey];
    const currentValue =
      typeof raw === 'object' && raw !== null && 'value' in raw
        ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
        : 0;

    renderTallyRow(app, talliesEl, config, currentValue, dailyNote);
  }

  // Open modal button
  const footer = container.createDiv('vital-log-embed-footer');
  const openBtn = footer.createEl('button', {
    cls: 'vital-log-embed-open-btn',
    attr: { 'aria-label': `Open ${modalConfig.displayName}` },
  });
  const iconSpan = openBtn.createSpan({ cls: 'vital-log-embed-open-btn-icon' });
  setIcon(iconSpan, 'maximize-2');
  openBtn.createSpan({ text: 'Open' });
  openBtn.addEventListener('click', () => {
    new CustomLogModal(app, settings, saveSettings, modalConfig).open();
  });
}

function renderTallyRow(
  app: App,
  container: HTMLElement,
  config: TallyCounterConfig,
  initialValue: number,
  dailyNote: TFile | null
): void {
  const row = container.createDiv('vital-log-embed-tally-row');
  if (initialValue >= config.target) row.addClass('is-complete');

  // Label
  const labelEl = row.createDiv('vital-log-embed-tally-label');
  if (config.icon) {
    const iconSpan = labelEl.createSpan({ cls: 'vital-log-embed-tally-icon' });
    setIcon(iconSpan, config.icon);
  }
  labelEl.createSpan({ cls: 'vital-log-embed-tally-name', text: config.displayName });

  // Progress bar + count
  const progressEl = row.createDiv('vital-log-embed-tally-progress');
  const bar = progressEl.createDiv('vital-log-embed-tally-bar');
  const fill = bar.createDiv('vital-log-embed-tally-fill');
  const countEl = progressEl.createDiv({ cls: 'vital-log-embed-tally-count' });

  let value = initialValue;

  const refresh = () => {
    const pct = Math.min(1, value / config.target);
    fill.style.width = `${Math.round(pct * 100)}%`;
    countEl.setText(`${value} / ${config.target}`);
    if (value >= config.target) row.addClass('is-complete');
    else row.removeClass('is-complete');
  };

  refresh();

  // Buttons
  const controls = row.createDiv('vital-log-embed-tally-controls');
  const decBtn = controls.createEl('button', {
    text: '−',
    cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--dec',
    attr: { 'aria-label': `Decrease ${config.displayName}` },
  });
  const incBtn = controls.createEl('button', {
    text: '+',
    cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--inc',
    attr: { 'aria-label': `Increase ${config.displayName}` },
  });

  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta);
    refresh();
    if (dailyNote) {
      try {
        await tally.updateTallyValue(app, dailyNote, config, value);
      } catch (err) {
        console.error('Vital Log embed:', err);
      }
    }
  };

  decBtn.addEventListener('click', () => handleStep(-config.step));
  incBtn.addEventListener('click', () => handleStep(config.step));
}
