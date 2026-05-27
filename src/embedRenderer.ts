// ============================================================
// Vital Log — Embedded Code Block Renderer
// Registers the `vital-log` fenced code block processor.
//
// Basic usage:
//   ```vital-log
//   My Modal Name
//   ```
//
// With options (one per line after the modal name):
//   ```vital-log
//   My Modal Name
//   invisible
//   ```
//
// Options:
//   invisible — removes the card background/border/header so the
//               embed blends seamlessly into the note.
//   +         — collapsible, starts expanded (open by default)
//   -         — collapsible, starts collapsed (closed by default)
// ============================================================

import { App, setIcon, TFile } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { TallyCounterConfig, TrackerConfig, CustomField, CustomButtonConfig, CustomModalConfig, CustomModalItem, VitalLogSettings } from './types';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';
import * as tm from './trackerManager';
import { CustomLogModal } from './customLogModal';

function nowHHmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function registerEmbedRenderer(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('vital-log', async (source, el, ctx) => {
    const lines = source.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const modalName = lines[0] ?? '';
    const options = new Set(lines.slice(1));
    const invisible = options.has('invisible');
    const collapsible = options.has('+') || options.has('-');
    const defaultOpen = options.has('+');
    await renderEmbed(plugin, el, modalName, invisible, collapsible, defaultOpen, ctx.sourcePath);
  });
}

// Keeps tallySnapshot/trackerSnapshot current so embeds survive tracker/tally deletion.
// Only writes settings when something actually changed.
async function syncSnapshots(plugin: VitalLogPlugin, modalConfig: import('./types').CustomModalConfig): Promise<void> {
  let dirty = false;
  for (const item of modalConfig.items) {
    if (item.type === 'tally') {
      const live = plugin.settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
      if (live) {
        const s = item.tallySnapshot;
        if (!s || s.displayName !== live.displayName || s.propertyKey !== live.propertyKey ||
            s.target !== live.target || s.step !== live.step || s.icon !== live.icon) {
          item.tallySnapshot = { ...live };
          dirty = true;
        }
      }
    } else if (item.type === 'tracker') {
      const live = (plugin.settings.trackers ?? []).find((t) => t.id === item.trackerId);
      if (live) {
        const s = item.trackerSnapshot;
        if (!s || s.displayName !== live.displayName || s.propertyKey !== live.propertyKey ||
            s.valueName !== live.valueName || s.trackerType !== live.trackerType ||
            s.min !== live.min || s.max !== live.max || s.icon !== live.icon) {
          item.trackerSnapshot = { ...live };
          dirty = true;
        }
      }
    }
  }
  if (dirty) await plugin.saveSettings();
}

