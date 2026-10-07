// ============================================================
// Vital Log — Log Modal
// One modal for everything loggable: supplements (vitamin / pack /
// stack), trackers, and events. Items are picked from chips, recent
// first; new substances, packs, stacks, and event types can be
// created inline without opening settings.
// Delegates all file I/O to the managers.
// ============================================================

import { App, Modal, Notice, setIcon } from 'obsidian';
import type { EventType, Pack, Stack, TrackerConfig, VitalLogSettings, Vitamin } from './types';
import { SEVERITY_LABELS, seriesMetrics } from './types';
import { activeDailyNoteDate, resolveDailyNote } from './dailyNoteResolver';
import * as vm from './vitaminManager';
import * as tm from './trackerManager';
import { logEvent } from './eventManager';
import { createAppendToggle } from './formUI';
import {
  renderEventTypeQuickAdd,
  renderPackQuickAdd,
  renderStackQuickAdd,
  renderVitaminQuickAdd,
} from './quickAdd';

// moment is bundled with Obsidian
declare const moment: (date?: Date | string) => { format: (fmt: string) => string; toDate: () => Date };

export type LogTab = 'supplements' | 'trackers' | 'events';
export type SupplementKind = 'vitamin' | 'pack' | 'stack';

export interface LogModalOptions {
  tab?: LogTab;
  supplementKind?: SupplementKind;
  trackerId?: string;
  /** Day to log to; defaults to the open daily note's day, else today. */
  date?: Date;
}

type QuickAddKind = SupplementKind | 'event';

const TABS: { id: LogTab; label: string; icon: string }[] = [
  { id: 'supplements', label: 'Supplements', icon: 'pill' },
  { id: 'trackers', label: 'Trackers', icon: 'activity' },
  { id: 'events', label: 'Events', icon: 'calendar-clock' },
];

const KINDS: { id: SupplementKind; label: string }[] = [
  { id: 'vitamin', label: 'Substance' },
  { id: 'pack', label: 'Pack' },
  { id: 'stack', label: 'Stack' },
];

/** Show a search box once a chip list is longer than this. */
const SEARCH_THRESHOLD = 8;
const MAX_RECENT = 30;

interface Chip {
  id: string;
  label: string;
  icon?: string;
  hint?: string;
}

