// ============================================================
// Vital Log — Embedded Code Block Renderer
// Registers the `vital-log` fenced code block processor.
// Usage in a note:
//
//   ```vital-log
//   My Modal Name
//   ```
//
// Renders a compact widget that reads/writes the daily note's
// frontmatter without opening a modal.
// ============================================================

import { App, setIcon, TFile } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { TallyCounterConfig, CustomField } from './types';
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

  // ── Header ────────────────────────────────────────────────
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

  const hasFields = modalConfig.items.some((i) => i.type === 'field');

  if (!hasFields) {
    // Pure-tally mode: preserve the 2-column grid layout
    const validTallyCount = modalConfig.items.filter((item) => {
      if (item.type !== 'tally') return false;
      return settings.tallyCounters.some((t) => t.id === item.tallyCounterId);
    }).length;

    const talliesCls =
      validTallyCount > 1
        ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
        : 'vital-log-embed-tallies';
    const talliesEl = container.createDiv(talliesCls);

    for (const item of modalConfig.items) {
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
  } else {
    // Mixed mode: render items in configured order, grouping consecutive tallies
    // into their own 2-column grid so the multi-column layout is preserved.
    const itemsEl = container.createDiv('vital-log-embed-items');
    const items = modalConfig.items;
    let i = 0;

    while (i < items.length) {
      const item = items[i];

      if (item.type === 'tally') {
        // Collect the run of consecutive tally items
        const run: { type: 'tally'; tallyCounterId: string }[] = [];
        while (i < items.length && items[i].type === 'tally') {
          run.push(items[i] as { type: 'tally'; tallyCounterId: string });
          i++;
        }

        const validCount = run.filter(
          (t) => t.type === 'tally' && settings.tallyCounters.some((c) => c.id === t.tallyCounterId)
        ).length;

        const tallyCls =
          validCount > 1
            ? 'vital-log-embed-tallies vital-log-embed-tallies--multi'
            : 'vital-log-embed-tallies';
        const tallyGroupEl = itemsEl.createDiv(tallyCls);

        for (const t of run) {
          if (t.type !== 'tally') continue;
          const config = settings.tallyCounters.find((c) => c.id === t.tallyCounterId);
          if (!config) continue;

          const raw = fm[config.propertyKey];
          const currentValue =
            typeof raw === 'object' && raw !== null && 'value' in raw
              ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
              : 0;

          renderTallyRow(app, tallyGroupEl, config, currentValue, dailyNote);
        }
      } else if (item.type === 'field' && item.field.fieldType === 'checkbox') {
        // Collect the run of consecutive checkbox fields
        const run: CustomField[] = [];
        while (
          i < items.length &&
          items[i].type === 'field' &&
          (items[i] as { type: 'field'; field: CustomField }).field.fieldType === 'checkbox'
        ) {
          run.push((items[i] as { type: 'field'; field: CustomField }).field);
          i++;
        }

        if (run.length === 1) {
          renderFieldRow(app, itemsEl, run[0], fm[run[0].propertyKey], dailyNote);
        } else {
          const groupEl = itemsEl.createDiv('vital-log-embed-checkbox-group');
          for (const field of run) {
            renderCheckboxGroupItem(groupEl, field, fm[field.propertyKey], dailyNote, app);
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