async function renderEmbed(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  modalName: string,
  invisible: boolean,
  collapsible = false,
  defaultOpen = true,
  sourcePath?: string,
): Promise<void> {
  container.empty();
  container.addClass('vital-log-embed');
  if (invisible) container.addClass('vital-log-embed--invisible');

  const { app, settings } = plugin;

  // Archived modals still resolve for embeds — that's the point of archiving.
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

  if (modalConfig.items.length === 0) {
    container.createDiv({
      cls: 'vital-log-embed-empty',
      text: 'No items in this modal.',
    });
    return;
  }

  // Keep snapshots fresh so embeds survive tracker/tally deletion.
  await syncSnapshots(plugin, modalConfig);

  // When notePath is empty, target the note this embed lives in (sourcePath).
  // Otherwise fall back to the daily note (legacy behaviour for path-based modals).
  let targetNote: TFile | null;
  if (!modalConfig.notePath.trim() && sourcePath) {
    const f = app.vault.getAbstractFileByPath(sourcePath);
    targetNote = f instanceof TFile ? f : null;
  } else {
    targetNote = getDailyNoteIfExists(app, settings);
  }

  const fm: Record<string, unknown> = targetNote
    ? await yaml.readAllFrontmatter(app, targetNote)
    : {};

  const visibleItems = getMirrorFilteredItems(modalConfig, fm, settings);
  const otherProps = getOtherProps(modalConfig, fm, settings);

  // ── Header (hidden in invisible mode) ─────────────────────
  if (!invisible) {
    const headerEl = container.createDiv('vital-log-embed-header');
    if (collapsible) headerEl.addClass('vital-log-embed-header--collapsible');

    if (collapsible) {
      const chevronBtn = headerEl.createEl('button', {
        cls: 'vital-log-embed-header-btn vital-log-embed-header-chevron',
        attr: { 'aria-label': 'Toggle' },
      });
      setIcon(chevronBtn, 'chevron-down');
      if (!defaultOpen) {
        container.addClass('vital-log-embed--collapsed');
        chevronBtn.addClass('is-collapsed');
      }
      const toggle = () => {
        const collapsed = container.hasClass('vital-log-embed--collapsed');
        container.toggleClass('vital-log-embed--collapsed', !collapsed);
        chevronBtn.toggleClass('is-collapsed', !collapsed);
      };
      headerEl.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.vital-log-embed-header-btn:not(.vital-log-embed-header-chevron)')) return;
        toggle();
      });
    }

    headerEl.createSpan({ cls: 'vital-log-embed-header-title', text: modalConfig.displayName });
    const openBtn = headerEl.createEl('button', {
      cls: 'vital-log-embed-header-btn',
      attr: { 'aria-label': `Open ${modalConfig.displayName}` },
    });
    setIcon(openBtn, 'external-link');
    openBtn.addEventListener('click', () => {
      new CustomLogModal(app, settings, plugin.saveSettings.bind(plugin), modalConfig, undefined, sourcePath).open();
    });
  }

  const bodyEl = container.createDiv('vital-log-embed-body');

  if (visibleItems.length === 0 && modalConfig.mirrorMode && otherProps.length === 0) {
    bodyEl.createDiv({ cls: 'vital-log-embed-empty', text: 'No matching properties in this note.' });
    return;
  }

  const hasStructure = visibleItems.some(
    (i) => i.type === 'field' || i.type === 'header' || i.type === 'divider' || i.type === 'section' || i.type === 'section-end'
  );

  if (visibleItems.length > 0) {
    if (!hasStructure) {
      // Pure-tally/button mode: preserve the 2-column grid layout
      const validItemCount = visibleItems.filter((item) => {
        if (item.type === 'tally') return !!(settings.tallyCounters.some((t) => t.id === item.tallyCounterId) || item.tallySnapshot);
        if (item.type === 'tracker') return !!((settings.trackers ?? []).some((t) => t.id === item.trackerId) || item.trackerSnapshot);
        if (item.type === 'button') return true;
        return false;
      }).length;

      const talliesCls =
        validItemCount > 1
          ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
          : 'vital-log-embed-tallies';
      const talliesEl = bodyEl.createDiv(talliesCls);

      for (const item of visibleItems) {
        if (item.type === 'tally') {
          const config = settings.tallyCounters.find((t) => t.id === item.tallyCounterId) ?? item.tallySnapshot;
          if (!config) continue;
          const raw = fm[config.propertyKey];
          const currentValue =
            typeof raw === 'object' && raw !== null && 'value' in raw
              ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
              : 0;
          renderTallyRow(app, talliesEl, config, currentValue, targetNote);
        } else if (item.type === 'tracker') {
          const config = (settings.trackers ?? []).find((t) => t.id === item.trackerId) ?? item.trackerSnapshot;
          if (!config) continue;
          renderTrackerColumnItem(app, talliesEl, config, fm, targetNote);
        } else if (item.type === 'button') {
          renderButtonRow(app, talliesEl, item.button, 'tally-grid');
        }
      }
    } else {
      // Mixed mode: render items in configured order.
      const itemsEl = bodyEl.createDiv('vital-log-embed-items');
      renderMixedItems(app, itemsEl, visibleItems, settings, fm, targetNote);
    }
  }

  // Other Properties: note frontmatter keys not covered by the modal
  if (otherProps.length > 0) {
    renderEmbedOtherPropsSection(app, bodyEl, otherProps, targetNote);
  }
}

// ── Mirror mode filter (mirrors CustomLogModal.computeVisibleItems) ──

