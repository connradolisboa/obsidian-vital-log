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
// ============================================================

import { App, setIcon, TFile } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { TallyCounterConfig, CustomField, CustomButtonConfig } from './types';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';
import { CustomLogModal } from './customLogModal';

export function registerEmbedRenderer(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor('vital-log', async (source, el) => {
    const lines = source.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const modalName = lines[0] ?? '';
    const options = new Set(lines.slice(1));
    const invisible = options.has('invisible');
    await renderEmbed(plugin, el, modalName, invisible);
  });
}

async function renderEmbed(
  plugin: VitalLogPlugin,
  container: HTMLElement,
  modalName: string,
  invisible: boolean
): Promise<void> {
  container.empty();
  container.addClass('vital-log-embed');
  if (invisible) container.addClass('vital-log-embed--invisible');

  const { app, settings } = plugin;

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

  const dailyNote = getDailyNoteIfExists(app, settings);
  const fm: Record<string, unknown> = dailyNote
    ? await yaml.readAllFrontmatter(app, dailyNote)
    : {};

  // ── Header (hidden in invisible mode) ─────────────────────
  if (!invisible) {
    const headerEl = container.createDiv('vital-log-embed-header');
    headerEl.createSpan({ cls: 'vital-log-embed-header-title', text: modalConfig.displayName });
    const openBtn = headerEl.createEl('button', {
      cls: 'vital-log-embed-header-btn',
      attr: { 'aria-label': `Open ${modalConfig.displayName}` },
    });
    setIcon(openBtn, 'external-link');
    openBtn.addEventListener('click', () => {
      new CustomLogModal(app, settings, plugin.saveSettings.bind(plugin), modalConfig).open();
    });
  }

  const hasFields = modalConfig.items.some((i) => i.type === 'field');

  if (!hasFields) {
    // Pure-tally/button mode: preserve the 2-column grid layout
    const validItemCount = modalConfig.items.filter((item) => {
      if (item.type === 'tally') return settings.tallyCounters.some((t) => t.id === item.tallyCounterId);
      if (item.type === 'button') return true;
      return false;
    }).length;

    const talliesCls =
      validItemCount > 1
        ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
        : 'vital-log-embed-tallies';
    const talliesEl = container.createDiv(talliesCls);

    for (const item of modalConfig.items) {
      if (item.type === 'tally') {
        const config = settings.tallyCounters.find((t) => t.id === item.tallyCounterId);
        if (!config) continue;
        const raw = fm[config.propertyKey];
        const currentValue =
          typeof raw === 'object' && raw !== null && 'value' in raw
            ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
            : 0;
        renderTallyRow(app, talliesEl, config, currentValue, dailyNote);
      } else if (item.type === 'button') {
        renderButtonRow(app, talliesEl, item.button, 'tally-grid');
      }
    }
  } else {
    // Mixed mode: render items in configured order.
    // Consecutive column-eligible items (tallies, buttons, checkboxes) are grouped
    // into a shared 2-column grid. Regular fields render as full-width rows.
    const itemsEl = container.createDiv('vital-log-embed-items');
    const items = modalConfig.items;
    let i = 0;

    const isColumnEligible = (it: typeof items[number]): boolean =>
      it.type === 'tally' ||
      it.type === 'button' ||
      (it.type === 'field' && it.field.fieldType === 'checkbox');

    while (i < items.length) {
      const item = items[i];

      if (isColumnEligible(item)) {
        // Collect the run of consecutive column-eligible items
        const run: typeof items = [];
        while (i < items.length && isColumnEligible(items[i])) {
          run.push(items[i]);
          i++;
        }

        const validCount = run.filter((it) => {
          if (it.type === 'tally') return settings.tallyCounters.some((c) => c.id === it.tallyCounterId);
          return true;
        }).length;

        const groupCls =
          validCount > 1
            ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
            : 'vital-log-embed-tallies';
        const groupEl = itemsEl.createDiv(groupCls);

        for (const runItem of run) {
          if (runItem.type === 'tally') {
            const config = settings.tallyCounters.find((c) => c.id === runItem.tallyCounterId);
            if (!config) continue;
            const raw = fm[config.propertyKey];
            const currentValue =
              typeof raw === 'object' && raw !== null && 'value' in raw
                ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
                : 0;
            renderTallyRow(app, groupEl, config, currentValue, dailyNote);
          } else if (runItem.type === 'button') {
            renderButtonRow(app, groupEl, runItem.button, 'tally-grid');
          } else if (runItem.type === 'field') {
            renderCheckboxAsGridItem(groupEl, runItem.field, fm[runItem.field.propertyKey], dailyNote, app);
          }
        }
      } else if (item.type === 'field') {
        renderFieldRow(app, itemsEl, item.field, fm[item.field.propertyKey], dailyNote);
        i++;
      } else {
        i++;
      }
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

// ── Tally row ─────────────────────────────────────────────

function renderTallyRow(
  app: App,
  container: HTMLElement,
  config: TallyCounterConfig,
  initialValue: number,
  dailyNote: TFile | null
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

// ── Field row ─────────────────────────────────────────────

function renderFieldRow(
  app: App,
  container: HTMLElement,
  field: CustomField,
  initialValue: unknown,
  dailyNote: TFile | null
): void {
  const row = container.createDiv('vital-log-embed-field-row');
  row.createDiv({ cls: 'vital-log-embed-field-label', text: field.displayName });

  const persist = async (value: unknown) => {
    if (!dailyNote) return;
    try {
      await yaml.setProperties(app, dailyNote, { [field.propertyKey]: value ?? null });
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
  dailyNote: TFile | null,
  app: App
): void {
  const row = container.createDiv('vital-log-embed-tally-row');
  const labelEl = row.createDiv('vital-log-embed-tally-label');
  labelEl.createSpan({ cls: 'vital-log-embed-tally-name', text: field.displayName });
  const checkEl = row.createEl('input', { type: 'checkbox' });
  checkEl.addClass('vital-log-embed-field-checkbox');
  checkEl.checked = initialValue === true;
  checkEl.addEventListener('change', () => {
    if (!dailyNote) return;
    void yaml.setProperties(app, dailyNote, { [field.propertyKey]: checkEl.checked }).catch(
      (err) => console.error('Vital Log embed checkbox grid:', err)
    );
  });
}

function renderCheckboxGroupItem(
  container: HTMLElement,
  field: CustomField,
  initialValue: unknown,
  dailyNote: TFile | null,
  app: App
): void {
  const item = container.createDiv('vital-log-embed-checkbox-item');
  const checkbox = item.createEl('input', { type: 'checkbox' });
  checkbox.addClass('vital-log-embed-field-checkbox');
  checkbox.checked = initialValue === true;
  item.createSpan({ cls: 'vital-log-embed-checkbox-item-label', text: field.displayName });
  checkbox.addEventListener('change', () => {
    if (!dailyNote) return;
    void yaml.setProperties(app, dailyNote, { [field.propertyKey]: checkbox.checked }).catch(
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
