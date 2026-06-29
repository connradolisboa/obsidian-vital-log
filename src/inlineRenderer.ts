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

import { App, TFile, editorLivePreviewField } from 'obsidian';
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
import { getDailyNoteIfExists, pathMatchesTemplate } from './dailyNoteResolver';
import * as yaml from './yamlManager';
import * as tally from './tallyManager';
import { buildInlineWidget } from './widgets';
import { scalarMetrics } from './types';

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

// ─── Widget builders ───────────────────────────────────
// All three share the inline span skeleton in widgets.ts; only their
// load/persist behaviour differs.

function buildTallyWidget(
  plugin: VitalLogPlugin,
  name: string,
  getFile: () => TFile | null,
): HTMLElement {
  const { app, settings } = plugin;
  const config = scalarMetrics(settings).find(
    (t) => t.displayName.toLowerCase() === name.toLowerCase(),
  );
  if (!config) {
    return buildAdHocTally(app, name, getFile);
  }

  // If the widget lives in a note matching the daily-note template
  // (e.g. a past daily note), operate on that note. Otherwise fall back
  // to today's daily note.
  const widgetFile = getFile();
  const targetNote =
    widgetFile && pathMatchesTemplate(widgetFile.path, settings.dailyNotePath)
      ? widgetFile
      : getDailyNoteIfExists(app, settings);

  return buildInlineWidget({
    className: 'vital-log-inline-tally',
    name: config.displayName,
    icon: config.icon,
    step: config.step,
    format: (v) => `${v}/${config.target}`,
    isComplete: (v) => v >= config.target,
    persist: async (v) => {
      if (targetNote) await tally.updateTallyValue(app, targetNote, config, v);
    },
    load: async () => {
      const fm = targetNote ? await yaml.readAllFrontmatter(app, targetNote) : {};
      const raw = fm[config.propertyKey];
      return typeof raw === 'object' && raw !== null && 'value' in raw
        ? ((raw as Record<string, unknown>)['value'] as number) ?? 0
        : 0;
    },
  });
}

// Ad-hoc tally: when `tally: Name` doesn't match a registered counter,
// the widget reads/writes a numeric frontmatter property on the
// current note (the file the widget is rendered in).
function buildAdHocTally(
  app: App,
  name: string,
  getFile: () => TFile | null,
): HTMLElement {
  const propKey = name.trim();
  return buildInlineWidget({
    className: 'vital-log-inline-tally vital-log-inline-tally--adhoc',
    name,
    format: (v) => String(v),
    persist: async (v) => {
      const file = getFile();
      if (file) {
        await app.fileManager.processFrontMatter(file, (fm) => {
          fm[propKey] = v;
        });
      }
    },
    load: async () => {
      const file = getFile();
      if (!file) return 0;
      const fm = await yaml.readAllFrontmatter(app, file);
      const raw = fm[propKey];
      return typeof raw === 'number' ? raw : 0;
    },
  });
}

function buildCounterWidget(
  app: App,
  name: string,
  getFile: () => TFile | null,
): HTMLElement {
  return buildInlineWidget({
    className: 'vital-log-inline-counter',
    name,
    format: (v) => String(v),
    persist: async (v) => {
      const file = getFile();
      if (file) await writeCounterToLine(app, file, name, v);
    },
    load: async () => {
      const file = getFile();
      if (!file) return 0;
      const content = await app.vault.read(file);
      const escapedName = escapeRegex(name);
      const lineRegex = new RegExp('`counter:\\s*' + escapedName + '`');
      for (const line of content.split('\n')) {
        if (lineRegex.test(line)) {
          const counterPos = line.search(lineRegex);
          const beforeCounter = line.slice(0, counterPos);
          const numMatch = beforeCounter.match(/(\d+)\s*$/);
          if (numMatch) return parseInt(numMatch[1], 10);
          break;
        }
      }
      return 0;
    },
  });
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