function getMirrorFilteredItems(
  modalConfig: CustomModalConfig,
  fm: Record<string, unknown>,
  settings: VitalLogSettings,
): CustomModalItem[] {
  if (!modalConfig.mirrorMode) return modalConfig.items;

  const pinnedIds = modalConfig.mirrorModePinnedIds ?? [];

  return modalConfig.items.filter((item) => {
    if (item.type === 'field') {
      const val = fm[item.field.propertyKey];
      return (val !== undefined && val !== null) || pinnedIds.includes(item.field.id);
    }
    if (item.type === 'tally') {
      const tallyConfig = settings.tallyCounters.find((t) => t.id === item.tallyCounterId) ?? item.tallySnapshot;
      if (!tallyConfig) return false;
      const val = fm[tallyConfig.propertyKey];
      return (val !== undefined && val !== null) || pinnedIds.includes(item.tallyCounterId);
    }
    if (item.type === 'tracker') {
      const trackerConfig = (settings.trackers ?? []).find((t) => t.id === item.trackerId) ?? item.trackerSnapshot;
      if (!trackerConfig) return false;
      const val = fm[trackerConfig.propertyKey];
      return (val !== undefined && val !== null) || pinnedIds.includes(item.trackerId);
    }
    if (item.type === 'button') return true;
    return false;
  });
}

// ── Other props: note frontmatter keys not covered by the modal ──────

function getOtherProps(
  modalConfig: CustomModalConfig,
  fm: Record<string, unknown>,
  settings: VitalLogSettings,
): Array<{key: string; value: unknown}> {
  if (!modalConfig.mirrorMode || !modalConfig.showOtherProperties) return [];

  const excludedKeys = new Set(settings.mirrorExcludedKeys ?? []);
  const coveredKeys = new Set<string>();
  for (const item of modalConfig.items) {
    if (item.type === 'field') {
      coveredKeys.add((item.field as any).parentKey ?? item.field.propertyKey);
    } else if (item.type === 'tally') {
      const tc = settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
      if (tc) coveredKeys.add(tc.propertyKey);
    } else if (item.type === 'tracker') {
      const tc = (settings.trackers ?? []).find((t) => t.id === item.trackerId);
      if (tc) coveredKeys.add(tc.propertyKey);
    }
  }

  return Object.entries(fm)
    .filter(([key]) => !coveredKeys.has(key) && !excludedKeys.has(key))
    .map(([key, value]) => ({ key, value }));
}

