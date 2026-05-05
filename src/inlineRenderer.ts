// ============================================================
// Vital Log — Inline Widget Renderer
// Processes inline code elements:
//   `tally: Name`   → interactive tally counter (linked to settings)
//   `counter: Name` → free-form per-note counter (value lives on the same line)
// ============================================================

import { App, TFile, setIcon } from 'obsidian';
import type VitalLogPlugin from '../main';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function registerInlineRenderers(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const codeEls = Array.from(el.querySelectorAll('code'));
    for (const code of codeEls) {
      const text = code.textContent?.trim() ?? '';
      if (text.startsWith('tally: ')) {
        const name = text.slice('tally: '.length).trim();
        void renderInlineTally(plugin, code as HTMLElement, name);
      } else if (text.startsWith('counter: ')) {
        const name = text.slice('counter: '.length).trim();
        void renderInlineCounter(plugin.app, code as HTMLElement, name, ctx.sourcePath);
      }
    }
  });
}

async function renderInlineTally(
  plugin: VitalLogPlugin,
  code: HTMLElement,
  name: string,
): Promise<void> {
  const { app, settings } = plugin;
  const config = settings.tallyCounters.find(
    (t) => t.displayName.toLowerCase() === name.toLowerCase(),
  );
  if (!config) {
    code.textContent = `[tally: "${name}" not found]`;
    code.addClass('vital-log-inline-error');
    return;
  }

  const targetNote = getDailyNoteIfExists(app, settings);
  const fm = targetNote ? await yaml.readAllFrontmatter(app, targetNote) : {};
  const raw = fm[config.propertyKey];
  const initialValue =
    typeof raw === 'object' && raw !== null && 'value' in raw
      ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
      : 0;

  const widget = document.createElement('span');
  widget.className = 'vital-log-inline-tally';

  if (config.icon) {
    const iconSpan = widget.createSpan({ cls: 'vital-log-inline-icon' });
    setIcon(iconSpan, config.icon);
  }
  widget.createSpan({ cls: 'vital-log-inline-name', text: config.displayName });

  let value = initialValue;
  const valueSpan = widget.createSpan({ cls: 'vital-log-inline-value' });

  const refresh = () => {
    valueSpan.textContent = `${value}/${config.target}`;
    widget.toggleClass('is-complete', value >= config.target);
  };
  refresh();

  const decBtn = widget.createEl('button', {
    text: '−',
    cls: 'vital-log-inline-btn vital-log-inline-btn--dec',
    attr: { 'aria-label': `Decrease ${config.displayName}` },
  });
  const incBtn = widget.createEl('button', {
    text: '+',
    cls: 'vital-log-inline-btn vital-log-inline-btn--inc',
    attr: { 'aria-label': `Increase ${config.displayName}` },
  });

  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta * config.step);
    refresh();
    if (targetNote) {
      await tally.updateTallyValue(app, targetNote, config, value);
    }
  };

  decBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(-1); });
  incBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(1); });

  code.replaceWith(widget);
}

async function renderInlineCounter(
  app: App,
  code: HTMLElement,
  name: string,
  sourcePath: string,
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(sourcePath);
  const targetNote = file instanceof TFile ? file : null;

  // Read initial value from the number sitting before `counter: name` on the same line
  let value = 0;
  if (targetNote) {
    const content = await app.vault.read(targetNote);
    const escapedName = escapeRegex(name);
    const lineRegex = new RegExp('`counter:\\s*' + escapedName + '`');
    for (const line of content.split('\n')) {
      if (lineRegex.test(line)) {
        const counterPos = line.search(lineRegex);
        const beforeCounter = line.slice(0, counterPos);
        const numMatch = beforeCounter.match(/(\d+)\s*$/);
        if (numMatch) value = parseInt(numMatch[1], 10);
        break;
      }
    }
  }

  const widget = document.createElement('span');
  widget.className = 'vital-log-inline-counter';

  widget.createSpan({ cls: 'vital-log-inline-name', text: name });

  const valueSpan = widget.createSpan({ cls: 'vital-log-inline-value' });
  const refresh = () => { valueSpan.textContent = String(value); };
  refresh();

  const decBtn = widget.createEl('button', {
    text: '−',
    cls: 'vital-log-inline-btn vital-log-inline-btn--dec',
    attr: { 'aria-label': `Decrease ${name}` },
  });
  const incBtn = widget.createEl('button', {
    text: '+',
    cls: 'vital-log-inline-btn vital-log-inline-btn--inc',
    attr: { 'aria-label': `Increase ${name}` },
  });

  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta);
    refresh();
    if (targetNote) {
      await writeCounterToLine(app, targetNote, name, value);
    }
  };

  decBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(-1); });
  incBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(1); });

  code.replaceWith(widget);
}

// Write newValue into the note line that contains `counter: name`.
// Replaces the number immediately before the counter tag; inserts one if absent.
async function writeCounterToLine(
  app: App,
  file: TFile,
  name: string,
  newValue: number,
): Promise<void> {
  const escapedName = escapeRegex(name);
  await app.vault.process(file, (content) => {
    // Replace existing number immediately before the counter tag (with optional whitespace)
    const replaceRegex = new RegExp('(\\d+)(\\s*`counter:\\s*' + escapedName + '`)', 'g');
    const replaced = content.replace(replaceRegex, (_, _num, suffix) => `${newValue}${suffix}`);
    if (replaced !== content) return replaced;
    // No number found on the line yet — insert one before the counter tag
    const insertRegex = new RegExp('(`counter:\\s*' + escapedName + '`)', 'g');
    return content.replace(insertRegex, `${newValue} $1`);
  });
}
