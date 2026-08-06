// ============================================================
// Vital Log — Settings Tab
// ============================================================

import { App, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import type VitalLogPlugin from '../main';
import type { CustomModalConfig, CustomField, CustomFieldType, TallyCounterConfig, TrackerConfig, Metric, CustomModalItem, CustomButtonConfig, MirrorConditionalPin, StatType, ScheduleItem, ScheduleKind, Frequency, EventType } from './types';
import { CUSTOM_FIELD_TYPES, STAT_TYPES, STAT_LABELS, defaultPrimaryStat, defaultDisplayStats, seriesMetrics, scalarMetrics, checkboxMetrics, SEVERITY_LABELS } from './types';
import { setGoalFromToday, getGoalPlan, todayISO, resolveGoal, describeFrequency } from './planManager';
import { ManageModal } from './manageModal';
import { KeyDiagnosticModal } from './keyDiagnosticModal';
import { buildSnapshot } from './keySnapshotManager';
import { confirm } from './confirmModal';
import { findStaleReferences, removeStaleReferences } from './referenceCheck';
import { validatePropertyKey, allKeyOwners } from './validation';
import { findUnknownPathTokens } from './dailyNoteResolver';
import { createIconField } from './iconPicker';
import { CommandPickerModal, commandLabel } from './commandPicker';
import { getRegisteredCommands } from './internal';
import { makeReorderable } from './dragReorder';
import {
  GuardedModal,
  attachFieldError,
  createToggleRow,
  guardUnsaved,
  hasDirtyForm,
  initInlineForm,
  requireValue,
} from './formUI';

function slugify(name: string): string {
  return name
    .trim()
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase()) // camelCase
    .replace(/[^a-zA-Z0-9]/g, '')
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

/** Human label for a metric's type (used for the settings list badge). */
function metricTypeLabel(type: import('./types').TrackerType | undefined): string {
  switch (type) {
    case 'tally': return 'Tally';
    case 'checkbox': return 'Checkbox';
    case 'minutes': return 'Minutes';
    default: return 'Rating';
  }
}

type SettingsTab = 'general' | 'library' | 'metrics' | 'plan' | 'customModals' | 'events';

export class VitalLogSettingTab extends PluginSettingTab {
  private plugin: VitalLogPlugin;
  private activeTab: SettingsTab = 'general';

  constructor(app: App, plugin: VitalLogPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('vital-log-settings');

    // ── Tab bar ──────────────────────────────────────────────
    const tabBar = containerEl.createDiv('vital-log-settings-tabs');
    const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'general', label: 'General' },
      { id: 'library', label: 'Library' },
      { id: 'metrics', label: 'Metrics' },
      { id: 'plan', label: 'Plan' },
      { id: 'customModals', label: 'Custom Modals' },
      { id: 'events', label: 'Events' },
    ];

    for (const tab of tabs) {
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: `vital-log-settings-tab${tab.id === this.activeTab ? ' is-active' : ''}`,
      });
      btn.addEventListener('click', () => {
        void this.guarded(() => {
          this.activeTab = tab.id;
          this.display();
        });
      });
    }

    // ── Tab content ──────────────────────────────────────────
    const content = containerEl.createDiv('vital-log-settings-content');

    switch (this.activeTab) {
      case 'general':
        this.renderGeneralTab(content);
        break;
      case 'library':
        this.renderLibraryTab(content);
        break;
      case 'metrics':
        this.renderMetricsTab(content);
        break;
      case 'plan':
        this.renderPlanTab(content);
        break;
      case 'customModals':
        this.renderCustomModalsTab(content);
        break;
      case 'events':
        this.renderEventsTab(content);
        break;
    }
  }

  /**
   * Run `action` unless an inline form has unsaved edits the user would rather
   * keep. Every handler that re-renders the tab (and so destroys an open form)
   * goes through here.
   */
  private guarded(action: () => void | Promise<void>): Promise<void> {
    return guardUnsaved(this.app, this.containerEl, action);
  }

  /** Close any inline form already on screen so only one is ever open. */
  private closeOpenForms(): void {
    this.containerEl
      .querySelectorAll('.vital-log-inline-form')
      .forEach((form) => form.remove());
  }

  // ── General tab ──────────────────────────────────────────────

  private renderGeneralTab(el: HTMLElement): void {
    // Daily note path
    el.createEl('h3', { text: 'Daily Note Path' });

    const pathError = createDiv({ cls: 'vital-log-error' });
    pathError.style.display = 'none';
    const showPathTokenError = (value: string): void => {
      const unknown = findUnknownPathTokens(value);
      if (unknown.length === 0) {
        pathError.style.display = 'none';
        return;
      }
      pathError.textContent =
        `Unknown token(s): ${unknown.map((t) => `{{${t}}}`).join(', ')}. ` +
        `They will appear literally in the path. See "Supported tokens" below.`;
      pathError.style.display = 'block';
    };

    new Setting(el)
      .setName('Path template')
      .setDesc('Template path for your daily note.')
      .addText((text) =>
        text
          .setPlaceholder('Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}')
          .setValue(this.plugin.settings.dailyNotePath)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotePath = value;
            showPathTokenError(value);
            await this.plugin.saveSettings();
          })
      );
    el.appendChild(pathError);
    showPathTokenError(this.plugin.settings.dailyNotePath);

    const tokenDetails = el.createEl('details', { cls: 'vital-log-token-details' });
    tokenDetails.createEl('summary', { text: 'Supported tokens' });
    const tokenGrid = tokenDetails.createDiv('vital-log-token-grid');
    const tokens = [
      ['{{YYYY}}', 'Full year'],
      ['{{YY}}', '2-digit year'],
      ['{{MM}}', 'Month (01–12)'],
      ['{{DD}}', 'Day (01–31)'],
      ['{{dddd}}', 'Weekday name'],
      ['{{ddd}}', 'Short weekday'],
      ['{{Q}}', 'Quarter (1–4)'],
      ['{{WW}}', 'ISO week'],
      ['{{MMMM}}', 'Month name'],
      ['{{YYYY-MM-DD}}', 'Date'],
      ['{{YYYY-MM-DD dddd}}', 'Date + weekday'],
      ['{{YYYY-MM}}', 'Year-month'],
    ];
    for (const [token, desc] of tokens) {
      const row = tokenGrid.createDiv('vital-log-token-row');
      row.createEl('code', { text: token });
      row.createEl('span', { text: desc });
    }

    // Log format
    el.createEl('h3', { text: 'Log Format' });

    new Setting(el)
      .setName('Log mode')
      .setDesc(
        'Per-vitamin: each supplement gets its own frontmatter key. Substances: single flat list.'
      )
      .addDropdown((dd) =>
        dd
          .addOption('perVitamin', 'Per-vitamin keys')
          .addOption('substances', 'Flat substances list')
          .setValue(this.plugin.settings.logMode ?? 'perVitamin')
          .onChange(async (value) => {
            const prev = this.plugin.settings.logMode ?? 'perVitamin';
            const next = value as 'perVitamin' | 'substances';
            if (next === prev) return;
            const ok = await confirm(this.app, {
              title: 'Change log mode',
              message: [
                next === 'substances'
                  ? 'New supplement logs will be written to a single flat "substances" list instead of per-vitamin keys.'
                  : 'New supplement logs will be written to per-vitamin frontmatter keys instead of a flat list.',
                'Entries already logged in the old format are not converted and stay as they are.',
              ],
              confirmText: 'Change mode',
              destructive: false,
            });
            if (!ok) {
              dd.setValue(prev);
              return;
            }
            this.plugin.settings.logMode = next;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Include source field')
      .setDesc('Record where each entry came from (manual, pack, stack).')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logSource !== false)
          .onChange(async (value) => {
            this.plugin.settings.logSource = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Log pack entries')
      .setDesc('Write a packs[] record when logging a pack.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logPackEntries !== false)
          .onChange(async (value) => {
            this.plugin.settings.logPackEntries = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Log stack entries')
      .setDesc('Write a stacks[] record when logging a stack.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.logStackEntries !== false)
          .onChange(async (value) => {
            this.plugin.settings.logStackEntries = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Note Content ──
    el.createEl('h3', { text: 'Note Content' });

    new Setting(el)
      .setName('Append supplements to note content (default on)')
      .setDesc('Default state of the "Also add to note" checkbox when logging vitamins, packs, or stacks.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_supplements === true)
          .onChange(async (value) => {
            this.plugin.settings.appendToNoteDefault_supplements = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Supplement note line template')
      .setDesc('Template for lines added to note content when logging vitamins, packs, or stacks. Available tokens: {time} {name} {amount} {unit} {note}. For stacks, {name} is the list of items. For packs, {amount} and {unit} are empty.')
      .addText((text) =>
        text
          .setPlaceholder('- {time} {name} {amount}{unit}')
          .setValue(this.plugin.settings.noteContentTemplate_supplements ?? '- {time} {name} {amount}{unit}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_supplements = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Append trackers to note content (default on)')
      .setDesc('Default state of the "Also add to note" checkbox when logging trackers.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_trackers === true)
          .onChange(async (value) => {
            this.plugin.settings.appendToNoteDefault_trackers = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Tracker note line template')
      .setDesc('Template for lines added to note content when logging trackers. Available tokens: {time} {name} {value} {note}.')
      .addText((text) =>
        text
          .setPlaceholder('- {time} {name}: {value}')
          .setValue(this.plugin.settings.noteContentTemplate_trackers ?? '- {time} {name}: {value}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_trackers = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Append tally counters to note content (default on)')
      .setDesc('Default state of the "Also add tallies to note" checkbox in custom modals.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_tallies === true)
          .onChange(async (value) => {
            this.plugin.settings.appendToNoteDefault_tallies = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Tally note line template')
      .setDesc('Template for lines added to note content when saving tally counters. Available tokens: {name} {value} {target}.')
      .addText((text) =>
        text
          .setPlaceholder('- {name}: {value}/{target}')
          .setValue(this.plugin.settings.noteContentTemplate_tallies ?? '- {name}: {value}/{target}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_tallies = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName('Tally → specific note template')
      .setDesc('Template for lines appended to a tally\'s "Append to note" target note. Available tokens: {dailyNote} {time} {name} {value} {target}.')
      .addText((text) =>
        text
          .setPlaceholder('- [[{dailyNote}]] {time} : {value}/{target}')
          .setValue(this.plugin.settings.noteContentTemplate_specificNoteTally ?? '- [[{dailyNote}]] {time} : {value}/{target}')
          .onChange(async (value) => {
            this.plugin.settings.noteContentTemplate_specificNoteTally = value;
            await this.plugin.saveSettings();
          })
      );

    // ── Mirror Mode ──
    el.createEl('h3', { text: 'Mirror Mode' });

    new Setting(el)
      .setName('Excluded property keys')
      .setDesc('Property keys that will never appear in the "Other Properties" section of Mirror modals. One key per line (e.g. tags, cssclasses).')
      .addTextArea((ta) => {
        ta.setPlaceholder('tags\ncssclasses\ncreated');
        ta.setValue((this.plugin.settings.mirrorExcludedKeys ?? []).join('\n'));
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = '100%';
        ta.onChange(async (value) => {
          this.plugin.settings.mirrorExcludedKeys = value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        });
      });

    // ── Maintenance ──
    el.createEl('h3', { text: 'Maintenance' });

    new Setting(el)
      .setName('Diagnose changed keys')
      .setDesc(
        'Renames are detected automatically and you are offered a migration when notes are left behind. ' +
        'Open this to review changes you deferred, or to re-scan your vault by hand. ' +
        'Supports nested (sub-property) keys that Obsidian\'s built-in rename cannot handle.'
      )
      .addButton((btn) =>
        btn
          .setButtonText('Diagnose Changed Keys')
          .onClick(() => {
            new KeyDiagnosticModal(
              this.app,
              this.plugin.settings,
              async () => {
                this.plugin.settings.propertyKeySnapshot = buildSnapshot(this.plugin.settings);
                await this.plugin.saveSettings();
              }
            ).open();
          })
      );
  }

  // ── Library tab ──────────────────────────────────────────────

  private renderLibraryTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Manage your supplement library: individual vitamins, packs (groups of vitamins), and stacks (scheduled collections).',
      cls: 'vital-log-settings-helper',
    });

    this.renderStaleReferenceNotice(el);

    new Setting(el)
      .setName('Vitamins')
      .setDesc('Manage your vitamin library.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Manager')
          .setCta()
          .onClick(() => {
            new ManageModal(
              this.app,
              this.plugin.settings,
              () => this.plugin.saveSettings(),
              'vitamins'
            ).open();
          })
      );

    new Setting(el)
      .setName('Packs')
      .setDesc('Manage supplement packs.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Manager')
          .setCta()
          .onClick(() => {
            new ManageModal(
              this.app,
              this.plugin.settings,
              () => this.plugin.saveSettings(),
              'packs'
            ).open();
          })
      );

    new Setting(el)
      .setName('Stacks')
      .setDesc('Manage supplement stacks.')
      .addButton((btn) =>
        btn
          .setButtonText('Open Manager')
          .setCta()
          .onClick(() => {
            new ManageModal(
              this.app,
              this.plugin.settings,
              () => this.plugin.saveSettings(),
              'stacks'
            ).open();
          })
      );
  }

  private renderStaleReferenceNotice(el: HTMLElement): void {
    const stale = findStaleReferences(this.plugin.settings);
    if (stale.length === 0) return;

    const panel = el.createDiv('vital-log-stale-refs');
    panel.createEl('strong', { text: `${stale.length} broken reference(s) found` });
    const list = panel.createEl('ul');
    for (const ref of stale) {
      list.createEl('li', { text: ref.description });
    }
    panel.createEl('p', {
      text: 'These point at items that have been deleted. Cleaning them up is safe — already-logged entries in your notes are not affected.',
      cls: 'vital-log-settings-helper',
    });
    const cleanBtn = panel.createEl('button', { text: 'Remove broken references', cls: 'vital-log-btn mod-warning' });
    cleanBtn.addEventListener('click', async () => {
      const ok = await confirm(this.app, {
        title: 'Remove broken references',
        message: 'Remove all dangling pack/stack items and schedule entries that point at deleted items?',
        confirmText: 'Remove',
      });
      if (!ok) return;
      const removed = removeStaleReferences(this.plugin.settings);
      await this.plugin.saveSettings();
      new Notice(`Vital Log: removed ${removed} broken reference(s).`);
      this.display();
    });
  }

  // ── Plan tab (dashboard goals + schedule) ────────────────────

  private scheduleRefName(kind: ScheduleKind, refId: string): string | null {
    const s = this.plugin.settings;
    switch (kind) {
      case 'vitamin': return s.vitamins.find((v) => v.id === refId)?.displayName ?? null;
      case 'pack': return s.packs.find((p) => p.id === refId)?.displayName ?? null;
      case 'stack': return s.stacks.find((st) => st.id === refId)?.displayName ?? null;
      case 'tally': return scalarMetrics(s).find((t) => t.id === refId)?.displayName ?? null;
      case 'checkbox': return checkboxMetrics(s).find((t) => t.id === refId)?.displayName ?? null;
    }
  }

  private scheduleRefOptions(kind: ScheduleKind): { id: string; name: string }[] {
    const s = this.plugin.settings;
    switch (kind) {
      case 'vitamin': return s.vitamins.map((v) => ({ id: v.id, name: v.displayName }));
      case 'pack': return s.packs.map((p) => ({ id: p.id, name: p.displayName }));
      case 'stack': return s.stacks.map((st) => ({ id: st.id, name: st.displayName }));
      case 'tally': return scalarMetrics(s).filter((t) => !t.archived).map((t) => ({ id: t.id, name: t.displayName }));
      case 'checkbox': return checkboxMetrics(s).filter((t) => !t.archived).map((t) => ({ id: t.id, name: t.displayName }));
    }
  }

  private renderPlanTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Configure the dashboard: which tracker goals to show, and a schedule of supplements/tallies due each day.',
      cls: 'vital-log-settings-helper',
    });

    // ── Goals ──
    el.createEl('h3', { text: 'Tracker Goals' });
    el.createEl('p', {
      text: 'Enable a tracker to show its goal on the dashboard. Setting a goal here applies from today onward; ' +
        'change it day-to-day from the dashboard. Past days keep the goal that was in effect then.',
      cls: 'vital-log-settings-helper',
    });

    const trackers = seriesMetrics(this.plugin.settings).filter((t) => !t.archived);
    const checkboxHabits = checkboxMetrics(this.plugin.settings).filter((t) => !t.archived);
    if (trackers.length === 0 && checkboxHabits.length === 0) {
      el.createEl('p', { text: 'No trackers yet. Add some in the Metrics tab.', cls: 'vital-log-settings-helper' });
    }
    for (const tracker of trackers) {
      const plan = getGoalPlan(this.plugin.settings, tracker.id);
      const goalToday = plan ? resolveGoal(plan, todayISO()) : null;

      const setting = new Setting(el).setName(tracker.displayName);
      setting.addToggle((tg) =>
        tg.setValue(plan?.enabled ?? false).onChange(async (on) => {
          let p = getGoalPlan(this.plugin.settings, tracker.id);
          if (!p) {
            p = { trackerId: tracker.id, enabled: on, goalHistory: [] };
            this.plugin.settings.plannedLogs.trackerGoals.push(p);
          } else {
            p.enabled = on;
          }
          await this.plugin.saveSettings();
        })
      );
      setting.addText((tx) => {
        tx.setPlaceholder('goal').setValue(goalToday !== null ? String(goalToday) : '');
        tx.inputEl.type = 'number';
        tx.inputEl.style.width = '6rem';
        tx.onChange(async (val) => {
          const v = parseFloat(val);
          if (isNaN(v)) return;
          setGoalFromToday(this.plugin.settings, tracker.id, v);
          await this.plugin.saveSettings();
        });
      });
    }

    for (const habit of checkboxHabits) {
      const plan = getGoalPlan(this.plugin.settings, habit.id);
      new Setting(el).setName(habit.displayName).setDesc('Track a day-streak for this habit on the dashboard.').addToggle((tg) =>
        tg.setValue(plan?.enabled ?? false).onChange(async (on) => {
          let p = getGoalPlan(this.plugin.settings, habit.id);
          if (!p) {
            p = { trackerId: habit.id, enabled: on, goalHistory: [{ value: 1, effectiveFrom: todayISO() }] };
            this.plugin.settings.plannedLogs.trackerGoals.push(p);
          } else {
            p.enabled = on;
            if (p.goalHistory.length === 0) p.goalHistory.push({ value: 1, effectiveFrom: todayISO() });
          }
          await this.plugin.saveSettings();
        })
      );
    }

    // ── Schedule ──
    el.createEl('h3', { text: 'Daily Schedule' });
    el.createEl('p', {
      text: 'Items the dashboard lists under "To take / do today" based on their frequency.',
      cls: 'vital-log-settings-helper',
    });

    const schedule = this.plugin.settings.plannedLogs.schedule;
    for (const item of schedule) {
      const name = this.scheduleRefName(item.kind, item.refId);
      const setting = new Setting(el)
        .setName(name ?? `(missing ${item.kind})`)
        .setDesc(`${item.kind} · ${describeFrequency(item.frequency)}`);
      setting.addExtraButton((btn) =>
        btn.setIcon('trash').setTooltip('Remove').onClick(() => {
          void this.guarded(async () => {
            this.plugin.settings.plannedLogs.schedule = schedule.filter((s) => s.id !== item.id);
            await this.plugin.saveSettings();
            this.display();
          });
        })
      );
    }

    const addBtnRow = new Setting(el);
    addBtnRow.addButton((btn) =>
      btn.setButtonText('Add scheduled item').setCta().onClick(() => {
        void this.guarded(() => {
          this.closeOpenForms();
          this.renderScheduleAddForm(el, addBtnRow.settingEl);
          btn.setDisabled(true);
        });
      })
    );
  }

  private renderScheduleAddForm(containerEl: HTMLElement, insertBefore: HTMLElement): void {
    const form = containerEl.createDiv('vital-log-inline-form');
    insertBefore.parentElement?.insertBefore(form, insertBefore);
    form.createEl('h4', { text: 'New scheduled item' });

    const kindRow = form.createDiv('vital-log-form-row');
    kindRow.createEl('label', { text: 'Type' });
    const kindSelect = kindRow.createEl('select');
    const kinds: ScheduleKind[] = ['vitamin', 'pack', 'stack', 'tally', 'checkbox'];
    for (const k of kinds) kindSelect.createEl('option', { value: k, text: k[0].toUpperCase() + k.slice(1) });

    const refRow = form.createDiv('vital-log-form-row');
    refRow.createEl('label', { text: 'Item' });
    const refSelect = refRow.createEl('select');
    const refError = attachFieldError(refRow, refSelect);
    const syncRefOptions = () => {
      refSelect.empty();
      const opts = this.scheduleRefOptions(kindSelect.value as ScheduleKind);
      if (opts.length === 0) {
        refSelect.createEl('option', { value: '', text: '(none configured)' });
      }
      for (const o of opts) refSelect.createEl('option', { value: o.id, text: o.name });
    };
    syncRefOptions();
    kindSelect.addEventListener('change', syncRefOptions);

    const freqRow = form.createDiv('vital-log-form-row');
    freqRow.createEl('label', { text: 'Frequency' });
    const freqSelect = freqRow.createEl('select');
    freqSelect.createEl('option', { value: 'daily', text: 'Every day' });
    freqSelect.createEl('option', { value: 'weekdays', text: 'Specific weekdays' });
    freqSelect.createEl('option', { value: 'everyNDays', text: 'Every N days' });

    // weekday checkboxes
    const weekRow = form.createDiv('vital-log-form-row');
    weekRow.createEl('label', { text: 'Days' });
    const weekWrap = weekRow.createDiv('vital-log-stat-checkboxes');
    const weekError = attachFieldError(weekRow, weekWrap);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayBoxes: HTMLInputElement[] = [];
    dayNames.forEach((dn, idx) => {
      const lbl = weekWrap.createEl('label', { cls: 'vital-log-stat-checkbox' });
      const cb = lbl.createEl('input', { type: 'checkbox' });
      cb.checked = idx >= 1 && idx <= 5; // default weekdays
      lbl.createSpan({ text: dn });
      dayBoxes[idx] = cb;
    });

    // every-N input
    const nRow = form.createDiv('vital-log-form-row');
    nRow.createEl('label', { text: 'Every (days)' });
    const nInput = nRow.createEl('input', { type: 'number', value: '2' });

    const syncFreqUI = () => {
      const f = freqSelect.value;
      weekRow.style.display = f === 'weekdays' ? '' : 'none';
      nRow.style.display = f === 'everyNDays' ? '' : 'none';
    };
    syncFreqUI();
    freqSelect.addEventListener('change', syncFreqUI);

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const cancel = (): void => this.display();
    cancelBtn.addEventListener('click', cancel);

    const saveBtn = actions.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' });
    const save = async (): Promise<void> => {
      const kind = kindSelect.value as ScheduleKind;
      const refId = refSelect.value;
      if (!refId) {
        refError.show(`No ${kind}s are configured yet — add one first, then schedule it.`);
        return;
      }
      refError.clear();

      let frequency: Frequency;
      if (freqSelect.value === 'weekdays') {
        const days = dayBoxes.map((cb, i) => (cb.checked ? i : -1)).filter((i) => i >= 0);
        if (days.length === 0) {
          weekError.show('Pick at least one weekday.');
          return;
        }
        weekError.clear();
        frequency = { type: 'weekdays', days };
      } else if (freqSelect.value === 'everyNDays') {
        const n = parseInt(nInput.value) || 1;
        frequency = { type: 'everyNDays', n, anchor: todayISO() };
      } else {
        frequency = { type: 'daily' };
      }

      const item: ScheduleItem = { id: crypto.randomUUID(), kind, refId, frequency };
      this.plugin.settings.plannedLogs.schedule.push(item);
      await this.plugin.saveSettings();
      this.display();
    };

    saveBtn.addEventListener('click', () => void save());
    initInlineForm(form, { onSave: () => void save(), onCancel: cancel });
  }

  // ── Metrics tab (unified trackers + tally counters) ──────────

  private renderMetricsTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Metrics are the numeric things you log each day. A Tracker (series) keeps a timestamped list of values ' +
        '(e.g. Mood, Energy) and is aggregated on the dashboard. A Tally Counter (scalar) is a single running count ' +
        'per day (e.g. Outreach) with a target and +/- step.',
      cls: 'vital-log-settings-helper',
    });

    const metrics = this.plugin.settings.metrics;
    const activeMetrics = metrics.filter((m) => !m.archived);
    const archivedMetrics = metrics.filter((m) => m.archived);

    const metricList = el.createDiv('vital-log-item-list');
    const registerRow = makeReorderable(metricList, (from, to) =>
      this.guarded(async () => {
        const arr = this.plugin.settings.metrics;
        const fromIdx = arr.indexOf(activeMetrics[from]);
        const toIdx = arr.indexOf(activeMetrics[to]);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [moved] = arr.splice(fromIdx, 1);
          arr.splice(toIdx, 0, moved);
        }
        await this.plugin.saveSettings();
        this.display();
      })
    );

    for (let i = 0; i < activeMetrics.length; i++) {
      const metric = activeMetrics[i];
      const row = metricList.createDiv('vital-log-item-row');
      registerRow(row, i);
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
      const info = row.createDiv('vital-log-item-info');
      const nameEl = info.createDiv({ cls: 'vital-log-item-name' });
      if (metric.icon) {
        const iconSpan = nameEl.createSpan({ cls: 'vital-log-item-icon' });
        setIcon(iconSpan, metric.icon);
      }
      nameEl.createSpan({ text: metric.displayName });
      nameEl.createSpan({
        cls: 'vital-log-item-badge',
        text: metricTypeLabel(metric.trackerType),
      });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: metric.trackerType === 'tally'
          ? `${metric.propertyKey} · target ${metric.target} · step ${metric.step}`
          : metric.trackerType === 'checkbox'
            ? `${metric.propertyKey} · checkbox`
            : metric.trackerType === 'minutes'
              ? `${metric.propertyKey} · ${metric.valueName} · minutes`
              : `${metric.propertyKey} · ${metric.valueName} · ${metric.min}–${metric.max}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        void this.guarded(() => {
          this.closeOpenForms();
          this.renderMetricForm(el, metricList, metric);
        });
      });

      const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn' });
      archiveBtn.title = 'Hide from logging and dashboard; keep historical data';
      archiveBtn.addEventListener('click', () => {
        void this.guarded(async () => {
          const ok = await confirm(this.app, {
            title: 'Archive metric',
            message: `Archive "${metric.displayName}"? It will be hidden from logging and the dashboard but historical data stays in your notes. You can restore it any time.`,
            confirmText: 'Archive',
            destructive: false,
          });
          if (!ok) return;
          metric.archived = true;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    }

    if (activeMetrics.length === 0) {
      metricList.createDiv({ cls: 'vital-log-empty-state', text: 'No metrics configured yet.' });
    }

    new Setting(el)
      .addButton((btn) =>
        btn
          .setButtonText('Add Metric')
          .setCta()
          .onClick(() => {
            void this.guarded(() => {
              this.closeOpenForms();
              this.renderMetricForm(el, metricList);
            });
          })
      );

    // ── Archived metrics ─────────────────────────────────────
    if (archivedMetrics.length > 0) {
      const details = el.createEl('details', { cls: 'vital-log-archived-modals' });
      details.createEl('summary', { text: `Archived metrics (${archivedMetrics.length})` });
      const archivedList = details.createDiv('vital-log-item-list');

      for (const metric of archivedMetrics) {
        const row = archivedList.createDiv('vital-log-item-row vital-log-item-row--archived');
        const info = row.createDiv('vital-log-item-info');
        const nameEl = info.createDiv({ cls: 'vital-log-item-name' });
        if (metric.icon) {
          const iconSpan = nameEl.createSpan({ cls: 'vital-log-item-icon' });
          setIcon(iconSpan, metric.icon);
        }
        nameEl.createSpan({ text: metric.displayName });
        nameEl.createSpan({ cls: 'vital-log-item-badge', text: metricTypeLabel(metric.trackerType) });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: metric.trackerType === 'tally'
            ? `${metric.propertyKey} · target ${metric.target} · step ${metric.step}`
            : metric.trackerType === 'checkbox'
              ? `${metric.propertyKey} · checkbox`
              : metric.trackerType === 'minutes'
                ? `${metric.propertyKey} · ${metric.valueName} · minutes`
              : `${metric.propertyKey} · ${metric.valueName} · ${metric.min}–${metric.max}`,
        });
        const actions = row.createDiv('vital-log-item-actions');

        const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn' });
        restoreBtn.addEventListener('click', () => {
          void this.guarded(async () => {
            delete metric.archived;
            await this.plugin.saveSettings();
            this.display();
          });
        });

        const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
        delBtn.addEventListener('click', () => {
          void this.guarded(async () => {
            const ok = await confirm(this.app, {
              title: 'Delete metric',
              message: `Delete "${metric.displayName}"? Goals, schedule entries, and dashboard stats for it are removed. Already-logged values in your notes are not affected.`,
              confirmText: 'Delete',
            });
            if (!ok) return;
            this.plugin.settings.metrics = this.plugin.settings.metrics.filter((m) => m.id !== metric.id);
            await this.plugin.saveSettings();
            this.display();
          });
        });
      }
    }
  }

  // ── Custom Modals tab ────────────────────────────────────────

  private renderCustomModalsTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Create custom modals that write properties to any periodic note.',
      cls: 'vital-log-settings-helper',
    });

    const activeModals = this.plugin.settings.customModals.filter((m) => !m.archived);
    const archivedModals = this.plugin.settings.customModals.filter((m) => m.archived);

    const modalList = el.createDiv('vital-log-item-list');
    const registerModalRow = makeReorderable(modalList, (from, to) =>
      this.guarded(async () => {
        const arr = this.plugin.settings.customModals;
        const fromIdx = arr.indexOf(activeModals[from]);
        const toIdx = arr.indexOf(activeModals[to]);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [moved] = arr.splice(fromIdx, 1);
          arr.splice(toIdx, 0, moved);
        }
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      })
    );
    for (let i = 0; i < activeModals.length; i++) {
      const modal = activeModals[i];
      const row = modalList.createDiv('vital-log-item-row');
      registerModalRow(row, i);
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({ cls: 'vital-log-item-name', text: modal.displayName });
      info.createDiv({
        cls: 'vital-log-item-meta',
        text: `${modal.items.length} item${modal.items.length !== 1 ? 's' : ''} · ${modal.notePath || '(no path)'}`,
      });
      const actions = row.createDiv('vital-log-item-actions');

      const dupBtn = actions.createEl('button', { text: 'Duplicate', cls: 'vital-log-btn' });
      dupBtn.addEventListener('click', async () => {
        const copy: import('./types').CustomModalConfig = JSON.parse(JSON.stringify(modal));
        copy.id = crypto.randomUUID();
        copy.displayName = `Copy of ${modal.displayName}`;
        delete copy.archived;
        const origIdx = this.plugin.settings.customModals.indexOf(modal);
        this.plugin.settings.customModals.splice(origIdx + 1, 0, copy);
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      });

      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => {
        new CustomModalEditorModal(this.app, this.plugin, modal, true, () => this.display()).open();
      });

      const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn' });
      archiveBtn.title = 'Hide from commands but keep working in embeds';
      archiveBtn.addEventListener('click', async () => {
        const ok = await confirm(this.app, {
          title: 'Archive modal',
          message: [
            `Archive "${modal.displayName}"? Its command and ribbon icon will be removed.`,
            'Any embedded “vital-log” blocks that reference it keep working. You can unarchive it any time.',
          ],
          confirmText: 'Archive',
          destructive: false,
        });
        if (!ok) return;
        modal.archived = true;
        await this.plugin.saveSettings();
        this.plugin.registerCustomModalCommands();
        this.display();
      });
    }

    if (activeModals.length === 0) {
      modalList.createDiv({ cls: 'vital-log-empty-state', text: 'No custom modals yet.' });
    }

    new Setting(el)
      .addButton((btn) =>
        btn
          .setButtonText('Add Custom Modal')
          .setCta()
          .onClick(() => {
            const newModal: CustomModalConfig = {
              id: crypto.randomUUID(),
              displayName: '',
              icon: 'file-text',
              notePath: this.plugin.settings.dailyNotePath,
              useTemplater: false,
              templatePath: '',
              items: [],
            };
            new CustomModalEditorModal(this.app, this.plugin, newModal, false, () => this.display()).open();
          })
      );

    // ── Archived modals ───────────────────────────────────────
    if (archivedModals.length > 0) {
      const details = el.createEl('details', { cls: 'vital-log-archived-modals' });
      details.createEl('summary', { text: `Archived modals (${archivedModals.length})` });
      const archivedList = details.createDiv('vital-log-item-list');

      for (const modal of archivedModals) {
        const row = archivedList.createDiv('vital-log-item-row vital-log-item-row--archived');
        const info = row.createDiv('vital-log-item-info');
        info.createDiv({ cls: 'vital-log-item-name', text: modal.displayName });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${modal.items.length} item${modal.items.length !== 1 ? 's' : ''} · ${modal.notePath || '(no path)'}`,
        });
        const actions = row.createDiv('vital-log-item-actions');

        const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn' });
        restoreBtn.addEventListener('click', async () => {
          delete modal.archived;
          await this.plugin.saveSettings();
          this.plugin.registerCustomModalCommands();
          this.display();
        });

        const delBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
        delBtn.addEventListener('click', async () => {
          const ok = await confirm(this.app, {
            title: 'Delete modal',
            message: [
              `Permanently delete "${modal.displayName}"?`,
              'Any embedded “vital-log” blocks that reference it will stop working. This cannot be undone.',
            ],
            confirmText: 'Delete',
          });
          if (!ok) return;
          this.plugin.settings.customModals = this.plugin.settings.customModals.filter((m) => m.id !== modal.id);
          await this.plugin.saveSettings();
          this.plugin.registerCustomModalCommands();
          this.display();
        });
      }
    }
  }

  /**
   * Attach live property-key validation to a key input. Inserts an inline
   * error element right after the key's form row and validates on every
   * keystroke. Returns a validate() that callers run on save (returns true if valid).
   */
  private attachKeyValidation(
    keyInput: HTMLInputElement,
    keyRow: HTMLElement,
    excludeId?: string
  ): () => boolean {
    const keyError = attachFieldError(keyRow, keyInput);
    const validate = (): boolean => {
      const owners = allKeyOwners(this.plugin.settings);
      const err = validatePropertyKey(keyInput.value.trim(), owners, excludeId);
      if (err) keyError.show(err);
      else keyError.clear();
      return err === null;
    };
    keyInput.addEventListener('input', validate);
    return validate;
  }

  // ── Metric add/edit form (rating / minutes / tally) ──────────

  private renderMetricForm(
    containerEl: HTMLElement,
    insertBefore: HTMLElement,
    existing?: Metric,
  ): void {
    const isEdit = !!existing;
    const form = containerEl.createDiv('vital-log-inline-form');
    insertBefore.parentElement?.insertBefore(form, insertBefore.nextSibling);
    form.createEl('h4', { text: isEdit ? `Edit: ${existing!.displayName}` : 'New Metric' });

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Type' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'rating', text: 'Rating (1–N scale)' });
    typeSelect.createEl('option', { value: 'minutes', text: 'Minutes (duration)' });
    typeSelect.createEl('option', { value: 'tally', text: 'Tally (running count)' });
    typeSelect.createEl('option', { value: 'checkbox', text: 'Checkbox (habit toggle)' });
    typeSelect.value = existing?.trackerType ?? 'rating';

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Mood', value: existing?.displayName ?? '' });
    const nameError = attachFieldError(nameRow, nameInput);

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', placeholder: 'e.g. moodLog', value: existing?.propertyKey ?? '' });
    const validateKey = this.attachKeyValidation(keyInput, keyRow, existing?.id);

    const valRow = form.createDiv('vital-log-form-row');
    valRow.createEl('label', { text: 'Value Name' });
    const valInput = valRow.createEl('input', { type: 'text', placeholder: 'e.g. mood', value: existing?.valueName ?? '' });
    const valError = attachFieldError(valRow, valInput);

    const descRow = form.createDiv('vital-log-form-row');
    descRow.createEl('label', { text: 'Description' });
    const descInput = descRow.createEl('input', { type: 'text', placeholder: 'Helper text shown in modal', value: existing?.description ?? '' });

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = createIconField(iconRow, { value: existing?.icon ?? '', placeholder: 'e.g. smile, zap, hash' });

    const minRow = form.createDiv('vital-log-form-row');
    minRow.createEl('label', { text: 'Min' });
    const minInput = minRow.createEl('input', { type: 'number', value: existing ? String(existing.min) : '1' });
    const maxRow = form.createDiv('vital-log-form-row');
    maxRow.createEl('label', { text: 'Max' });
    const maxInput = maxRow.createEl('input', { type: 'number', value: existing ? String(existing.max) : '5' });

    const targetRow = form.createDiv('vital-log-form-row');
    targetRow.createEl('label', { text: 'Target' });
    const targetInput = targetRow.createEl('input', { type: 'number', value: existing && existing.trackerType === 'tally' ? String(existing.target) : '10' });
    const stepRow = form.createDiv('vital-log-form-row');
    stepRow.createEl('label', { text: 'Step' });
    const stepInput = stepRow.createEl('input', { type: 'number', value: existing && existing.trackerType === 'tally' ? String(existing.step) : '1' });

    const { rowEl: statusBarRow, toggle: statusBarToggle } = createToggleRow(form, {
      label: 'Show in status bar',
      value: existing?.showInStatusBar === true,
    });

    const appendNoteRow = form.createDiv('vital-log-form-row');
    appendNoteRow.createEl('label', { text: 'Append to note (path)' });
    const appendNoteInput = appendNoteRow.createEl('input', { type: 'text', placeholder: 'e.g. Business Outreaches', value: existing?.appendToNoteName ?? '' });

    const primaryRow = form.createDiv('vital-log-form-row');
    primaryRow.createEl('label', { text: 'Goal stat' });
    const primarySelect = primaryRow.createEl('select');
    for (const s of STAT_TYPES) primarySelect.createEl('option', { value: s, text: STAT_LABELS[s] });
    primarySelect.value = existing?.primaryStat ?? defaultPrimaryStat(existing?.trackerType);

    const statsRow = form.createDiv('vital-log-form-row');
    statsRow.createEl('label', { text: 'Show stats' });
    const statsWrap = statsRow.createDiv('vital-log-stat-checkboxes');
    const currentStats = new Set(existing?.displayStats ?? defaultDisplayStats(existing?.trackerType));
    const statBoxes = new Map<StatType, HTMLInputElement>();
    for (const s of STAT_TYPES) {
      const lbl = statsWrap.createEl('label', { cls: 'vital-log-stat-checkbox' });
      const cb = lbl.createEl('input', { type: 'checkbox' });
      cb.checked = currentStats.has(s);
      lbl.createSpan({ text: STAT_LABELS[s] });
      statBoxes.set(s, cb);
    }

    // Show only the rows relevant to the selected type.
    const syncTypeUI = () => {
      const t = typeSelect.value;
      const isTally = t === 'tally';
      const isCheckbox = t === 'checkbox';
      const isRating = t === 'rating';
      valRow.style.display = (isTally || isCheckbox) ? 'none' : '';
      minRow.style.display = isRating ? '' : 'none';
      maxRow.style.display = isRating ? '' : 'none';
      descRow.style.display = isTally ? '' : 'none';
      targetRow.style.display = isTally ? '' : 'none';
      stepRow.style.display = isTally ? '' : 'none';
      statusBarRow.style.display = isTally ? '' : 'none';
      appendNoteRow.style.display = isTally ? '' : 'none';
      primaryRow.style.display = (isTally || isCheckbox) ? 'none' : '';
      statsRow.style.display = (isTally || isCheckbox) ? 'none' : '';
    };
    syncTypeUI();
    typeSelect.addEventListener('change', syncTypeUI);

    // Auto-fill key / value suffixes from the name (add mode only).
    if (!isEdit) {
      const refreshKey = () => {
        if (!nameInput.value) return;
        keyInput.value = slugify(nameInput.value) + (typeSelect.value === 'tally' ? 'Tally' : typeSelect.value === 'checkbox' ? '' : 'Log');
        validateKey();
      };
      nameInput.addEventListener('input', () => {
        refreshKey();
        if (typeSelect.value === 'rating' && !valInput.value) valInput.value = slugify(nameInput.value);
      });
      typeSelect.addEventListener('change', () => {
        refreshKey();
        if (typeSelect.value === 'minutes' && !valInput.value) valInput.value = 'minutes';
      });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const cancel = (): void => { form.remove(); };
    cancelBtn.addEventListener('click', cancel);

    const saveBtn = actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });
    const save = async (): Promise<void> => {
      const type = typeSelect.value as import('./types').TrackerType;
      const isTally = type === 'tally';
      const isCheckbox = type === 'checkbox';

      if (!requireValue(nameInput, nameError, 'Give this metric a display name.')) return;
      if (!isTally && !isCheckbox && !requireValue(valInput, valError, 'Name the value key written inside each entry, e.g. "mood".')) return;
      valError.clear();
      if (!keyInput.value.trim()) {
        keyInput.focus();
        validateKey();
        return;
      }
      if (!validateKey()) { keyInput.focus(); return; }

      const name = nameInput.value.trim();
      const key = keyInput.value.trim();
      const val = valInput.value.trim();

      const m: Metric = isEdit ? existing! : ({} as Metric);
      m.id = existing?.id ?? crypto.randomUUID();
      m.displayName = name;
      m.propertyKey = key;
      m.trackerType = type;
      m.icon = iconInput.value.trim() || (isTally ? 'hash' : isCheckbox ? 'check-square' : 'activity');

      if (isTally) {
        m.valueName = '';
        m.min = 0;
        m.max = 0;
        m.description = descInput.value.trim() || undefined;
        m.target = parseInt(targetInput.value) || 10;
        m.step = Math.max(1, parseInt(stepInput.value) || 1);
        m.showInStatusBar = statusBarToggle.getValue() || undefined;
        m.appendToNoteName = appendNoteInput.value.trim() || undefined;
        m.primaryStat = undefined;
        m.displayStats = undefined;
      } else if (isCheckbox) {
        m.valueName = '';
        m.min = 0;
        m.max = 0;
        m.target = 0;
        m.step = 1;
        m.description = undefined;
        m.showInStatusBar = undefined;
        m.appendToNoteName = undefined;
        m.primaryStat = undefined;
        m.displayStats = undefined;
      } else {
        m.valueName = val;
        m.min = parseInt(minInput.value) || 1;
        m.max = parseInt(maxInput.value) || 5;
        m.primaryStat = primarySelect.value as StatType;
        m.displayStats = STAT_TYPES.filter((s) => statBoxes.get(s)?.checked);
        m.target = 0;
        m.step = 1;
        m.description = undefined;
        m.showInStatusBar = undefined;
        m.appendToNoteName = undefined;
      }

      if (!isEdit) this.plugin.settings.metrics.push(m);
      await this.plugin.saveSettings();
      this.display();
    };

    saveBtn.addEventListener('click', () => void save());
    initInlineForm(form, { onSave: () => void save(), onCancel: cancel });
  }

  // ── Events tab ────────────────────────────────────────────────

  private renderEventsTab(el: HTMLElement): void {
    el.createEl('p', {
      text: 'Events are one-off life occurrences (sick, traveling, rest day, etc.) you can log to your daily note. ' +
        'Each event has a severity (1–5) and an optional note. Saved event names appear as quick-select buttons in the log modal.',
      cls: 'vital-log-settings-helper',
    });

    // ── Event types list ───────────────────────────────────────
    el.createEl('h3', { text: 'Event Types' });

    const activeTypes = this.plugin.settings.eventTypes.filter((t) => !t.archived);
    const archivedTypes = this.plugin.settings.eventTypes.filter((t) => t.archived);

    const typeList = el.createDiv('vital-log-item-list');

    for (const et of activeTypes) {
      const row = typeList.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      const nameEl = info.createDiv({ cls: 'vital-log-item-name' });
      if (et.icon) {
        const iconSpan = nameEl.createSpan({ cls: 'vital-log-item-icon' });
        setIcon(iconSpan, et.icon);
      }
      nameEl.createSpan({ text: et.displayName });
      const actions = row.createDiv('vital-log-item-actions');

      const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn' });
      archiveBtn.title = 'Hide from log modal; keeps historical data intact';
      archiveBtn.addEventListener('click', async () => {
        et.archived = true;
        await this.plugin.saveSettings();
        this.display();
      });

      const deleteBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
      deleteBtn.addEventListener('click', async () => {
        const ok = await confirm(this.app, {
          title: 'Delete event type',
          message: `Delete "${et.displayName}"? Already-logged events in your notes are not affected.`,
          confirmText: 'Delete',
        });
        if (!ok) return;
        this.plugin.settings.eventTypes = this.plugin.settings.eventTypes.filter((t) => t.id !== et.id);
        await this.plugin.saveSettings();
        this.display();
      });
    }

    if (activeTypes.length === 0) {
      typeList.createDiv({
        cls: 'vital-log-empty-state',
        text: 'No event types saved yet. They are created automatically when you log a new event name.',
      });
    }

    // Add event type form
    const addSection = el.createDiv('vital-log-add-inline');
    const addInput = addSection.createEl('input', {
      type: 'text',
      placeholder: 'New event type name…',
    });
    addInput.setAttribute('aria-label', 'New event type name');
    const addBtn = addSection.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' });
    const addError = attachFieldError(addSection, addInput);

    const addEventType = async (): Promise<void> => {
      const name = addInput.value.trim();
      if (!name) {
        addError.show('Type a name for the new event type.');
        addInput.focus();
        return;
      }
      const exists = this.plugin.settings.eventTypes.some(
        (t) => t.displayName.toLowerCase() === name.toLowerCase()
      );
      if (exists) {
        addError.show(`"${name}" already exists.`);
        addInput.focus();
        return;
      }
      addError.clear();
      const newType: EventType = { id: crypto.randomUUID(), displayName: name };
      this.plugin.settings.eventTypes.push(newType);
      await this.plugin.saveSettings();
      this.display();
    };

    addBtn.addEventListener('click', () => void addEventType());
    addInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      void addEventType();
    });

    // Archived types
    if (archivedTypes.length > 0) {
      const details = el.createEl('details', { cls: 'vital-log-archived-modals' });
      details.createEl('summary', { text: `Archived event types (${archivedTypes.length})` });
      const archivedList = details.createDiv('vital-log-item-list');
      for (const et of archivedTypes) {
        const row = archivedList.createDiv('vital-log-item-row vital-log-item-row--archived');
        const info = row.createDiv('vital-log-item-info');
        info.createDiv({ cls: 'vital-log-item-name', text: et.displayName });
        const actions = row.createDiv('vital-log-item-actions');
        const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn' });
        restoreBtn.addEventListener('click', async () => {
          delete et.archived;
          await this.plugin.saveSettings();
          this.display();
        });
        const deleteBtn = actions.createEl('button', { text: 'Delete', cls: 'vital-log-btn mod-warning' });
        deleteBtn.addEventListener('click', async () => {
          const ok = await confirm(this.app, {
            title: 'Delete event type',
            message: `Delete "${et.displayName}"?`,
            confirmText: 'Delete',
          });
          if (!ok) return;
          this.plugin.settings.eventTypes = this.plugin.settings.eventTypes.filter((t) => t.id !== et.id);
          await this.plugin.saveSettings();
          this.display();
        });
      }
    }

    // ── Storage settings ──────────────────────────────────────
    el.createEl('h3', { text: 'Storage' });

    new Setting(el)
      .setName('Frontmatter key')
      .setDesc('Property key used to store events in your daily note.')
      .addText((text) => {
        text
          .setPlaceholder('events')
          .setValue(this.plugin.settings.eventsPropertyKey)
          .onChange(async (val) => {
            const trimmed = val.trim();
            if (trimmed) {
              this.plugin.settings.eventsPropertyKey = trimmed;
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(el)
      .setName('Default "append to note"')
      .setDesc('Pre-check the "Also add to note content" checkbox in the event log modal.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.appendToNoteDefault_events)
          .onChange(async (val) => {
            this.plugin.settings.appendToNoteDefault_events = val;
            await this.plugin.saveSettings();
          });
      });

    new Setting(el)
      .setName('Note content template')
      .setDesc('Template for event lines appended to note body. Tokens: {time} {name} {severity} {note}')
      .addText((text) => {
        text
          .setPlaceholder('- {time} {name} (severity: {severity})')
          .setValue(this.plugin.settings.noteContentTemplate_events)
          .onChange(async (val) => {
            this.plugin.settings.noteContentTemplate_events = val;
            await this.plugin.saveSettings();
          });
      });

    // ── Graph settings ────────────────────────────────────────
    el.createEl('h3', { text: 'Dashboard Graph' });

    new Setting(el)
      .setName('Show events in sparklines')
      .setDesc('Overlay event markers on tracker sparklines in the range dashboard view.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showEventsInGraph)
          .onChange(async (val) => {
            this.plugin.settings.showEventsInGraph = val;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.showEventsInGraph) {
      new Setting(el)
        .setName('Minimum severity to show')
        .setDesc(`Only show events with severity ≥ this value. 1 = show all; 5 = only Severe. Labels: ${Object.entries(SEVERITY_LABELS).map(([k, v]) => `${k}=${v}`).join(', ')}.`)
        .addSlider((slider) => {
          slider
            .setLimits(1, 5, 1)
            .setValue(this.plugin.settings.graphEventSeverityMin)
            .setDynamicTooltip()
            .onChange(async (val) => {
              this.plugin.settings.graphEventSeverityMin = val;
              await this.plugin.saveSettings();
            });
        });
    }
  }
}

// ================================================================
// Custom Modal Editor — opens as a separate Obsidian Modal
// ================================================================

class CustomModalEditorModal extends GuardedModal {
  private plugin: VitalLogPlugin;
  private modal: CustomModalConfig;
  private isEdit: boolean;
  private onSaved: () => void;
  /** Set once the user changes anything — structural edits don't fire input events. */
  private touched = false;

  constructor(
    app: App,
    plugin: VitalLogPlugin,
    modal: CustomModalConfig,
    isEdit: boolean,
    onSaved: () => void
  ) {
    super(app);
    this.plugin = plugin;
    // Work on a deep copy so cancel doesn't mutate
    this.modal = JSON.parse(JSON.stringify(modal));
    this.isEdit = isEdit;
    this.onSaved = onSaved;
  }

  protected hasUnsavedWork(): boolean {
    return this.touched || hasDirtyForm(this.contentEl);
  }

  /** Record a structural change (adding/removing/reordering items) as unsaved work. */
  private markTouched(): void {
    this.touched = true;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('vital-log-modal-editor-modal');
    this.modalEl.addClass('vital-log-modal');
    contentEl.addEventListener('input', () => this.markTouched());
    contentEl.addEventListener('change', () => this.markTouched());

    contentEl.createEl('h2', {
      text: this.isEdit ? `Edit: ${this.modal.displayName}` : 'New Custom Modal',
    });

    // ── Metadata section ──
    const metaSection = contentEl.createDiv('vital-log-editor-section');
    metaSection.createEl('h3', { text: 'Modal Settings' });

    const nameRow = metaSection.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Daily Review',
      value: this.modal.displayName,
    });
    const nameError = attachFieldError(nameRow, nameInput);

    const iconRow = metaSection.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon' });
    const iconInput = createIconField(iconRow, {
      placeholder: 'e.g. file-text, heart, star',
      value: this.modal.icon,
    });

    const pathRow = metaSection.createDiv('vital-log-form-row');
    pathRow.createEl('label', { text: 'Note Path' });
    const pathInput = pathRow.createEl('input', {
      type: 'text',
      placeholder: 'Calendar/Daily/{{YYYY}}/Q{{Q}}/{{YYYY-MM-DD dddd}}',
      value: this.modal.notePath,
    });

    const tokenDetails = metaSection.createEl('details', { cls: 'vital-log-token-details' });
    tokenDetails.createEl('summary', { text: 'Supported tokens' });
    const tokenGrid = tokenDetails.createDiv('vital-log-token-grid');
    const tokens = [
      ['{{YYYY}}', 'Full year'],
      ['{{YY}}', '2-digit year'],
      ['{{MM}}', 'Month (01–12)'],
      ['{{DD}}', 'Day (01–31)'],
      ['{{dddd}}', 'Weekday name'],
      ['{{ddd}}', 'Short weekday'],
      ['{{Q}}', 'Quarter (1–4)'],
      ['{{WW}}', 'ISO week'],
      ['{{MMMM}}', 'Month name'],
      ['{{YYYY-MM-DD}}', 'Date'],
      ['{{YYYY-MM-DD dddd}}', 'Date + weekday'],
      ['{{YYYY-MM}}', 'Year-month'],
    ];
    for (const [token, desc] of tokens) {
      const row = tokenGrid.createDiv('vital-log-token-row');
      row.createEl('code', { text: token });
      row.createEl('span', { text: desc });
    }

    const templatePathRow = createDiv('vital-log-form-row');
    const { toggle: templaterToggle } = createToggleRow(metaSection, {
      label: 'Use Templater',
      value: this.modal.useTemplater,
      onChange: (on) => { templatePathRow.style.display = on ? '' : 'none'; },
    });

    metaSection.appendChild(templatePathRow);
    templatePathRow.createEl('label', { text: 'Template File' });
    const templatePathInput = templatePathRow.createEl('input', {
      type: 'text',
      placeholder: 'Templates/Daily.md',
      value: this.modal.templatePath,
    });
    templatePathRow.style.display = this.modal.useTemplater ? '' : 'none';

    // ── Mirror Mode ──
    const { toggle: mirrorToggle } = createToggleRow(metaSection, {
      label: 'Mirror Mode',
      value: this.modal.mirrorMode ?? false,
      hint: 'Only show properties that already exist in the note. Pin fields below to always show them.',
      onChange: (on) => {
        otherPropsRow.style.display = on ? '' : 'none';
        conditionalPinsWrapper.style.display = on ? '' : 'none';
      },
    });

    const { rowEl: otherPropsRow, toggle: otherPropsToggle } = createToggleRow(metaSection, {
      label: 'Show "Other Properties" section',
      value: this.modal.showOtherProperties ?? false,
      hint: 'Add a collapsed section showing modal fields that are not yet in the note (excludes globally excluded keys).',
    });
    otherPropsRow.style.display = mirrorToggle.getValue() ? '' : 'none';

    // ── Conditional Pins (mirror mode only) ──
    const conditionalPinsWrapper = metaSection.createDiv('vital-log-conditional-pins-wrapper');
    conditionalPinsWrapper.style.display = mirrorToggle.getValue() ? '' : 'none';
    this.renderConditionalPinsList(conditionalPinsWrapper);

    // ── Fields section ──
    const fieldsSection = contentEl.createDiv('vital-log-editor-section');
    fieldsSection.createEl('h3', { text: 'Fields' });

    const fieldListEl = fieldsSection.createDiv('vital-log-item-list');
    this.renderFieldList(fieldListEl);

    // ── Footer actions ──
    const footer = contentEl.createDiv('vital-log-editor-footer');
    const cancelBtn = footer.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    // An explicit Cancel is a deliberate discard — but still worth confirming
    // when there's work to lose, so it routes through the same guard.
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = footer.createEl('button', { text: 'Save Modal', cls: 'vital-log-btn mod-cta' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameError.show('Give this modal a display name — it becomes its command name.');
        nameInput.focus();
        return;
      }
      nameError.clear();

      this.modal.displayName = name;
      this.modal.icon = iconInput.value.trim() || 'file-text';
      this.modal.notePath = pathInput.value.trim();
      this.modal.useTemplater = templaterToggle.getValue();
      this.modal.templatePath = templatePathInput.value.trim();
      this.modal.mirrorMode = mirrorToggle.getValue();
      this.modal.showOtherProperties = mirrorToggle.getValue() ? otherPropsToggle.getValue() : false;

      if (this.isEdit) {
        const idx = this.plugin.settings.customModals.findIndex((m) => m.id === this.modal.id);
        if (idx >= 0) {
          this.plugin.settings.customModals[idx] = this.modal;
        }
      } else {
        this.plugin.settings.customModals.push(this.modal);
      }

      await this.plugin.saveSettings();
      this.plugin.registerCustomModalCommands();
      this.onSaved();
      this.closeWithoutGuard();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderFieldList(fieldListEl: HTMLElement): void {
    fieldListEl.empty();
    const items = this.modal.items;
    const registerFieldRow = makeReorderable(fieldListEl, (from, to) => {
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      this.markTouched();
      this.renderFieldList(fieldListEl);
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = fieldListEl.createDiv('vital-log-item-row');
      registerFieldRow(row, i);
      const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
      setIcon(handle, 'grip-vertical');
      const info = row.createDiv('vital-log-item-info');

      if (item.type === 'field') {
        const field = item.field;
        info.createDiv({ cls: 'vital-log-item-name', text: field.displayName });
        const keyDisplay = field.parentKey ? `${field.parentKey}.${field.propertyKey}` : field.propertyKey;
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${keyDisplay} · ${field.fieldType}${this.getFieldMeta(field)}`,
        });
      } else if (item.type === 'tally') {
        const tc = scalarMetrics(this.plugin.settings).find((t) => t.id === item.tallyCounterId);
        info.createDiv({ cls: 'vital-log-item-name', text: tc?.displayName ?? '(deleted tally)' });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: tc ? `${tc.propertyKey} · tally · target ${tc.target}` : item.tallyCounterId,
        });
      } else if (item.type === 'tracker') {
        const tr = seriesMetrics(this.plugin.settings).find((t) => t.id === item.trackerId);
        info.createDiv({ cls: 'vital-log-item-name', text: tr?.displayName ?? '(deleted tracker)' });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: tr ? `${tr.propertyKey} · tracker · ${tr.trackerType ?? 'rating'}` : item.trackerId,
        });
      } else if (item.type === 'button') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.button.displayName });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `${item.button.buttonType} → ${item.button.target}`,
        });
      } else if (item.type === 'header') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.text });
        info.createDiv({ cls: 'vital-log-item-meta', text: 'header' });
      } else if (item.type === 'divider') {
        info.createDiv({ cls: 'vital-log-item-name', text: '—' });
        info.createDiv({ cls: 'vital-log-item-meta', text: 'divider' });
      } else if (item.type === 'section') {
        info.createDiv({ cls: 'vital-log-item-name', text: item.title });
        info.createDiv({
          cls: 'vital-log-item-meta',
          text: `section · ${item.defaultOpen ? 'open' : 'collapsed'} by default`,
        });
      } else if (item.type === 'section-end') {
        info.createDiv({ cls: 'vital-log-item-name', text: 'End section' });
        info.createDiv({ cls: 'vital-log-item-meta', text: 'section end' });
      }

      const actions = row.createDiv('vital-log-item-actions');

      if (item.type === 'field') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderFieldForm(fieldListEl, item.field, true);
        });
      } else if (item.type === 'button') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderButtonForm(fieldListEl, item.button, true);
        });
      } else if (item.type === 'header') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderHeaderForm(fieldListEl, item as { type: 'header'; text: string }, true);
        });
      } else if (item.type === 'section') {
        const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
        editBtn.addEventListener('click', () => {
          this.renderSectionForm(fieldListEl, item as { type: 'section'; title: string; defaultOpen: boolean; color?: string }, true);
        });
      }

      // Pin button for field/tally/tracker items (controls mirror mode visibility)
      if (item.type === 'field' || item.type === 'tally' || item.type === 'tracker') {
        const itemId = item.type === 'field' ? item.field.id : item.type === 'tally' ? item.tallyCounterId : item.trackerId;
        if (!this.modal.mirrorModePinnedIds) this.modal.mirrorModePinnedIds = [];
        const isPinned = this.modal.mirrorModePinnedIds.includes(itemId);

        const pinBtn = actions.createEl('button', {
          cls: `vital-log-btn vital-log-pin-btn${isPinned ? ' is-pinned' : ''}`,
          title: isPinned ? 'Unpin (remove always-show in Mirror Mode)' : 'Pin (always show in Mirror Mode)',
        });
        setIcon(pinBtn, 'pin');

        pinBtn.addEventListener('click', () => {
          if (!this.modal.mirrorModePinnedIds) this.modal.mirrorModePinnedIds = [];
          const idx = this.modal.mirrorModePinnedIds.indexOf(itemId);
          if (idx >= 0) {
            this.modal.mirrorModePinnedIds.splice(idx, 1);
          } else {
            this.modal.mirrorModePinnedIds.push(itemId);
          }
          this.markTouched();
          this.renderFieldList(fieldListEl);
        });
      }

      const delBtn = actions.createEl('button', {
        cls: 'vital-log-btn mod-warning vital-log-icon-btn',
        attr: { 'aria-label': 'Remove item', title: 'Remove item' },
      });
      setIcon(delBtn, 'x');
      delBtn.addEventListener('click', () => {
        this.modal.items.splice(i, 1);
        this.markTouched();
        this.renderFieldList(fieldListEl);
      });
    }

    if (items.length === 0) {
      fieldListEl.createDiv({ cls: 'vital-log-empty-state', text: 'No items yet. Add fields, tally counters, or buttons below.' });
    }

    const addRow = fieldListEl.createDiv('vital-log-field-add-row');

    const addFieldBtn = addRow.createEl('button', { text: '+ Add Field', cls: 'vital-log-btn mod-cta' });
    addFieldBtn.addEventListener('click', () => {
      const newField: CustomField = {
        id: crypto.randomUUID(),
        propertyKey: '',
        displayName: '',
        description: '',
        fieldType: 'text',
      };
      this.renderFieldForm(fieldListEl, newField, false);
    });

    const allTallies = scalarMetrics(this.plugin.settings);
    const availableTallies = allTallies.filter(
      (tc) => !this.modal.items.some((it) => it.type === 'tally' && it.tallyCounterId === tc.id)
    );
    if (availableTallies.length > 0) {
      const addTallyBtn = addRow.createEl('button', { text: '+ Add Tally Counter', cls: 'vital-log-btn' });
      addTallyBtn.addEventListener('click', () => {
        this.renderTallyPickerForm(fieldListEl, availableTallies);
      });
    } else if (allTallies.length === 0) {
      addRow.createEl('span', {
        cls: 'vital-log-item-meta',
        text: ' \u00b7 No tally counters defined yet. Add them in the Metrics tab.',
      });
    }

    const allTrackers = seriesMetrics(this.plugin.settings);
    const availableTrackers = allTrackers.filter(
      (tr) => !this.modal.items.some((it) => it.type === 'tracker' && it.trackerId === tr.id)
    );
    if (availableTrackers.length > 0) {
      const addTrackerBtn = addRow.createEl('button', { text: '+ Add Tracker', cls: 'vital-log-btn' });
      addTrackerBtn.addEventListener('click', () => {
        this.renderTrackerPickerForm(fieldListEl, availableTrackers);
      });
    } else if (allTrackers.length === 0) {
      addRow.createEl('span', {
        cls: 'vital-log-item-meta',
        text: ' \u00b7 No trackers defined yet. Add them in the Metrics tab.',
      });
    }

    const addButtonBtn = addRow.createEl('button', { text: '+ Add Button', cls: 'vital-log-btn' });
    addButtonBtn.addEventListener('click', () => {
      const newButton: CustomButtonConfig = {
        id: crypto.randomUUID(),
        displayName: '',
        buttonType: 'filelink',
        target: '',
      };
      this.renderButtonForm(fieldListEl, newButton, false);
    });

    const addHeaderBtn = addRow.createEl('button', { text: '+ Add Header', cls: 'vital-log-btn' });
    addHeaderBtn.addEventListener('click', () => {
      this.renderHeaderForm(fieldListEl, { type: 'header', text: '' }, false);
    });

    addRow.createEl('button', { text: '+ Add Divider', cls: 'vital-log-btn' })
      .addEventListener('click', () => {
        this.modal.items.push({ type: 'divider' });
        this.markTouched();
        this.renderFieldList(fieldListEl);
      });

    const addSectionBtn = addRow.createEl('button', { text: '+ Add Section', cls: 'vital-log-btn' });
    addSectionBtn.addEventListener('click', () => {
      this.renderSectionForm(fieldListEl, { type: 'section', title: '', defaultOpen: true }, false);
    });

    addRow.createEl('button', { text: '+ End Section', cls: 'vital-log-btn' })
      .addEventListener('click', () => {
        this.modal.items.push({ type: 'section-end' });
        this.markTouched();
        this.renderFieldList(fieldListEl);
      });
  }

  // ── Conditional Pins (mirror mode) ──────────────────────────

  private renderConditionalPinsList(container: HTMLElement): void {
    container.empty();
    container.createEl('h4', { text: 'Conditional Pins' });
    container.createEl('p', {
      cls: 'vital-log-settings-helper',
      text: 'Always show specific fields when the note matches a tag or folder.',
    });

    const pins = this.modal.mirrorModeConditionalPins ?? [];

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      const row = container.createDiv('vital-log-item-row');
      const info = row.createDiv('vital-log-item-info');
      info.createDiv({
        cls: 'vital-log-item-name',
        text: `${pin.conditionType === 'tag' ? 'Tag' : 'Folder'}: ${pin.conditionValue}`,
      });
      const pinnedLabels = pin.pinnedIds.map((id) => {
        const fieldItem = this.modal.items.find((it) => it.type === 'field' && it.field.id === id);
        if (fieldItem && fieldItem.type === 'field') return fieldItem.field.displayName;
        const tallyConfig = scalarMetrics(this.plugin.settings).find((t) => t.id === id);
        if (tallyConfig) return tallyConfig.displayName;
        return id;
      });
      info.createDiv({ cls: 'vital-log-item-meta', text: pinnedLabels.join(', ') || 'no fields selected' });

      const actions = row.createDiv('vital-log-item-actions');
      const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn' });
      editBtn.addEventListener('click', () => this.renderConditionalPinForm(container, pin, true));

      const delBtn = actions.createEl('button', { text: '×', cls: 'vital-log-btn mod-warning' });
      delBtn.addEventListener('click', () => {
        if (!this.modal.mirrorModeConditionalPins) return;
        this.modal.mirrorModeConditionalPins.splice(i, 1);
        this.markTouched();
        this.renderConditionalPinsList(container);
      });
    }

    if (pins.length === 0) {
      container.createDiv({ cls: 'vital-log-empty-state', text: 'No conditional pin rules yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Condition', cls: 'vital-log-btn mod-cta' });
    addBtn.style.marginTop = '6px';
    addBtn.addEventListener('click', () => {
      const newPin: MirrorConditionalPin = {
        id: crypto.randomUUID(),
        conditionType: 'tag',
        conditionValue: '',
        pinnedIds: [],
      };
      if (!this.modal.mirrorModeConditionalPins) this.modal.mirrorModeConditionalPins = [];
      this.renderConditionalPinForm(container, newPin, false);
    });
  }

  private renderConditionalPinForm(
    container: HTMLElement,
    pin: MirrorConditionalPin,
    isEdit: boolean,
  ): void {
    const form = container.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Condition' : 'New Condition' });

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Condition type' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'tag', text: 'Tag' });
    typeSelect.createEl('option', { value: 'folder', text: 'Folder' });
    typeSelect.value = pin.conditionType;

    const valueRow = form.createDiv('vital-log-form-row');
    const valueLabel = valueRow.createEl('label', { text: 'Tag (e.g. #work)' });
    const valueInput = valueRow.createEl('input', {
      type: 'text',
      placeholder: '#work',
      value: pin.conditionValue,
    });
    const valueError = attachFieldError(valueRow, valueInput);

    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'tag') {
        valueLabel.setText('Tag (e.g. #work)');
        valueInput.placeholder = '#work';
      } else {
        valueLabel.setText('Folder path (e.g. Work/)');
        valueInput.placeholder = 'Work/';
      }
    });

    // Field checkboxes
    form.createEl('label', { text: 'Always show these fields when matched:', cls: 'vital-log-form-section-label' });
    const checkboxList = form.createDiv('vital-log-conditional-pin-fields');

    const fieldItems = this.modal.items.filter(
      (it) => it.type === 'field' || it.type === 'tally',
    ) as Array<Extract<typeof this.modal.items[0], { type: 'field' | 'tally' }>>;

    const selectedIds = new Set(pin.pinnedIds);

    for (const item of fieldItems) {
      const itemId = item.type === 'field' ? item.field.id : item.tallyCounterId;
      const label = item.type === 'field'
        ? item.field.displayName
        : (scalarMetrics(this.plugin.settings).find((t) => t.id === item.tallyCounterId)?.displayName ?? item.tallyCounterId);

      const row = checkboxList.createDiv('vital-log-form-row vital-log-form-row--compact');
      const cb = row.createEl('input', { type: 'checkbox' });
      cb.checked = selectedIds.has(itemId);
      cb.addEventListener('change', () => {
        if (cb.checked) selectedIds.add(itemId);
        else selectedIds.delete(itemId);
      });
      row.createSpan({ text: label });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancel = (): void => { form.remove(); };
    actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
      .addEventListener('click', cancel);

    const save = (): void => {
      const val = valueInput.value.trim();
      if (!val) {
        valueError.show(
          typeSelect.value === 'tag' ? 'Enter a tag, e.g. #work.' : 'Enter a folder path, e.g. Work/.'
        );
        valueInput.focus();
        return;
      }
      valueError.clear();
      pin.conditionType = typeSelect.value as 'tag' | 'folder';
      pin.conditionValue = val;
      pin.pinnedIds = [...selectedIds];
      if (!isEdit) {
        if (!this.modal.mirrorModeConditionalPins) this.modal.mirrorModeConditionalPins = [];
        this.modal.mirrorModeConditionalPins.push(pin);
      }
      form.remove();
      this.renderConditionalPinsList(container);
    };

    actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' })
      .addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }

  private renderTallyPickerForm(fieldListEl: HTMLElement, available: TallyCounterConfig[]): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: 'Add Tally Counter' });

    const row = form.createDiv('vital-log-form-row');
    row.createEl('label', { text: 'Tally Counter' });
    const select = row.createEl('select');
    for (const tc of available) {
      select.createEl('option', { value: tc.id, text: `${tc.displayName} (${tc.propertyKey})` });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const cancel = (): void => { form.remove(); };
    cancelBtn.addEventListener('click', cancel);

    const addBtn = actions.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' });
    const save = (): void => {
      if (!select.value) return;
      const tc = available.find((t) => t.id === select.value);
      this.modal.items.push({ type: 'tally', tallyCounterId: select.value, tallySnapshot: tc ? { ...tc } : undefined });
      this.markTouched();
      form.remove();
      this.renderFieldList(fieldListEl);
    };
    addBtn.addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }

  private renderTrackerPickerForm(fieldListEl: HTMLElement, available: TrackerConfig[]): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: 'Add Tracker' });

    const row = form.createDiv('vital-log-form-row');
    row.createEl('label', { text: 'Tracker' });
    const select = row.createEl('select');
    for (const tr of available) {
      select.createEl('option', { value: tr.id, text: `${tr.displayName} (${tr.propertyKey})` });
    }

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const cancel = (): void => { form.remove(); };
    cancelBtn.addEventListener('click', cancel);

    const addBtn = actions.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' });
    const save = (): void => {
      if (!select.value) return;
      const tr = available.find((t) => t.id === select.value);
      this.modal.items.push({ type: 'tracker', trackerId: select.value, trackerSnapshot: tr ? { ...tr } : undefined });
      this.markTouched();
      form.remove();
      this.renderFieldList(fieldListEl);
    };
    addBtn.addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }

  private renderButtonForm(
    fieldListEl: HTMLElement,
    button: CustomButtonConfig,
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? `Edit: ${button.displayName}` : 'New Button' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Label' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Open Journal',
      value: button.displayName,
    });
    const nameError = attachFieldError(nameRow, nameInput);

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Action' });
    const typeSelect = typeRow.createEl('select');
    typeSelect.createEl('option', { value: 'filelink', text: 'Open file' });
    typeSelect.createEl('option', { value: 'command', text: 'Run command' });
    typeSelect.value = button.buttonType;

    const fileTargetRow = form.createDiv('vital-log-form-row');
    fileTargetRow.createEl('label', { text: 'File path' });
    const fileTargetInput = fileTargetRow.createEl('input', {
      type: 'text',
      placeholder: 'Notes/Journal.md',
      value: button.buttonType === 'filelink' ? button.target : '',
    });
    const fileTargetError = attachFieldError(fileTargetRow, fileTargetInput);

    let selectedCommandId = button.buttonType === 'command' ? button.target : '';
    const registeredCommands = getRegisteredCommands(this.app);
    const commandTargetRow = form.createDiv('vital-log-form-row');
    commandTargetRow.createEl('label', { text: 'Command' });
    const commandPicker = commandTargetRow.createDiv('vital-log-command-picker');
    const commandNameInput = commandPicker.createEl('input', {
      type: 'text',
      placeholder: 'Choose a command',
      value: commandLabel(registeredCommands, selectedCommandId),
      attr: { readonly: 'readonly' },
    });
    const chooseCommandBtn = commandPicker.createEl('button', {
      type: 'button',
      text: selectedCommandId ? 'Change' : 'Choose',
      cls: 'vital-log-btn',
    });
    const commandTargetError = attachFieldError(commandTargetRow, commandNameInput);

    const openCommandPicker = (): void => {
      new CommandPickerModal(this.app, (command) => {
        selectedCommandId = command.id;
        commandNameInput.value = command.name;
        chooseCommandBtn.setText('Change');
        commandTargetError.clear();
        commandNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      }).open();
    };
    commandNameInput.addEventListener('click', openCommandPicker);
    commandNameInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      openCommandPicker();
    });
    chooseCommandBtn.addEventListener('click', openCommandPicker);
    chooseCommandBtn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });

    const updateTargetVisibility = (): void => {
      const isCommand = typeSelect.value === 'command';
      fileTargetRow.style.display = isCommand ? 'none' : '';
      commandTargetRow.style.display = isCommand ? '' : 'none';
      if (isCommand) fileTargetError.clear();
      else commandTargetError.clear();
    };
    updateTargetVisibility();
    typeSelect.addEventListener('change', updateTargetVisibility);

    const iconRow = form.createDiv('vital-log-form-row');
    iconRow.createEl('label', { text: 'Icon (optional)' });
    const iconInput = createIconField(iconRow, {
      placeholder: 'e.g. book-open, terminal',
      value: button.icon ?? '',
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const cancel = (): void => { form.remove(); };
    cancelBtn.addEventListener('click', cancel);

    const saveBtn = actions.createEl('button', { text: 'Save Button', cls: 'vital-log-btn mod-cta' });
    const save = (): void => {
      if (!requireValue(nameInput, nameError, 'Give this button a label.')) return;
      if (typeSelect.value === 'filelink') {
        if (!requireValue(fileTargetInput, fileTargetError, 'Enter the file path this button should open.')) return;
      } else if (!requireValue(commandNameInput, commandTargetError, 'Choose the command this button should run.')) {
        return;
      }

      const name = nameInput.value.trim();
      const target = typeSelect.value === 'filelink'
        ? fileTargetInput.value.trim()
        : selectedCommandId;

      button.displayName = name;
      button.buttonType = typeSelect.value as 'filelink' | 'command';
      button.target = target;
      button.icon = iconInput.value.trim() || undefined;

      if (!isEdit) {
        this.modal.items.push({ type: 'button', button });
      } else {
        const idx = this.modal.items.findIndex((it) => it.type === 'button' && it.button.id === button.id);
        if (idx >= 0) {
          this.modal.items[idx] = { type: 'button', button };
        }
      }

      this.markTouched();
      form.remove();
      this.renderFieldList(fieldListEl);
    };

    saveBtn.addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }

  private renderHeaderForm(
    fieldListEl: HTMLElement,
    item: { type: 'header'; text: string },
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Header' : 'New Header' });

    const textRow = form.createDiv('vital-log-form-row');
    textRow.createEl('label', { text: 'Header Text' });
    const textInput = textRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Morning Routine',
      value: item.text,
    });
    const textError = attachFieldError(textRow, textInput);

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancel = (): void => { form.remove(); };
    actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
      .addEventListener('click', cancel);

    const save = (): void => {
      if (!requireValue(textInput, textError, 'Enter the text for this header.')) return;
      const text = textInput.value.trim();
      if (!isEdit) {
        this.modal.items.push({ type: 'header', text });
      } else {
        item.text = text;
      }
      this.markTouched();
      form.remove();
      this.renderFieldList(fieldListEl);
    };

    actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' })
      .addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }

  private renderSectionForm(
    fieldListEl: HTMLElement,
    item: { type: 'section'; title: string; defaultOpen: boolean; color?: string },
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Section' : 'New Section' });

    const titleRow = form.createDiv('vital-log-form-row');
    titleRow.createEl('label', { text: 'Section Title' });
    const titleInput = titleRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Evening Check-in',
      value: item.title,
    });
    const titleError = attachFieldError(titleRow, titleInput);

    const { toggle: openToggle } = createToggleRow(form, {
      label: 'Expanded by default',
      value: item.defaultOpen,
    });

    const colorRow = form.createDiv('vital-log-form-row');
    colorRow.createEl('label', { text: 'Accent color' });
    const colorInput = colorRow.createEl('input', { type: 'color' });
    colorInput.addClass('vital-log-color-input');
    colorInput.value = item.color ?? '#7c6cfc';
    const clearColorBtn = colorRow.createEl('button', { text: 'None', cls: 'vital-log-btn' });
    let useColor = !!item.color;
    colorInput.style.opacity = useColor ? '1' : '0.4';
    clearColorBtn.addEventListener('click', () => {
      useColor = false;
      colorInput.style.opacity = '0.4';
    });
    colorInput.addEventListener('input', () => {
      useColor = true;
      colorInput.style.opacity = '1';
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancel = (): void => { form.remove(); };
    actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
      .addEventListener('click', cancel);

    const save = (): void => {
      if (!requireValue(titleInput, titleError, 'Give this section a title.')) return;
      const title = titleInput.value.trim();
      const color = useColor ? colorInput.value : undefined;
      if (!isEdit) {
        this.modal.items.push({ type: 'section', title, defaultOpen: openToggle.getValue(), color });
      } else {
        item.title = title;
        item.defaultOpen = openToggle.getValue();
        item.color = color;
      }
      this.markTouched();
      form.remove();
      this.renderFieldList(fieldListEl);
    };

    actions.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' })
      .addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }

  private getFieldMeta(field: CustomField): string {
    const parts: string[] = [];
    if (field.fieldType === 'slider' || field.fieldType === 'rating') {
      parts.push(`${field.min ?? 0}\u2013${field.max ?? 10}`);
    }
    if (field.fieldType === 'dropdown' && field.options?.length) {
      parts.push(`${field.options.length} options`);
    }
    return parts.length > 0 ? ` \u00b7 ${parts.join(' \u00b7 ')}` : '';
  }

  private renderFieldForm(
    fieldListEl: HTMLElement,
    field: CustomField,
    isEdit: boolean
  ): void {
    const form = fieldListEl.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? `Edit: ${field.displayName}` : 'New Field' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Day Review',
      value: field.displayName,
    });
    const nameError = attachFieldError(nameRow, nameInput);

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. dayReview',
      value: field.propertyKey,
    });
    const keyError = attachFieldError(keyRow, keyInput);

    if (!isEdit) {
      nameInput.addEventListener('input', () => {
        keyInput.value = slugify(nameInput.value);
      });
    }

    const parentKeyRow = form.createDiv('vital-log-form-row');
    parentKeyRow.createEl('label', { text: 'Nest under key (optional)' });
    const parentKeyInput = parentKeyRow.createEl('input', {
      type: 'text',
      placeholder: 'e.g. health → writes health.propertyKey',
      value: field.parentKey ?? '',
    });

    const descRow = form.createDiv('vital-log-form-row');
    descRow.createEl('label', { text: 'Description' });
    const descInput = descRow.createEl('input', {
      type: 'text',
      placeholder: 'Helper text shown below the label',
      value: field.description,
    });

    const typeRow = form.createDiv('vital-log-form-row');
    typeRow.createEl('label', { text: 'Field Type' });
    const typeSelect = typeRow.createEl('select');
    for (const t of CUSTOM_FIELD_TYPES) {
      const opt = typeSelect.createEl('option', { value: t, text: t });
      if (t === field.fieldType) opt.selected = true;
    }

    const typeOptionsEl = form.createDiv('vital-log-type-options');
    const renderTypeOptions = (type: CustomFieldType) => {
      typeOptionsEl.empty();

      if (type === 'slider' || type === 'rating' || type === 'number') {
        const minRow = typeOptionsEl.createDiv('vital-log-form-row');
        minRow.createEl('label', { text: 'Min' });
        const minInput = minRow.createEl('input', {
          type: 'number',
          value: String(field.min ?? (type === 'slider' ? 0 : 1)),
        });
        minInput.dataset.field = 'min';

        const maxRow = typeOptionsEl.createDiv('vital-log-form-row');
        maxRow.createEl('label', { text: 'Max' });
        const maxInput = maxRow.createEl('input', {
          type: 'number',
          value: String(field.max ?? (type === 'slider' ? 10 : 5)),
        });
        maxInput.dataset.field = 'max';

        if (type === 'slider') {
          const stepRow = typeOptionsEl.createDiv('vital-log-form-row');
          stepRow.createEl('label', { text: 'Step' });
          const stepInput = stepRow.createEl('input', {
            type: 'number',
            value: String(field.step ?? 1),
          });
          stepInput.dataset.field = 'step';
        }
      }

      if (type === 'dropdown') {
        const optRow = typeOptionsEl.createDiv('vital-log-form-row');
        optRow.createEl('label', { text: 'Options' });
        const optInput = optRow.createEl('input', {
          type: 'text',
          placeholder: 'Comma-separated: sunny, cloudy, rainy',
          value: (field.options ?? []).join(', '),
        });
        optInput.dataset.field = 'options';
      }
    };

    renderTypeOptions(field.fieldType);
    typeSelect.addEventListener('change', () => {
      renderTypeOptions(typeSelect.value as CustomFieldType);
    });

    const actions = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const cancel = (): void => { form.remove(); };
    cancelBtn.addEventListener('click', cancel);

    const saveBtn = actions.createEl('button', { text: 'Save Field', cls: 'vital-log-btn mod-cta' });
    const save = (): void => {
      if (!requireValue(nameInput, nameError, 'Give this field a display name.')) return;
      if (!requireValue(keyInput, keyError, 'Enter the frontmatter key this field writes to.')) return;

      const name = nameInput.value.trim();
      const key = keyInput.value.trim();

      field.displayName = name;
      field.propertyKey = key;
      field.parentKey = parentKeyInput.value.trim() || undefined;
      field.description = descInput.value.trim();
      field.fieldType = typeSelect.value as CustomFieldType;

      const minEl = typeOptionsEl.querySelector('[data-field="min"]') as HTMLInputElement | null;
      const maxEl = typeOptionsEl.querySelector('[data-field="max"]') as HTMLInputElement | null;
      const stepEl = typeOptionsEl.querySelector('[data-field="step"]') as HTMLInputElement | null;
      const optionsEl = typeOptionsEl.querySelector('[data-field="options"]') as HTMLInputElement | null;

      field.min = minEl ? parseFloat(minEl.value) : undefined;
      field.max = maxEl ? parseFloat(maxEl.value) : undefined;
      field.step = stepEl ? parseFloat(stepEl.value) : undefined;
      field.options = optionsEl
        ? optionsEl.value.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

      if (!isEdit) {
        this.modal.items.push({ type: 'field', field });
      } else {
        // Update in place
        const idx = this.modal.items.findIndex((it) => it.type === 'field' && it.field.id === field.id);
        if (idx >= 0) {
          this.modal.items[idx] = { type: 'field', field };
        }
      }

      this.markTouched();
      form.remove();
      this.renderFieldList(fieldListEl);
    };

    saveBtn.addEventListener('click', save);
    initInlineForm(form, { onSave: save, onCancel: cancel });
  }
}