function renderEmbedOtherPropsSection(
  app: App,
  container: HTMLElement,
  props: Array<{key: string; value: unknown}>,
  targetNote: TFile | null,
): void {
  const sectionEl = container.createDiv('vital-log-embed-section-group');
  sectionEl.addClass('vital-log-embed-section--collapsed');
  const sectionHeader = sectionEl.createDiv('vital-log-embed-section-header');
  const chevronSpan = sectionHeader.createSpan({ cls: 'vital-log-embed-section-chevron' });
  chevronSpan.addClass('is-collapsed');
  setIcon(chevronSpan, 'chevron-down');
  sectionHeader.createSpan({ cls: 'vital-log-embed-section-title', text: 'Other Properties' });
  const sectionBody = sectionEl.createDiv('vital-log-embed-section-body');

  sectionHeader.addEventListener('click', () => {
    const collapsed = sectionEl.hasClass('vital-log-embed-section--collapsed');
    sectionEl.toggleClass('vital-log-embed-section--collapsed', !collapsed);
    chevronSpan.toggleClass('is-collapsed', !collapsed);
  });

  for (const prop of props) {
    const row = sectionBody.createDiv('vital-log-embed-field-row');
    row.createDiv({ cls: 'vital-log-embed-field-label', text: prop.key });

    const persist = async (value: unknown) => {
      if (!targetNote) return;
      try {
        await import('./yamlManager').then((y) =>
          y.setProperties(app, targetNote, { [prop.key]: value ?? null })
        );
      } catch (err) {
        console.error('Vital Log embed other-prop:', err);
      }
    };

    const value = prop.value;
    if (value === null || value === undefined) {
      const input = row.createEl('input', { type: 'text', value: '' });
      input.addClass('vital-log-embed-field-input');
      input.addEventListener('blur', () => void persist(input.value || null));
    } else if (typeof value === 'boolean') {
      const wrapper = row.createDiv('vital-log-embed-field-checkbox-row');
      const cb = wrapper.createEl('input', { type: 'checkbox' });
      cb.addClass('vital-log-embed-field-checkbox');
      cb.checked = value;
      cb.addEventListener('change', () => void persist(cb.checked));
    } else if (typeof value === 'number') {
      const input = row.createEl('input', { type: 'number', value: String(value) });
      input.addClass('vital-log-embed-field-input');
      input.addEventListener('blur', () =>
        void persist(input.value !== '' ? parseFloat(input.value) : null)
      );
    } else if (Array.isArray(value)) {
      const input = row.createEl('input', {
        type: 'text',
        value: value.map((v) => String(v)).join(', '),
      });
      input.addClass('vital-log-embed-field-input');
      input.readOnly = true;
      input.title = 'Array values are read-only';
    } else if (typeof value === 'object') {
      const input = row.createEl('input', { type: 'text', value: JSON.stringify(value) });
      input.addClass('vital-log-embed-field-input');
      input.readOnly = true;
      input.title = 'Object values are read-only';
    } else {
      const input = row.createEl('input', {
        type: 'text',
        value: value !== null && value !== undefined ? String(value) : '',
      });
      input.addClass('vital-log-embed-field-input');
      input.addEventListener('blur', () => void persist(input.value || null));
    }
  }
}

// ── Mixed-mode item renderer (supports sections, headers, dividers) ──

type EmbedSettings = { tallyCounters: TallyCounterConfig[]; trackers: TrackerConfig[] };

function renderMixedItems(
  app: App,
  container: HTMLElement,
  items: CustomModalItem[],
  settings: EmbedSettings,
  fm: Record<string, unknown>,
  targetNote: TFile | null
): void {
  let i = 0;

  const isColumnEligible = (it: typeof items[number]): boolean =>
    it.type === 'tally' ||
    it.type === 'tracker' ||
    it.type === 'button' ||
    (it.type === 'field' && it.field.fieldType === 'checkbox');

  while (i < items.length) {
    const item = items[i];

    if (item.type === 'section') {
      const sectionEl = container.createDiv('vital-log-embed-section-group');
      const sectionHeader = sectionEl.createDiv('vital-log-embed-section-header');
      const chevronSpan = sectionHeader.createSpan({ cls: 'vital-log-embed-section-chevron' });
      setIcon(chevronSpan, 'chevron-down');
      sectionHeader.createSpan({ cls: 'vital-log-embed-section-title', text: item.title });
      if (item.color) {
        sectionEl.style.setProperty('--vl-section-color', item.color);
        sectionEl.addClass('vital-log-embed-section-group--colored');
      }
      const sectionBody = sectionEl.createDiv('vital-log-embed-section-body');

      if (!item.defaultOpen) {
        sectionEl.addClass('vital-log-embed-section--collapsed');
        chevronSpan.addClass('is-collapsed');
      }

      sectionHeader.addEventListener('click', () => {
        const isCollapsed = sectionEl.hasClass('vital-log-embed-section--collapsed');
        sectionEl.toggleClass('vital-log-embed-section--collapsed', !isCollapsed);
        chevronSpan.toggleClass('is-collapsed', !isCollapsed);
      });

      i++;
      const sectionItems: typeof items = [];
      while (i < items.length && items[i].type !== 'section' && items[i].type !== 'section-end') {
        sectionItems.push(items[i]);
        i++;
      }
      if (i < items.length && items[i].type === 'section-end') i++;
      renderMixedItems(app, sectionBody, sectionItems, settings, fm, targetNote);

    } else if (item.type === 'header') {
      container.createEl('p', { cls: 'vital-log-embed-item-header', text: item.text });
      i++;

    } else if (item.type === 'divider') {
      container.createEl('hr', { cls: 'vital-log-embed-divider' });
      i++;

    } else if (isColumnEligible(item)) {
      const run: typeof items = [];
      while (i < items.length && isColumnEligible(items[i])) {
        run.push(items[i]);
        i++;
      }

      const validCount = run.filter((it) => {
        if (it.type === 'tally') return !!(settings.tallyCounters.some((c) => c.id === it.tallyCounterId) || it.tallySnapshot);
        if (it.type === 'tracker') return !!((settings.trackers ?? []).some((c) => c.id === it.trackerId) || it.trackerSnapshot);
        return true;
      }).length;

      const groupCls =
        validCount > 1
          ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
          : 'vital-log-embed-tallies';
      const groupEl = container.createDiv(groupCls);

      for (const runItem of run) {
        if (runItem.type === 'tally') {
          const config = settings.tallyCounters.find((c) => c.id === runItem.tallyCounterId) ?? runItem.tallySnapshot;
          if (!config) continue;
          const raw = fm[config.propertyKey];
          const currentValue =
            typeof raw === 'object' && raw !== null && 'value' in raw
              ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
              : 0;
          renderTallyRow(app, groupEl, config, currentValue, targetNote);
        } else if (runItem.type === 'tracker') {
          const config = (settings.trackers ?? []).find((c) => c.id === runItem.trackerId) ?? runItem.trackerSnapshot;
          if (!config) continue;
          renderTrackerColumnItem(app, groupEl, config, fm, targetNote);
        } else if (runItem.type === 'button') {
          renderButtonRow(app, groupEl, runItem.button, 'tally-grid');
        } else if (runItem.type === 'field') {
          renderCheckboxAsGridItem(groupEl, runItem.field, fm[runItem.field.propertyKey], targetNote, app);
        }
      }

    } else if (item.type === 'field') {
      renderFieldRow(app, container, item.field, fm[item.field.propertyKey], targetNote);
      i++;

    } else {
      i++;
    }
  }
}

