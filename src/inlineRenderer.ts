// ============================================================
// Vital Log — Inline Widget Renderer
//
// Two render paths share the same widget builders:
//   1. Reading View — markdown post-processor swaps inline <code>
//   2. Live Preview — CodeMirror 6 ViewPlugin + replace decorations
//
// Patterns:
//   `tally: Name`   → interactive tally counter (linked to settings)
//   `counter: Name` → free-form per-note counter (value lives on the same line)
// ============================================================

import { App, TFile, editorLivePreviewField, setIcon } from 'obsidian';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type VitalLogPlugin from '../main';
import { getDailyNoteIfExists } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';

const INLINE_RE = /`(tally|counter):\s+([^`\n]+?)`/g;
const INLINE_TEXT_RE = /^(tally|counter):\s+(.+)$/;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Reading View post-processor ───────────────────────

export function registerInlineRenderers(plugin: VitalLogPlugin): void {
  plugin.registerMarkdownPostProcessor((el, ctx) => {
    const codeEls = Array.from(el.querySelectorAll('code'));
    for (const code of codeEls) {
      const text = code.textContent?.trim() ?? '';
      const m = INLINE_TEXT_RE.exec(text);
      if (!m) continue;
      const [, kind, rawName] = m;
      const name = rawName.trim();
      const sourcePath = ctx.sourcePath;
      const getFile = () => {
        const f = plugin.app.vault.getAbstractFileByPath(sourcePath);
        return f instanceof TFile ? f : null;
      };
      if (kind === 'tally') {
        code.replaceWith(buildTallyWidget(plugin, name, getFile));
      } else {
        code.replaceWith(buildCounterWidget(plugin.app, name, getFile));
      }
    }
  });
}

// ─── Widget builders (shared) ──────────────────────────

function attachWidgetGuards(widget: HTMLElement): void {
  // Stop the editor from grabbing the click (which would move the cursor
  // into the underlying source range and dissolve the widget).
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  widget.addEventListener('mousedown', stop);
  widget.addEventListener('pointerdown', stop);
}

function buildTallyWidget(
  plugin: VitalLogPlugin,
  name: string,
  getFile: () => TFile | null,
): HTMLElement {
  const { app, settings } = plugin;
  const config = settings.tallyCounters.find(
    (t) => t.displayName.toLowerCase() === name.toLowerCase(),
  );
  if (!config) {
    return buildAdHocTally(app, name, getFile);
  }

  const widget = document.createElement('span');
  widget.className = 'vital-log-inline-tally';
  attachWidgetGuards(widget);

  const decBtn = widget.createEl('button', {
    text: '−',
    cls: 'vital-log-inline-btn vital-log-inline-btn--dec',
    attr: { 'aria-label': `Decrease ${config.displayName}`, type: 'button' },
  });

  if (config.icon) {
    const iconSpan = widget.createSpan({ cls: 'vital-log-inline-icon' });
    setIcon(iconSpan, config.icon);
  }
  widget.createSpan({ cls: 'vital-log-inline-name', text: config.displayName });

  let value = 0;
  const valueSpan = widget.createSpan({ cls: 'vital-log-inline-value' });
  const refresh = () => {
    valueSpan.textContent = `${value}/${config.target}`;
    widget.toggleClass('is-complete', value >= config.target);
  };
  refresh();

  const incBtn = widget.createEl('button', {
    text: '+',
    cls: 'vital-log-inline-btn vital-log-inline-btn--inc',
    attr: { 'aria-label': `Increase ${config.displayName}`, type: 'button' },
  });

  const targetNote = getDailyNoteIfExists(app, settings);
  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta * config.step);
    refresh();
    if (targetNote) {
      await tally.updateTallyValue(app, targetNote, config, value);
    }
  };
  decBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(-1); });
  incBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(1); });

  // Async load of the current value
  void (async () => {
    const fm = targetNote ? await yaml.readAllFrontmatter(app, targetNote) : {};
    const raw = fm[config.propertyKey];
    value =
      typeof raw === 'object' && raw !== null && 'value' in raw
        ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
        : 0;
    refresh();
  })();

  return widget;
}

// Ad-hoc tally: when `tally: Name` doesn't match a registered counter,
// the widget reads/writes a numeric frontmatter property on the
// current note (the file the widget is rendered in).
function buildAdHocTally(
  app: App,
  name: string,
  getFile: () => TFile | null,
): HTMLElement {
  const widget = document.createElement('span');
  widget.className = 'vital-log-inline-tally vital-log-inline-tally--adhoc';
  attachWidgetGuards(widget);

  const decBtn = widget.createEl('button', {
    text: '−',
    cls: 'vital-log-inline-btn vital-log-inline-btn--dec',
    attr: { 'aria-label': `Decrease ${name}`, type: 'button' },
  });
  widget.createSpan({ cls: 'vital-log-inline-name', text: name });

  let value = 0;
  const valueSpan = widget.createSpan({ cls: 'vital-log-inline-value' });
  const refresh = () => { valueSpan.textContent = String(value); };
  refresh();

  const incBtn = widget.createEl('button', {
    text: '+',
    cls: 'vital-log-inline-btn vital-log-inline-btn--inc',
    attr: { 'aria-label': `Increase ${name}`, type: 'button' },
  });

  const propKey = name.trim();

  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta);
    refresh();
    const file = getFile();
    if (file) {
      await app.fileManager.processFrontMatter(file, (fm) => {
        fm[propKey] = value;
      });
    }
  };
  decBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(-1); });
  incBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(1); });

  // Async load of the current value
  void (async () => {
    const file = getFile();
    if (!file) return;
    const fm = await yaml.readAllFrontmatter(app, file);
    const raw = fm[propKey];
    value = typeof raw === 'number' ? raw : 0;
    refresh();
  })();

  return widget;
}

function buildCounterWidget(
  app: App,
  name: string,
  getFile: () => TFile | null,
): HTMLElement {
  let value = 0;

  const widget = document.createElement('span');
  widget.className = 'vital-log-inline-counter';
  attachWidgetGuards(widget);

  const decBtn = widget.createEl('button', {
    text: '−',
    cls: 'vital-log-inline-btn vital-log-inline-btn--dec',
    attr: { 'aria-label': `Decrease ${name}`, type: 'button' },
  });
  widget.createSpan({ cls: 'vital-log-inline-name', text: name });

  const valueSpan = widget.createSpan({ cls: 'vital-log-inline-value' });
  const refresh = () => { valueSpan.textContent = String(value); };
  refresh();

  const incBtn = widget.createEl('button', {
    text: '+',
    cls: 'vital-log-inline-btn vital-log-inline-btn--inc',
    attr: { 'aria-label': `Increase ${name}`, type: 'button' },
  });

  const handleStep = async (delta: number) => {
    value = Math.max(0, value + delta);
    refresh();
    const file = getFile();
    if (file) {
      await writeCounterToLine(app, file, name, value);
    }
  };
  decBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(-1); });
  incBtn.addEventListener('click', (e) => { e.preventDefault(); void handleStep(1); });

  // Load the initial value from the surrounding line
  const file = getFile();
  if (file) {
    void app.vault.read(file).then((content) => {
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
      refresh();
    });
  }

  return widget;
}

// Replaces the number immediately before the counter tag; inserts one if absent.
async function writeCounterToLine(
  app: App,
  file: TFile,
  name: string,
  newValue: number,
): Promise<void> {
  const escapedName = escapeRegex(name);
  await app.vault.process(file, (content) => {
    const replaceRegex = new RegExp('(\\d+)(\\s*`counter:\\s*' + escapedName + '`)', 'g');
    const replaced = content.replace(replaceRegex, (_, _num, suffix) => `${newValue}${suffix}`);
    if (replaced !== content) return replaced;
    const insertRegex = new RegExp('(`counter:\\s*' + escapedName + '`)', 'g');
    return content.replace(insertRegex, `${newValue} $1`);
  });
}

// ─── Live Preview (CodeMirror 6) ───────────────────────

class InlineWidget extends WidgetType {
  constructor(
    private kind: 'tally' | 'counter',
    private name: string,
    private plugin: VitalLogPlugin,
    private getFile: () => TFile | null,
  ) {
    super();
  }

  eq(other: InlineWidget): boolean {
    return other.kind === this.kind && other.name === this.name;
  }

  toDOM(): HTMLElement {
    if (this.kind === 'tally') {
      return buildTallyWidget(this.plugin, this.name, this.getFile);
    }
    return buildCounterWidget(this.plugin.app, this.name, this.getFile);
  }

  // Tell the editor to leave events on this widget alone — our own
  // handlers manage clicks. (true = editor ignores, widget handles.)
  ignoreEvent(): boolean {
    return true;
  }
}

export function buildInlineEditorExtension(plugin: VitalLogPlugin) {
  const fileForView = (view: EditorView): TFile | null => {
    let result: TFile | null = null;
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view as { editor?: { cm?: EditorView }; file?: TFile };
      if (v?.editor?.cm === view) result = v.file ?? null;
    });
    return result;
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        // Only render in Live Preview, not Source mode
        try {
          if (!view.state.field(editorLivePreviewField)) {
            return Decoration.none;
          }
        } catch {
          // Field unavailable — fall through and render
        }

        const widgets: Range<Decoration>[] = [];
        const sel = view.state.selection.main;
        // Strict overlap: cursor at the boundary still shows the widget.
        const cursorInside = (from: number, to: number) =>
          sel.from < to && sel.to > from;

        for (const { from, to } of view.visibleRanges) {
          const text = view.state.doc.sliceString(from, to);
          INLINE_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = INLINE_RE.exec(text)) !== null) {
            const matchFrom = from + m.index;
            const matchTo = matchFrom + m[0].length;

            if (cursorInside(matchFrom, matchTo)) continue;
            if (isInsideCodeBlock(view, matchFrom)) continue;

            const kind = m[1] as 'tally' | 'counter';
            const name = m[2].trim();
            const widget = new InlineWidget(kind, name, plugin, () => fileForView(view));
            widgets.push(
              Decoration.replace({ widget, inclusive: false }).range(matchFrom, matchTo),
            );
          }
        }

        return Decoration.set(widgets, true);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function isInsideCodeBlock(view: EditorView, pos: number): boolean {
  let inside = false;
  syntaxTree(view.state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      const n = node.type.name.toLowerCase();
      if (
        n.includes('codeblock') ||
        n.includes('code-block') ||
        n.includes('fencedcode') ||
        n === 'hmd-codeblock'
      ) {
        inside = true;
        return false;
      }
    },
  });
  return inside;
}