export class VitalLogModal extends Modal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;

  private tab: LogTab;
  private kind: SupplementKind;
  private quickAdd: QuickAddKind | null = null;

  // Shared fields
  private dateValue: string;
  private timeValue: string;
  private noteValue = '';
  private appendToNote: Record<LogTab, boolean>;

  // Supplements
  private selected: Record<SupplementKind, string> = { vitamin: '', pack: '', stack: '' };
  private amountValue = 0;
  // Per-log amount overrides (keyed by vitaminId for packs; "v:<vitaminId>" or "p:<packId>:<vitaminId>" for stacks)
  private packItemAmounts: Record<string, number> = {};
  private stackItemAmounts: Record<string, number> = {};
  // Per-log exclusions: vitaminId for pack items; "v:<vitaminId>", "p:<packId>", "p:<packId>:<vitaminId>" for stacks
  private packItemExcluded = new Set<string>();
  private stackItemExcluded = new Set<string>();

  // Trackers
  private trackerId = '';
  private trackerValue: number | null = null;

  // Events
  private eventTypeId = '';
  private severity: number | null = null;

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    opts: LogModalOptions = {}
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.tab = opts.tab ?? 'supplements';
    this.kind = opts.supplementKind ?? 'vitamin';
    // With a past daily note open, log to that day — it's the day being worked on.
    this.dateValue = moment(opts.date ?? activeDailyNoteDate(app, settings) ?? undefined).format('YYYY-MM-DD');
    this.timeValue = moment().format('HH:mm');
    this.appendToNote = {
      supplements: settings.appendToNoteDefault_supplements === true,
      trackers: settings.appendToNoteDefault_trackers === true,
      events: settings.appendToNoteDefault_events === true,
    };
    this.trackerId = opts.trackerId ?? this.orderedChips('tracker', this.trackerChips())[0]?.id ?? '';
  }

  onOpen(): void {
    this.modalEl.addClass('vital-log-log-modal');
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  // ── Layout ─────────────────────────────────────────────────

  private render(): void {
    const { contentEl } = this;
    const scrollTop = contentEl.scrollTop;
    contentEl.empty();

    const tabBar = contentEl.createDiv('vital-log-log-tabs');
    for (const t of TABS) {
      const btn = tabBar.createEl('button', {
        cls: 'vital-log-log-tab' + (this.tab === t.id ? ' is-active' : ''),
        attr: { 'aria-pressed': String(this.tab === t.id) },
      });
      setIcon(btn.createSpan('vital-log-log-tab-icon'), t.icon);
      btn.createSpan({ text: t.label });
      btn.addEventListener('click', () => {
        if (this.tab === t.id) return;
        this.tab = t.id;
        this.quickAdd = null;
        this.render();
      });
    }

    // Say plainly when logs will land on a day other than today.
    const today = moment().format('YYYY-MM-DD');
    if (this.dateValue && this.dateValue !== today) {
      const banner = contentEl.createDiv('vital-log-log-past');
      setIcon(banner.createSpan('vital-log-log-past-icon'), 'history');
      banner.createSpan({
        text: `Logging to ${moment(this.dateValue).format('ddd D MMM YYYY')}`,
      });
      const useToday = banner.createEl('button', { text: 'Use today', cls: 'vital-log-btn mod-compact' });
      useToday.addEventListener('click', () => {
        this.dateValue = today;
        this.render();
      });
    }

    const body = contentEl.createDiv('vital-log-log-body');
    let canLog: boolean;
    if (this.tab === 'supplements') canLog = this.renderSupplements(body);
    else if (this.tab === 'trackers') canLog = this.renderTrackers(body);
    else canLog = this.renderEvents(body);

    if (canLog && !this.quickAdd) this.renderCommonFields(body);

    // Keep the scroll position across re-renders, so picking a chip
    // further down doesn't jump the sheet back to the top.
    contentEl.scrollTop = scrollTop;
  }

  /** Date, time, note, append toggle, and the action buttons. */
  private renderCommonFields(body: HTMLElement): void {
    const when = body.createDiv('vital-log-modal-section vital-log-log-when');
    const dateCol = when.createDiv();
    dateCol.createEl('label', { text: 'Date' });
    const dateInput = dateCol.createEl('input', { type: 'date', value: this.dateValue });
    dateInput.addEventListener('change', () => {
      this.dateValue = dateInput.value;
      this.render();
    });

    const timeCol = when.createDiv();
    timeCol.createEl('label', { text: 'Time' });
    const timeInput = timeCol.createEl('input', { type: 'time', value: this.timeValue });
    timeInput.addEventListener('change', () => { this.timeValue = timeInput.value; });

    const timeError = body.createDiv({ cls: 'vital-log-error' });
    timeError.style.display = 'none';

    const noteSection = body.createDiv('vital-log-modal-section');
    noteSection.createEl('label', { text: 'Note (optional)' });
    const noteInput = noteSection.createEl('input', {
      type: 'text',
      placeholder: 'Add a note',
      value: this.noteValue,
    });
    noteInput.addEventListener('input', () => { this.noteValue = noteInput.value; });

    const appendSection = body.createDiv('vital-log-modal-section vital-log-append-section');
    createAppendToggle(appendSection, {
      label: 'Also add to note content',
      value: this.appendToNote[this.tab],
      onChange: (value) => { this.appendToNote[this.tab] = value; },
    });

    const btnRow = body.createDiv({ cls: 'vital-log-inline-form-actions' });
    btnRow.createEl('button', { text: 'Close', cls: 'vital-log-btn' })
      .addEventListener('click', () => this.close());
    const logBtn = btnRow.createEl('button', { text: 'Log', cls: 'vital-log-btn mod-cta' });
    logBtn.addEventListener('click', async () => {
      if (!/^\d{2}:\d{2}$/.test(this.timeValue)) {
        timeError.setText('Pick a valid time.');
        timeError.style.display = 'block';
        return;
      }
      timeError.style.display = 'none';
      logBtn.disabled = true;
      try {
        await this.doLog();
      } finally {
        logBtn.disabled = false;
      }
    });
  }

  // ── Chips ──────────────────────────────────────────────────

  /** Recently logged first, in recency order; the rest keep their configured order. */
  private orderedChips(kind: string, chips: Chip[]): Chip[] {
    const recent = this.settings.recentLogItems ?? [];
    const rank = (c: Chip): number => {
      const i = recent.indexOf(`${kind}:${c.id}`);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return chips
      .map((c, index) => ({ c, index, r: rank(c) }))
      .sort((a, b) => a.r - b.r || a.index - b.index)
      .map((x) => x.c);
  }

  /**
   * A wrapping row of selectable chips, recent first, with an optional
   * "+ New" chip and a search box for long lists. Searching filters chips in
   * place rather than re-rendering, so the search box keeps focus.
   */
  private renderChips(
    parent: HTMLElement,
    opts: {
      kind: string;
      chips: Chip[];
      selectedId: string;
      onSelect: (id: string) => void;
      onNew?: () => void;
      emptyText: string;
    }
  ): void {
    const chips = this.orderedChips(opts.kind, opts.chips);
    const section = parent.createDiv('vital-log-modal-section');

    let search: HTMLInputElement | null = null;
    if (chips.length > SEARCH_THRESHOLD) {
      search = section.createEl('input', {
        type: 'search',
        cls: 'vital-log-chip-search',
        placeholder: 'Search…',
      });
    }

    const row = section.createDiv('vital-log-chips');
    if (chips.length === 0) {
      row.createSpan({ cls: 'vital-log-no-data', text: opts.emptyText });
    }

    const chipEls: { el: HTMLElement; label: string }[] = [];
    for (const chip of chips) {
      const el = row.createEl('button', {
        cls: 'vital-log-chip' + (chip.id === opts.selectedId ? ' is-active' : ''),
        attr: { 'aria-pressed': String(chip.id === opts.selectedId) },
      });
      if (chip.icon) setIcon(el.createSpan('vital-log-chip-icon'), chip.icon);
      el.createSpan({ text: chip.label });
      if (chip.hint) el.createSpan({ cls: 'vital-log-chip-hint', text: chip.hint });
      el.addEventListener('click', () => opts.onSelect(chip.id));
      chipEls.push({ el, label: chip.label.toLowerCase() });
    }

    if (opts.onNew) {
      const add = row.createEl('button', { cls: 'vital-log-chip vital-log-chip--new' });
      setIcon(add.createSpan('vital-log-chip-icon'), 'plus');
      add.createSpan({ text: 'New' });
      add.addEventListener('click', opts.onNew);
    }

    search?.addEventListener('input', () => {
      const q = search!.value.trim().toLowerCase();
      for (const { el, label } of chipEls) el.toggle(!q || label.includes(q));
    });
  }

  private openQuickAdd(kind: QuickAddKind): void {
    this.quickAdd = kind;
    this.render();
  }

  /** Persist a newly created item, select it, and return to the log form. */
  private async finishQuickAdd(select: () => void): Promise<void> {
    await this.saveSettings();
    select();
    this.quickAdd = null;
    this.render();
  }

  private cancelQuickAdd = (): void => {
    this.quickAdd = null;
    this.render();
  };

  // ── Supplements tab ────────────────────────────────────────

  private renderSupplements(body: HTMLElement): boolean {
    const kindSel = body.createDiv('vital-log-type-selector');
    for (const k of KINDS) {
      const btn = kindSel.createEl('button', {
        text: k.label,
        cls: 'vital-log-type-btn' + (this.kind === k.id ? ' is-active' : ''),
      });
      btn.addEventListener('click', () => {
        if (this.kind === k.id) return;
        this.kind = k.id;
        this.quickAdd = null;
        this.amountValue = 0;
        this.render();
      });
    }

    if (this.quickAdd === 'vitamin') {
      renderVitaminQuickAdd(body, this.settings, {
        onSave: (v: Vitamin) => void this.finishQuickAdd(() => this.selectSupplement('vitamin', v.id)),
        onCancel: this.cancelQuickAdd,
      });
      return false;
    }
    if (this.quickAdd === 'pack') {
      renderPackQuickAdd(body, this.settings, {
        onSave: (p: Pack) => void this.finishQuickAdd(() => this.selectSupplement('pack', p.id)),
        onCancel: this.cancelQuickAdd,
      });
      return false;
    }
    if (this.quickAdd === 'stack') {
      renderStackQuickAdd(body, this.settings, {
        onSave: (s: Stack) => void this.finishQuickAdd(() => this.selectSupplement('stack', s.id)),
        onCancel: this.cancelQuickAdd,
      });
      return false;
    }

    const kind = this.kind;
    this.renderChips(body, {
      kind,
      chips: this.supplementChips(kind),
      selectedId: this.selected[kind],
      onSelect: (id) => {
        this.selectSupplement(kind, this.selected[kind] === id ? '' : id);
        this.render();
      },
      onNew: () => this.openQuickAdd(kind),
      emptyText: kind === 'vitamin' ? 'No substances yet.' : `No ${kind}s yet.`,
    });

    if (kind === 'vitamin') this.renderAmount(body);
    else if (kind === 'pack') this.renderPackPreview(body);
    else this.renderStackPreview(body);

    return this.selected[kind] !== '';
  }

  private supplementChips(kind: SupplementKind): Chip[] {
    if (kind === 'vitamin') {
      return this.settings.vitamins
        .filter((v) => !v.archived)
        .map((v) => ({ id: v.id, label: v.displayName }));
    }
    if (kind === 'pack') {
      return this.settings.packs
        .filter((p) => !p.archived)
        .map((p) => ({ id: p.id, label: p.displayName }));
    }
    return this.settings.stacks
      .filter((s) => !s.archived)
      .map((s) => ({ id: s.id, label: s.displayName, hint: s.schedulingHint }));
  }

  private selectSupplement(kind: SupplementKind, id: string): void {
    this.kind = kind;
    this.selected[kind] = id;
    this.amountValue = 0;
    this.packItemAmounts = {};
    this.stackItemAmounts = {};
    this.packItemExcluded = new Set();
    this.stackItemExcluded = new Set();
  }

  private renderAmount(body: HTMLElement): void {
    const vit = this.settings.vitamins.find((v) => v.id === this.selected.vitamin);
    if (!vit) return;
    if (this.amountValue === 0) this.amountValue = vit.defaultAmount;
    const section = body.createDiv('vital-log-modal-section');
    section.createEl('label', { text: `Amount (${vit.unit})` });
    const row = section.createDiv('vital-log-amount-stepper');

    // ±0,5 steps by half the substance's default dose.
    const half = vit.defaultAmount / 2;
    const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);
    const decBtn = row.createEl('button', {
      text: '-0,5',
      cls: 'vital-log-amount-step',
      attr: { 'aria-label': `Subtract half a dose (${fmt(half)} ${vit.unit})` },
    });
    const amtInput = row.createEl('input', { type: 'number', value: fmt(this.amountValue) });
    amtInput.inputMode = 'decimal';
    const incBtn = row.createEl('button', {
      text: '+0,5',
      cls: 'vital-log-amount-step',
      attr: { 'aria-label': `Add half a dose (${fmt(half)} ${vit.unit})` },
    });

    const set = (value: number): void => {
      this.amountValue = Math.max(0, value);
      amtInput.value = fmt(this.amountValue);
    };
    decBtn.addEventListener('click', () => set((parseFloat(amtInput.value) || 0) - half));
    incBtn.addEventListener('click', () => set((parseFloat(amtInput.value) || 0) + half));
    amtInput.addEventListener('input', () => {
      this.amountValue = parseFloat(amtInput.value) || 0;
    });
  }

  /** One editable, skippable row in a pack/stack preview. */
  private renderPreviewRow(
    list: HTMLElement,
    vitamin: Vitamin,
    opts: { amount: number; excluded: boolean; nested?: boolean; onAmount: (v: number) => void; onToggle: () => void }
  ): void {
    const row = list.createDiv({
      cls: 'vital-log-pack-item-row' +
        (opts.nested ? ' vital-log-pack-item-row--nested' : '') +
        (opts.excluded ? ' vital-log-excluded' : ''),
    });
    row.createEl('span', { text: vitamin.displayName, cls: 'vital-log-preview-name' });
    if (!opts.excluded) {
      const amtInput = row.createEl('input', { type: 'number', value: String(opts.amount) });
      amtInput.inputMode = 'decimal';
      row.createEl('span', { text: vitamin.unit, cls: 'vital-log-preview-unit' });
      amtInput.addEventListener('input', () => {
        const val = parseFloat(amtInput.value);
        if (!isNaN(val)) opts.onAmount(val);
      });
    } else {
      row.createEl('span', { text: '(skipped)', cls: 'vital-log-preview-unit' });
    }
    const btn = row.createEl('button', {
      text: opts.excluded ? 'Restore' : '✕',
      cls: 'vital-log-btn mod-compact' + (opts.excluded ? '' : ' mod-warning'),
    });
    btn.addEventListener('click', () => {
      opts.onToggle();
      this.render();
    });
  }

  private renderPackPreview(body: HTMLElement): void {
    const pack = this.settings.packs.find((p) => p.id === this.selected.pack);
    if (!pack || pack.items.length === 0) return;

    const preview = body.createDiv({ cls: 'vital-log-preview' });
    preview.createEl('label', { text: 'Contents (amounts editable)' });
    const list = preview.createDiv({ cls: 'vital-log-pack-items' });

    for (const item of pack.items) {
      const vitamin = this.settings.vitamins.find((v) => v.id === item.vitaminId);
      if (!vitamin) continue;
      const excluded = this.packItemExcluded.has(item.vitaminId);
      this.renderPreviewRow(list, vitamin, {
        amount: this.packItemAmounts[item.vitaminId] ?? item.amount,
        excluded,
        onAmount: (v) => { this.packItemAmounts[item.vitaminId] = v; },
        onToggle: () => {
          if (excluded) this.packItemExcluded.delete(item.vitaminId);
          else {
            this.packItemExcluded.add(item.vitaminId);
            delete this.packItemAmounts[item.vitaminId];
          }
        },
      });
    }
  }

  private renderStackPreview(body: HTMLElement): void {
    const stack = this.settings.stacks.find((s) => s.id === this.selected.stack);
    if (!stack || stack.items.length === 0) return;

    const preview = body.createDiv({ cls: 'vital-log-preview' });
    preview.createEl('label', { text: 'Contents (amounts editable)' });

    for (const item of stack.items) {
      if (item.type === 'vitamin') {
        const vitamin = this.settings.vitamins.find((v) => v.id === item.vitaminId);
        if (!vitamin) continue;
        const key = `v:${item.vitaminId}`;
        const excluded = this.stackItemExcluded.has(key);
        this.renderPreviewRow(preview.createDiv({ cls: 'vital-log-pack-items' }), vitamin, {
          amount: this.stackItemAmounts[key] ?? item.amount ?? vitamin.defaultAmount,
          excluded,
          onAmount: (v) => { this.stackItemAmounts[key] = v; },
          onToggle: () => {
            if (excluded) this.stackItemExcluded.delete(key);
            else {
              this.stackItemExcluded.add(key);
              delete this.stackItemAmounts[key];
            }
          },
        });
        continue;
      }

      const pack = this.settings.packs.find((p) => p.id === item.packId);
      if (!pack) continue;
      const packKey = `p:${pack.id}`;
      const packExcluded = this.stackItemExcluded.has(packKey);
      const packBlock = preview.createDiv({
        cls: 'vital-log-preview-pack-block' + (packExcluded ? ' vital-log-excluded' : ''),
      });
      const packHeader = packBlock.createDiv({ cls: 'vital-log-preview-pack-name' });
      packHeader.createEl('span', { text: `Pack: ${pack.displayName}` });
      const packBtn = packHeader.createEl('button', {
        text: packExcluded ? 'Restore' : '✕',
        cls: 'vital-log-btn mod-compact' + (packExcluded ? '' : ' mod-warning'),
      });
      packBtn.addEventListener('click', () => {
        if (packExcluded) {
          this.stackItemExcluded.delete(packKey);
          pack.items.forEach((pi) => this.stackItemExcluded.delete(`${packKey}:${pi.vitaminId}`));
        } else {
          this.stackItemExcluded.add(packKey);
        }
        this.render();
      });
      if (packExcluded) continue;

      const list = packBlock.createDiv({ cls: 'vital-log-pack-items' });
      for (const packItem of pack.items) {
        const vitamin = this.settings.vitamins.find((v) => v.id === packItem.vitaminId);
        if (!vitamin) continue;
        const key = `${packKey}:${packItem.vitaminId}`;
        const excluded = this.stackItemExcluded.has(key);
        this.renderPreviewRow(list, vitamin, {
          amount: this.stackItemAmounts[key] ?? packItem.amount,
          excluded,
          nested: true,
          onAmount: (v) => { this.stackItemAmounts[key] = v; },
          onToggle: () => {
            if (excluded) this.stackItemExcluded.delete(key);
            else {
              this.stackItemExcluded.add(key);
              delete this.stackItemAmounts[key];
            }
          },
        });
      }
    }
  }

  // ── Trackers tab ───────────────────────────────────────────

  private trackerChips(): Chip[] {
    return seriesMetrics(this.settings)
      .filter((t) => !t.archived)
      .map((t) => ({ id: t.id, label: t.displayName, icon: t.icon }));
  }

  private get tracker(): TrackerConfig | undefined {
    return seriesMetrics(this.settings).find((t) => t.id === this.trackerId);
  }

  private renderTrackers(body: HTMLElement): boolean {
    this.renderChips(body, {
      kind: 'tracker',
      chips: this.trackerChips(),
      selectedId: this.trackerId,
      onSelect: (id) => {
        this.trackerId = id;
        this.trackerValue = null;
        this.render();
      },
      emptyText: 'No trackers configured. Add some in Settings → Vital Log.',
    });

    const tracker = this.tracker;
    if (!tracker) return false;

    const section = body.createDiv('vital-log-modal-section');
    if (tracker.trackerType === 'minutes') {
      section.createEl('label', { text: `${tracker.displayName} (minutes)` });
      const stepper = section.createDiv('vital-log-tracker-stepper');
      const decBtn = stepper.createEl('button', { text: '−', cls: 'vital-log-tracker-step-btn' });
      const input = stepper.createEl('input', {
        cls: 'vital-log-tracker-stepper-input',
        type: 'number',
        attr: { min: '0', step: '1', placeholder: '0' },
      });
      input.inputMode = 'numeric';
      if (this.trackerValue !== null) input.value = String(this.trackerValue);
      const incBtn = stepper.createEl('button', { text: '+', cls: 'vital-log-tracker-step-btn' });
      const set = (v: number | null): void => {
        this.trackerValue = v;
        input.value = v === null ? '' : String(v);
      };
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        this.trackerValue = isNaN(v) ? null : v;
      });
      decBtn.addEventListener('click', () => set(Math.max(0, (this.trackerValue ?? 0) - 1)));
      incBtn.addEventListener('click', () => set((this.trackerValue ?? 0) + 1));
    } else {
      section.createEl('label', {
        text: this.trackerValue !== null ? `${tracker.displayName} — ${this.trackerValue}` : tracker.displayName,
      });
      const grid = section.createDiv('vital-log-tracker-grid');
      const count = tracker.max - tracker.min + 1;
      for (let v = tracker.min; v <= tracker.max; v++) {
        const btn = grid.createEl('button', {
          text: String(v),
          cls: 'vital-log-tracker-value-btn' + (this.trackerValue === v ? ' is-selected' : ''),
        });
        if (count <= 5) btn.addClass('vital-log-tracker-value-btn--large');
        else if (count <= 10) btn.addClass('vital-log-tracker-value-btn--medium');
        btn.addEventListener('click', () => {
          this.trackerValue = v;
          this.render();
        });
      }
    }
    return true;
  }

  // ── Events tab ─────────────────────────────────────────────

  private renderEvents(body: HTMLElement): boolean {
    if (this.quickAdd === 'event') {
      renderEventTypeQuickAdd(body, this.settings, {
        onSave: (et: EventType) => void this.finishQuickAdd(() => { this.eventTypeId = et.id; }),
        onCancel: this.cancelQuickAdd,
      });
      return false;
    }

    this.renderChips(body, {
      kind: 'event',
      chips: this.settings.eventTypes
        .filter((t) => !t.archived)
        .map((t) => ({ id: t.id, label: t.displayName, icon: t.icon })),
      selectedId: this.eventTypeId,
      onSelect: (id) => {
        this.eventTypeId = this.eventTypeId === id ? '' : id;
        this.render();
      },
      onNew: () => this.openQuickAdd('event'),
      emptyText: 'No event types yet.',
    });

    if (!this.eventTypeId) return false;

    const section = body.createDiv('vital-log-modal-section');
    section.createEl('label', {
      text: this.severity !== null
        ? `Severity — ${this.severity} · ${SEVERITY_LABELS[this.severity]}`
        : 'Severity',
    });
    const grid = section.createDiv('vital-log-tracker-grid');
    for (let s = 1; s <= 5; s++) {
      const btn = grid.createEl('button', {
        cls: 'vital-log-tracker-value-btn vital-log-tracker-value-btn--large vital-log-event-severity-btn' +
          (this.severity === s ? ' is-selected' : ''),
        attr: { title: SEVERITY_LABELS[s] },
      });
      btn.createDiv({ text: String(s), cls: 'vital-log-severity-num' });
      btn.createDiv({ text: SEVERITY_LABELS[s], cls: 'vital-log-severity-label' });
      btn.addEventListener('click', () => {
        this.severity = s;
        this.render();
      });
    }
    return true;
  }

  // ── Logging ────────────────────────────────────────────────

  private async rememberRecent(kind: string, id: string): Promise<void> {
    const key = `${kind}:${id}`;
    const recent = (this.settings.recentLogItems ?? []).filter((k) => k !== key);
    recent.unshift(key);
    this.settings.recentLogItems = recent.slice(0, MAX_RECENT);
    await this.saveSettings();
  }

  private async doLog(): Promise<void> {
    try {
      const date = this.dateValue ? moment(this.dateValue).toDate() : new Date();
      const file = await resolveDailyNote(this.app, this.settings, date);
      if (!file) {
        new Notice('Vital Log: Could not resolve daily note.');
        return;
      }

      const time = this.timeValue;
      const note = this.noteValue || undefined;
      const appendToNote = this.appendToNote[this.tab];
      let message: string;
      let recent: [string, string];

      if (this.tab === 'supplements') {
        const result = await this.logSupplement(file, time, note, appendToNote);
        if (!result) return;
        [message, recent] = result;
      } else if (this.tab === 'trackers') {
        const tracker = this.tracker;
        if (!tracker) { new Notice('Vital Log: Pick a tracker.'); return; }
        if (this.trackerValue === null) { new Notice(`Vital Log: Pick a ${tracker.displayName.toLowerCase()} value.`); return; }
        await tm.logTracker(this.app, file, tracker, { time, value: this.trackerValue, note, appendToNote }, this.settings);
        message = `Logged ${tracker.displayName}: ${this.trackerValue} at ${time}`;
        recent = ['tracker', tracker.id];
        this.trackerValue = null;
      } else {
        const eventType = this.settings.eventTypes.find((t) => t.id === this.eventTypeId);
        if (!eventType) { new Notice('Vital Log: Pick an event.'); return; }
        if (this.severity === null) { new Notice('Vital Log: Pick a severity.'); return; }
        await logEvent(
          this.app, file,
          { time, name: eventType.displayName, severity: this.severity, note },
          this.settings, appendToNote
        );
        message = `Logged ${eventType.displayName} (severity ${this.severity}) at ${time}`;
        recent = ['event', eventType.id];
        this.eventTypeId = '';
        this.severity = null;
      }

      new Notice(message);
      await this.rememberRecent(...recent);
      this.noteValue = '';
      this.timeValue = moment().format('HH:mm');
      this.render();
    } catch (err) {
      console.error('Vital Log log modal:', err);
      if (err instanceof Error && err.name !== 'AbortError') {
        new Notice(`Vital Log: Error logging — ${err.message}`);
      }
    }
  }

  /** Log the selected supplement. Returns the notice text and recent key, or null if nothing was picked. */
  private async logSupplement(
    file: import('obsidian').TFile,
    time: string,
    note: string | undefined,
    appendToNote: boolean
  ): Promise<[string, [string, string]] | null> {
    const kind = this.kind;

    if (kind === 'vitamin') {
      const vitamin = this.settings.vitamins.find((v) => v.id === this.selected.vitamin);
      if (!vitamin) { new Notice('Vital Log: Pick a substance.'); return null; }
      await vm.logVitamin(this.app, file, vitamin, {
        time,
        amount: this.amountValue || vitamin.defaultAmount,
        note,
        source: 'manual',
        appendToNote,
      }, this.settings);
      this.selectSupplement('vitamin', '');
      return [`Logged ${vitamin.displayName} at ${time}`, ['vitamin', vitamin.id]];
    }

    if (kind === 'pack') {
      const pack = this.settings.packs.find((p) => p.id === this.selected.pack);
      if (!pack) { new Notice('Vital Log: Pick a pack.'); return null; }
      const packWithOverrides = {
        ...pack,
        items: pack.items
          .filter((item) => !this.packItemExcluded.has(item.vitaminId))
          .map((item) => ({ ...item, amount: this.packItemAmounts[item.vitaminId] ?? item.amount })),
      };
      await vm.logPack(this.app, file, packWithOverrides, this.settings, { time, source: 'manual', appendToNote });
      this.selectSupplement('pack', '');
      return [`Logged pack "${pack.displayName}" at ${time}`, ['pack', pack.id]];
    }

    const stack = this.settings.stacks.find((s) => s.id === this.selected.stack);
    if (!stack) { new Notice('Vital Log: Pick a stack.'); return null; }
    const stackWithOverrides = {
      ...stack,
      items: stack.items
        .filter((item) =>
          item.type === 'vitamin'
            ? !this.stackItemExcluded.has(`v:${item.vitaminId}`)
            : !this.stackItemExcluded.has(`p:${item.packId}`)
        )
        .map((item) => {
          if (item.type !== 'vitamin') return item;
          const key = `v:${item.vitaminId}`;
          return key in this.stackItemAmounts ? { ...item, amount: this.stackItemAmounts[key] } : item;
        }),
    };
    // Pack amount overrides and exclusions inside the stack travel via a settings copy.
    const settingsWithOverrides = {
      ...this.settings,
      packs: this.settings.packs.map((p) => ({
        ...p,
        items: p.items
          .filter((pi) => !this.stackItemExcluded.has(`p:${p.id}:${pi.vitaminId}`))
          .map((pi) => {
            const key = `p:${p.id}:${pi.vitaminId}`;
            return key in this.stackItemAmounts ? { ...pi, amount: this.stackItemAmounts[key] } : pi;
          }),
      })),
    };
    await vm.logStack(this.app, file, stackWithOverrides, settingsWithOverrides, { time, appendToNote });
    this.selectSupplement('stack', '');
    return [`Logged stack "${stack.displayName}" at ${time}`, ['stack', stack.id]];
  }
}