// ── Button row ─────────────────────────────────────────────

function renderButtonRow(
  app: App,
  container: HTMLElement,
  button: CustomButtonConfig,
  context: 'tally-grid' | 'field-row'
): void {
  const handleClick = () => {
    if (button.buttonType === 'filelink') {
      void app.workspace.openLinkText(button.target, '', false);
    } else {
      (app as any).commands.executeCommandById(button.target);
    }
  };

  if (context === 'tally-grid') {
    // Render as a tally-style row so it fits the column grid
    const row = container.createDiv('vital-log-embed-tally-row vital-log-embed-button-grid-item');
    const labelEl = row.createDiv('vital-log-embed-tally-label');
    if (button.icon) {
      const iconSpan = labelEl.createSpan({ cls: 'vital-log-embed-tally-icon' });
      setIcon(iconSpan, button.icon);
    }
    labelEl.createSpan({ cls: 'vital-log-embed-tally-name', text: button.displayName });
    const triggerEl = row.createDiv({ cls: 'vital-log-embed-button-grid-trigger' });
    const icon = button.buttonType === 'filelink' ? 'file-symlink' : 'terminal';
    setIcon(triggerEl, icon);
    row.addEventListener('click', handleClick);
    row.style.cursor = 'pointer';
  } else {
    // Render as a full-width button row
    const row = container.createDiv('vital-log-embed-button-row');
    const btn = row.createEl('button', {
      cls: 'vital-log-embed-action-btn',
      attr: { 'aria-label': button.displayName },
    });
    if (button.icon) {
      const iconSpan = btn.createSpan({ cls: 'vital-log-embed-action-btn-icon' });
      setIcon(iconSpan, button.icon);
    }
    btn.createSpan({ cls: 'vital-log-embed-action-btn-label', text: button.displayName });
    const arrowSpan = btn.createSpan({ cls: 'vital-log-embed-action-btn-arrow' });
    setIcon(arrowSpan, button.buttonType === 'filelink' ? 'file-symlink' : 'terminal');
    btn.addEventListener('click', handleClick);
  }
}

// ── Tracker column item ───────────────────────────────────

function renderTrackerColumnItem(
  app: App,
  container: HTMLElement,
  config: TrackerConfig,
  fm: Record<string, unknown>,
  targetNote: TFile | null
): void {
  // Get last logged value
  let lastValue: number | null = null;
  const entries = fm[config.propertyKey];
  if (Array.isArray(entries) && entries.length > 0) {
    const last = entries[entries.length - 1] as Record<string, unknown>;
    const v = last[config.valueName];
    if (typeof v === 'number') lastValue = v;
  }

  const row = container.createDiv('vital-log-embed-tally-row');

  const labelEl = row.createDiv('vital-log-embed-tally-label');
  if (config.icon) {
    const iconSpan = labelEl.createSpan({ cls: 'vital-log-embed-tally-icon' });
    setIcon(iconSpan, config.icon);
  }
  labelEl.createSpan({ cls: 'vital-log-embed-tally-name', text: config.displayName });

  const isMinutes = config.trackerType === 'minutes';

  if (isMinutes) {
    const controls = row.createDiv('vital-log-embed-tally-controls');
    const input = controls.createEl('input', {
      type: 'number',
      attr: { min: '0', step: '1', placeholder: '0' },
    });
    input.addClass('vital-log-embed-tracker-minutes-input');
    if (lastValue !== null) input.value = String(lastValue);
    const logBtn = controls.createEl('button', {
      text: '✓',
      cls: 'vital-log-embed-tally-btn vital-log-embed-tally-btn--inc',
      attr: { 'aria-label': `Log ${config.displayName}` },
    });
    logBtn.addEventListener('click', async () => {
      const v = parseFloat(input.value);
      if (isNaN(v) || !targetNote) return;
      try {
        await tm.logTracker(app, targetNote, config, { time: nowHHmm(), value: v });
      } catch (err) {
        console.error('Vital Log embed tracker:', err);
      }
    });
  } else {
    // Rating type: compact value buttons
    const controls = row.createDiv('vital-log-embed-tally-controls vital-log-embed-tracker-rating-controls');
    let selected = lastValue;

    const renderBtns = () => {
      controls.empty();
      for (let v = config.min; v <= config.max; v++) {
        const btn = controls.createEl('button', {
          text: String(v),
          cls: 'vital-log-tracker-value-btn vital-log-tracker-value-btn--embed' + (selected === v ? ' is-selected' : ''),
          attr: { 'aria-label': `${config.displayName}: ${v}` },
        });
        btn.addEventListener('click', async () => {
          selected = v;
          renderBtns();
          if (!targetNote) return;
          try {
            await tm.logTracker(app, targetNote, config, { time: nowHHmm(), value: v });
          } catch (err) {
            console.error('Vital Log embed tracker:', err);
          }
        });
      }
    };
    renderBtns();
  }
}

// ── Tally row ─────────────────────────────────────────────

function renderTallyRow(
  app: App,
  container: HTMLElement,
  config: TallyCounterConfig,
  initialValue: number,
  targetNote: TFile | null
): void {
  const row = container.createDiv('vital-log-embed-tally-row');
  if (initialValue >= config.target) row.addClass('is-complete');

  const labelEl = row.createDiv('vital-log-embed-tally-label');
  if (config.icon) {
    const iconSpan = labelEl.createSpan({ cls: 'vital-log-embed-tally-icon' });
    setIcon(iconSpan, config.icon);
  }
  labelEl.createSpan({ cls: 'vital-log-embed-tally-name', text: config.displayName });

  const countEl = row.createDiv({ cls: 'vital-log-embed-tally-count' });

  let value = initialValue;

  const refresh = () => {
    countEl.setText(`${value} / ${config.target}`);
    if (value >= config.target) row.addClass('is-complete');
    else row.removeClass('is-complete');
  };

  refresh();

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
    if (targetNote) {
      try {
        await tally.updateTallyValue(app, targetNote, config, value);
      } catch (err) {
        console.error('Vital Log embed:', err);
      }
    }
  };

  decBtn.addEventListener('click', () => handleStep(-config.step));
  incBtn.addEventListener('click', () => handleStep(config.step));
}

// ── Field row ─────────────────────────────────────────────

function renderFieldRow(
  app: App,
  container: HTMLElement,
  field: CustomField,
  initialValue: unknown,
  targetNote: TFile | null
): void {
  const row = container.createDiv('vital-log-embed-field-row');
  row.createDiv({ cls: 'vital-log-embed-field-label', text: field.displayName });

  const persist = async (value: unknown) => {
    if (!targetNote) return;
    try {
      await yaml.setProperties(app, targetNote, { [field.propertyKey]: value ?? null });
    } catch (err) {
      console.error('Vital Log embed field:', err);
    }
  };

  renderEmbedFieldInput(row, field, initialValue, persist);
}

function renderCheckboxAsGridItem(
  container: HTMLElement,
  field: CustomField,
  initialValue: unknown,
  targetNote: TFile | null,
  app: App
): void {
  const row = container.createDiv('vital-log-embed-tally-row');
  const labelEl = row.createDiv('vital-log-embed-tally-label');
  labelEl.createSpan({ cls: 'vital-log-embed-tally-name', text: field.displayName });
  const checkEl = row.createEl('input', { type: 'checkbox' });
  checkEl.addClass('vital-log-embed-field-checkbox');
  checkEl.checked = initialValue === true;
  checkEl.addEventListener('change', () => {
    if (!targetNote) return;
    void yaml.setProperties(app, targetNote, { [field.propertyKey]: checkEl.checked }).catch(
      (err) => console.error('Vital Log embed checkbox grid:', err)
    );
  });
}

function renderCheckboxGroupItem(
  container: HTMLElement,
  field: CustomField,
  initialValue: unknown,
  targetNote: TFile | null,
  app: App
): void {
  const item = container.createDiv('vital-log-embed-checkbox-item');
  const checkbox = item.createEl('input', { type: 'checkbox' });
  checkbox.addClass('vital-log-embed-field-checkbox');
  checkbox.checked = initialValue === true;
  item.createSpan({ cls: 'vital-log-embed-checkbox-item-label', text: field.displayName });
  checkbox.addEventListener('change', () => {
    if (!targetNote) return;
    void yaml.setProperties(app, targetNote, { [field.propertyKey]: checkbox.checked }).catch(
      (err) => console.error('Vital Log embed checkbox:', err)
    );
  });
}

function renderEmbedFieldInput(
  container: HTMLElement,
  field: CustomField,
  value: unknown,
  persist: (v: unknown) => Promise<void>
): void {
  switch (field.fieldType) {
    case 'slider': {
      const min = field.min ?? 0;
      const max = field.max ?? 10;
      const step = field.step ?? 1;
      const current = typeof value === 'number' ? value : min;
      const sliderRow = container.createDiv('vital-log-embed-field-slider-row');
      const range = sliderRow.createEl('input', {
        type: 'range',
        attr: { min: String(min), max: String(max), step: String(step) },
        value: String(current),
      });
      range.addClass('vital-log-slider-input');
      const display = sliderRow.createDiv({ cls: 'vital-log-slider-value', text: String(current) });
      range.addEventListener('input', () => display.setText(range.value));
      range.addEventListener('change', () => void persist(parseFloat(range.value)));
      break;
    }

    case 'text': {
      const input = container.createEl('input', {
        type: 'text',
        value: typeof value === 'string' ? value : '',
        placeholder: field.description || '',
      });
      input.addClass('vital-log-embed-field-input');
      input.addEventListener('blur', () => void persist(input.value || null));
      break;
    }

    case 'textarea': {
      const textarea = container.createEl('textarea', {
        placeholder: field.description || '',
      });
      textarea.addClass('vital-log-embed-field-input vital-log-embed-field-textarea');
      textarea.value = typeof value === 'string' ? value : '';
      textarea.rows = 2;
      textarea.addEventListener('blur', () => void persist(textarea.value || null));
      break;
    }

    case 'number': {
      const input = container.createEl('input', { type: 'number' });
      input.addClass('vital-log-embed-field-input');
      if (typeof value === 'number') input.value = String(value);
      if (field.min !== undefined) input.setAttribute('min', String(field.min));
      if (field.max !== undefined) input.setAttribute('max', String(field.max));
      if (field.step !== undefined) input.setAttribute('step', String(field.step));
      input.addEventListener('blur', () =>
        void persist(input.value !== '' ? parseFloat(input.value) : null)
      );
      break;
    }

    case 'date': {
      const input = container.createEl('input', {
        type: 'date',
        value: typeof value === 'string' ? value : '',
      });
      input.addClass('vital-log-embed-field-input');
      input.addEventListener('change', () => void persist(input.value || null));
      break;
    }

    case 'time': {
      const input = container.createEl('input', {
        type: 'time',
        value: typeof value === 'string' ? value : '',
      });
      input.addClass('vital-log-embed-field-input');
      input.addEventListener('change', () => void persist(input.value || null));
      break;
    }

    case 'checkbox': {
      const wrapper = container.createDiv('vital-log-embed-field-checkbox-row');
      const checkbox = wrapper.createEl('input', { type: 'checkbox' });
      checkbox.addClass('vital-log-embed-field-checkbox');
      checkbox.checked = value === true;
      checkbox.addEventListener('change', () => void persist(checkbox.checked));
      break;
    }

    case 'dropdown': {
      const select = container.createEl('select');
      select.addClass('vital-log-embed-field-input');
      select.createEl('option', { value: '', text: '— Select —' });
      const currentStr = typeof value === 'string' ? value : null;
      if (currentStr && !(field.options ?? []).includes(currentStr)) {
        select.createEl('option', { value: currentStr, text: currentStr }).selected = true;
      }
      for (const opt of field.options ?? []) {
        const optEl = select.createEl('option', { value: opt, text: opt });
        if (value === opt) optEl.selected = true;
      }
      select.addEventListener('change', () => void persist(select.value || null));
      break;
    }

    case 'rating': {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      const count = max - min + 1;
      let selected = typeof value === 'number' ? value : null;

      const grid = container.createDiv('vital-log-embed-field-rating');

      const renderButtons = (current: number | null) => {
        grid.empty();
        for (let v = min; v <= max; v++) {
          const btn = grid.createEl('button', {
            text: String(v),
            cls: 'vital-log-tracker-value-btn' + (current === v ? ' is-selected' : ''),
          });
          if (count <= 5) btn.addClass('vital-log-tracker-value-btn--large');
          else if (count <= 10) btn.addClass('vital-log-tracker-value-btn--medium');
          btn.addEventListener('click', () => {
            selected = v;
            void persist(v);
            renderButtons(v);
          });
        }
      };

      renderButtons(selected);
      break;
    }

    case 'tags': {
      const tags: string[] = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string')
        : [];

      const wrapper = container.createDiv('vital-log-tags-wrapper');

      const renderTags = () => {
        wrapper.empty();
        const chipRow = wrapper.createDiv('vital-log-tags-chips');
        for (let i = 0; i < tags.length; i++) {
          const chip = chipRow.createDiv({ cls: 'vital-log-tag-chip' });
          chip.createSpan({ text: tags[i] });
          const removeBtn = chip.createEl('button', { cls: 'vital-log-tag-remove', text: '×' });
          removeBtn.addEventListener('click', () => {
            tags.splice(i, 1);
            void persist(tags.length > 0 ? [...tags] : null);
            renderTags();
          });
        }
        const inputRow = wrapper.createDiv('vital-log-tags-input-row');
        const input = inputRow.createEl('input', {
          type: 'text',
          placeholder: 'Add tag…',
        });
        input.addClass('vital-log-custom-input');
        const addTag = () => {
          const val = input.value.trim();
          if (val && !tags.includes(val)) {
            tags.push(val);
            void persist([...tags]);
            input.value = '';
            renderTags();
          }
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); addTag(); }
        });
        inputRow.createEl('button', { text: '+', cls: 'vital-log-btn vital-log-embed-tag-add-btn' })
          .addEventListener('click', addTag);
      };

      renderTags();
      break;
    }
  }
}
