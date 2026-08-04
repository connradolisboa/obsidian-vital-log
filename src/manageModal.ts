// ============================================================
// Vital Log — Manage Modal
// CRUD UI for vitamins, packs, and stacks.
// Delegates persistence to saveSettings callback.
// ============================================================

import { App, Notice, setIcon } from 'obsidian';
import type {
  VitalLogSettings,
  Vitamin,
  Pack,
  Stack,
  PackItem,
  StackItemType,
} from './types';
import { SCHEDULING_HINTS } from './types';
import { confirm } from './confirmModal';
import { validatePropertyKey, allKeyOwners } from './validation';
import { makeReorderable } from './dragReorder';
import {
  GuardedModal,
  attachFieldError,
  guardUnsaved,
  hasDirtyForm,
  initInlineForm,
  requireValue,
} from './formUI';

export type ManageTab = 'vitamins' | 'packs' | 'stacks';

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function slugify(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Move `list[from]` to index `to`, mapping positions in a filtered view onto the full array. */
function moveWithin<T>(full: T[], view: T[], from: number, to: number): void {
  const fromIdx = full.indexOf(view[from]);
  const toIdx = full.indexOf(view[to]);
  if (fromIdx === -1 || toIdx === -1) return;
  const [moved] = full.splice(fromIdx, 1);
  full.splice(toIdx, 0, moved);
}

/** A grip icon marking the row as draggable. */
function addDragHandle(row: HTMLElement): void {
  const handle = row.createDiv({ cls: 'vital-log-drag-handle' });
  setIcon(handle, 'grip-vertical');
  handle.setAttribute('aria-label', 'Drag to reorder');
}

/** An icon-only action button carrying an accessible name. */
function iconButton(
  parent: HTMLElement,
  opts: { icon: string; label: string; cls?: string }
): HTMLButtonElement {
  const btn = parent.createEl('button', {
    cls: `vital-log-btn mod-compact vital-log-icon-btn${opts.cls ? ' ' + opts.cls : ''}`,
    attr: { 'aria-label': opts.label, title: opts.label },
  });
  setIcon(btn, opts.icon);
  return btn;
}

export class ManageModal extends GuardedModal {
  private settings: VitalLogSettings;
  private saveSettings: () => Promise<void>;
  private activeTab: ManageTab;

  constructor(
    app: App,
    settings: VitalLogSettings,
    saveSettings: () => Promise<void>,
    initialTab: ManageTab = 'vitamins'
  ) {
    super(app);
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.activeTab = initialTab;
  }

  onOpen(): void {
    this.contentEl.addClass('vital-log-modal');
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  protected hasUnsavedWork(): boolean {
    return hasDirtyForm(this.contentEl);
  }

  /** Run `action` unless an open form has edits the user would rather keep. */
  private guarded(action: () => void | Promise<void>): Promise<void> {
    return guardUnsaved(this.app, this.contentEl, action);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Manage Vitamins / Packs / Stacks' });

    // ── Tab bar ────────────────────────────────────────────
    const tabBar = contentEl.createDiv('vital-log-tabs');
    (['vitamins', 'packs', 'stacks'] as ManageTab[]).forEach((tab) => {
      const btn = tabBar.createEl('button', {
        text: tab.charAt(0).toUpperCase() + tab.slice(1),
        cls: 'vital-log-tab' + (this.activeTab === tab ? ' is-active' : ''),
      });
      btn.addEventListener('click', () => {
        void this.guarded(() => {
          this.activeTab = tab;
          this.render();
        });
      });
    });

    // ── Tab content ────────────────────────────────────────
    const body = contentEl.createDiv();
    if (this.activeTab === 'vitamins') this.renderVitaminsTab(body);
    else if (this.activeTab === 'packs') this.renderPacksTab(body);
    else this.renderStacksTab(body);
  }

  // ════════════════════════════════════════════════════════════
  // VITAMINS TAB
  // ════════════════════════════════════════════════════════════

  private renderVitaminsTab(container: HTMLElement): void {
    const active = this.settings.vitamins.filter((v) => !v.archived);
    const archived = this.settings.vitamins.filter((v) => v.archived);

    const list = container.createDiv('vital-log-item-list');
    const registerRow = makeReorderable(list, async (from, to) => {
      moveWithin(this.settings.vitamins, active, from, to);
      await this.saveSettings();
      this.render();
    });
    for (let i = 0; i < active.length; i++) {
      this.renderVitaminRow(list, active[i], i, registerRow);
    }
    if (active.length === 0) {
      list.createDiv({ cls: 'vital-log-empty-state', text: 'No vitamins yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Vitamin', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      addBtn.remove();
      this.renderVitaminForm(container, null);
    });

    if (archived.length > 0) {
      const details = container.createEl('details', { cls: 'vital-log-archived-section' });
      details.createEl('summary', { text: `Archived (${archived.length})` });
      const archivedList = details.createDiv('vital-log-item-list');
      for (const vit of archived) {
        this.renderArchivedVitaminRow(archivedList, vit);
      }
    }
  }

  private renderVitaminRow(
    container: HTMLElement,
    vit: Vitamin,
    index: number,
    registerRow: (row: HTMLElement, index: number) => void
  ): void {
    const row = container.createDiv('vital-log-item-row');
    registerRow(row, index);
    addDragHandle(row);

    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: vit.displayName });
    info.createDiv({
      cls: 'vital-log-item-meta',
      text: `key: ${vit.propertyKey}  |  default: ${vit.defaultAmount} ${vit.unit}`,
    });

    const actions = row.createDiv('vital-log-item-actions');

    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn mod-compact' });
    const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn mod-compact' });

    editBtn.addEventListener('click', () => {
      void this.guarded(() => {
        const form = createDiv();
        row.replaceWith(form);
        this.renderVitaminForm(form, vit);
      });
    });

    archiveBtn.addEventListener('click', () => {
      void this.guarded(async () => {
        const ok = await confirm(this.app, {
          title: 'Archive vitamin',
          message: `Archive "${vit.displayName}"? It won't appear in the vitamin picker but pack and stack references keep working. You can restore it any time.`,
          confirmText: 'Archive',
          destructive: false,
        });
        if (!ok) return;
        vit.archived = true;
        await this.saveSettings();
        this.render();
      });
    });
  }

  private renderArchivedVitaminRow(container: HTMLElement, vit: Vitamin): void {
    const row = container.createDiv('vital-log-item-row vital-log-item-row--archived');
    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: vit.displayName });
    info.createDiv({
      cls: 'vital-log-item-meta',
      text: `key: ${vit.propertyKey}  |  default: ${vit.defaultAmount} ${vit.unit}`,
    });

    const actions = row.createDiv('vital-log-item-actions');

    const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn mod-compact' });
    restoreBtn.addEventListener('click', async () => {
      delete vit.archived;
      await this.saveSettings();
      this.render();
    });

    const delBtn = iconButton(actions, { icon: 'trash-2', label: 'Delete', cls: 'mod-warning' });
    delBtn.addEventListener('click', async () => {
      const usedInPacks = this.settings.packs.filter((p) =>
        p.items.some((i) => i.vitaminId === vit.id)
      );
      const usedInStacks = this.settings.stacks.filter((s) =>
        s.items.some((i) => i.type === 'vitamin' && i.vitaminId === vit.id)
      );
      const refs = [
        ...usedInPacks.map((p) => `pack "${p.displayName}"`),
        ...usedInStacks.map((s) => `stack "${s.displayName}"`),
      ];
      if (refs.length > 0) {
        new Notice(
          `Vital Log: "${vit.displayName}" is used in ${refs.join(', ')}. Remove it from those first.`
        );
        return;
      }
      const ok = await confirm(this.app, {
        title: 'Delete vitamin',
        message: `Delete "${vit.displayName}"? This removes it from your library — previously logged entries are not affected.`,
        confirmText: 'Delete',
      });
      if (!ok) return;
      this.settings.vitamins = this.settings.vitamins.filter((v) => v.id !== vit.id);
      this.saveSettings().then(() => this.render());
    });
  }

  private renderVitaminForm(container: HTMLElement, vit: Vitamin | null): void {
    const isEdit = vit !== null;
    const form = container.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Vitamin' : 'Add Vitamin' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Display Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', value: vit?.displayName ?? '' });
    nameInput.placeholder = 'e.g. Vitamin C';
    const nameError = attachFieldError(nameRow, nameInput);

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', value: vit?.propertyKey ?? '' });
    const keyError = attachFieldError(keyRow, keyInput);

    const owners = allKeyOwners(this.settings);
    const showKeyError = (): boolean => {
      const err = validatePropertyKey(keyInput.value.trim(), owners, isEdit ? vit!.id : undefined);
      if (err) keyError.show(err);
      else keyError.clear();
      return err === null;
    };
    keyInput.addEventListener('input', showKeyError);

    if (!isEdit) {
      nameInput.addEventListener('input', () => {
        keyInput.value = slugify(nameInput.value);
        showKeyError();
      });
    }

    const amtRow = form.createDiv('vital-log-form-row');
    amtRow.createEl('label', { text: 'Default Amount' });
    const amtInput = amtRow.createEl('input', { type: 'number', value: String(vit?.defaultAmount ?? '') });
    amtInput.placeholder = 'e.g. 500';
    const amtError = attachFieldError(amtRow, amtInput);

    const unitRow = form.createDiv('vital-log-form-row');
    unitRow.createEl('label', { text: 'Unit' });
    const unitInput = unitRow.createEl('input', { type: 'text', value: vit?.unit ?? '' });
    unitInput.placeholder = 'mg, IU, mcg…';
    const unitError = attachFieldError(unitRow, unitInput);

    const actionsEl = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actionsEl.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    const cancel = (): void => { form.remove(); this.render(); };

    const save = async (): Promise<void> => {
      if (!requireValue(nameInput, nameError, 'Give this vitamin a display name.')) return;
      if (!showKeyError()) { keyInput.focus(); return; }

      const amount = parseFloat(amtInput.value);
      if (isNaN(amount) || amount <= 0) {
        amtError.show('Enter an amount greater than zero.');
        amtInput.focus();
        return;
      }
      amtError.clear();
      if (!requireValue(unitInput, unitError, 'Enter a unit, e.g. mg or IU.')) return;

      if (isEdit) {
        const existing = this.settings.vitamins.find((v) => v.id === vit!.id);
        if (existing) {
          existing.displayName = nameInput.value.trim();
          existing.propertyKey = keyInput.value.trim();
          existing.defaultAmount = amount;
          existing.unit = unitInput.value.trim();
        }
      } else {
        this.settings.vitamins.push({
          id: nanoid(),
          displayName: nameInput.value.trim(),
          propertyKey: keyInput.value.trim(),
          defaultAmount: amount,
          unit: unitInput.value.trim(),
        });
      }

      await this.saveSettings();
      this.render();
    };

    cancelBtn.addEventListener('click', cancel);
    saveBtn.addEventListener('click', () => void save());
    initInlineForm(form, { onSave: () => void save(), onCancel: cancel });
  }

  // ════════════════════════════════════════════════════════════
  // PACKS TAB
  // ════════════════════════════════════════════════════════════

  private renderPacksTab(container: HTMLElement): void {
    const active = this.settings.packs.filter((p) => !p.archived);
    const archived = this.settings.packs.filter((p) => p.archived);

    const list = container.createDiv('vital-log-item-list');
    const registerRow = makeReorderable(list, async (from, to) => {
      moveWithin(this.settings.packs, active, from, to);
      await this.saveSettings();
      this.render();
    });
    for (let i = 0; i < active.length; i++) {
      this.renderPackRow(list, active[i], i, registerRow);
    }
    if (active.length === 0) {
      list.createDiv({ cls: 'vital-log-empty-state', text: 'No packs yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Pack', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      addBtn.remove();
      this.renderPackForm(container, null);
    });

    if (archived.length > 0) {
      const details = container.createEl('details', { cls: 'vital-log-archived-section' });
      details.createEl('summary', { text: `Archived (${archived.length})` });
      const archivedList = details.createDiv('vital-log-item-list');
      for (const pack of archived) {
        this.renderArchivedPackRow(archivedList, pack);
      }
    }
  }

  private renderPackRow(
    container: HTMLElement,
    pack: Pack,
    index: number,
    registerRow: (row: HTMLElement, index: number) => void
  ): void {
    const wrapper = container.createDiv();
    const row = wrapper.createDiv('vital-log-item-row');
    registerRow(row, index);
    addDragHandle(row);

    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: pack.displayName });
    info.createDiv({ cls: 'vital-log-item-meta', text: `${pack.items.length} vitamin(s)` });

    const actions = row.createDiv('vital-log-item-actions');

    let expanded = false;
    const expandBtn = iconButton(actions, { icon: 'chevron-right', label: 'Show contents' });
    const subRows = wrapper.createDiv('vital-log-sub-rows');
    subRows.style.display = 'none';

    pack.items.forEach((item) => {
      const vit = this.settings.vitamins.find((v) => v.id === item.vitaminId);
      subRows.createDiv({
        cls: 'vital-log-sub-row',
        text: vit ? `${vit.displayName}: ${item.amount} ${vit.unit}` : `(deleted): ${item.amount}`,
      });
    });

    expandBtn.addEventListener('click', () => {
      expanded = !expanded;
      subRows.style.display = expanded ? 'block' : 'none';
      setIcon(expandBtn, expanded ? 'chevron-down' : 'chevron-right');
      const label = expanded ? 'Hide contents' : 'Show contents';
      expandBtn.setAttribute('aria-label', label);
      expandBtn.title = label;
    });

    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn mod-compact' });
    const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn mod-compact' });

    editBtn.addEventListener('click', () => {
      void this.guarded(() => {
        wrapper.remove();
        this.renderPackForm(container, pack);
      });
    });

    archiveBtn.addEventListener('click', () => {
      void this.guarded(async () => {
        const ok = await confirm(this.app, {
          title: 'Archive pack',
          message: `Archive "${pack.displayName}"? It won't appear in the pack picker but stack references keep working. You can restore it any time.`,
          confirmText: 'Archive',
          destructive: false,
        });
        if (!ok) return;
        pack.archived = true;
        await this.saveSettings();
        this.render();
      });
    });
  }

  private renderArchivedPackRow(container: HTMLElement, pack: Pack): void {
    const row = container.createDiv('vital-log-item-row vital-log-item-row--archived');
    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: pack.displayName });
    info.createDiv({ cls: 'vital-log-item-meta', text: `${pack.items.length} vitamin(s)` });

    const actions = row.createDiv('vital-log-item-actions');

    const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn mod-compact' });
    restoreBtn.addEventListener('click', async () => {
      delete pack.archived;
      await this.saveSettings();
      this.render();
    });

    const delBtn = iconButton(actions, { icon: 'trash-2', label: 'Delete', cls: 'mod-warning' });
    delBtn.addEventListener('click', async () => {
      const usedInStacks = this.settings.stacks.filter((s) =>
        s.items.some((i) => i.type === 'pack' && i.packId === pack.id)
      );
      if (usedInStacks.length > 0) {
        new Notice(
          `Vital Log: Pack "${pack.displayName}" is used in: ` +
          `${usedInStacks.map((s) => `"${s.displayName}"`).join(', ')}. ` +
          `Remove it from those stacks first.`
        );
        return;
      }
      const ok = await confirm(this.app, {
        title: 'Delete pack',
        message: `Delete pack "${pack.displayName}"? Its ${pack.items.length} item(s) stay in your vitamin library.`,
        confirmText: 'Delete',
      });
      if (!ok) return;
      this.settings.packs = this.settings.packs.filter((p) => p.id !== pack.id);
      this.saveSettings().then(() => this.render());
    });
  }

  private renderPackForm(container: HTMLElement, pack: Pack | null): void {
    const isEdit = pack !== null;
    const form = container.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Pack' : 'Add Pack' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Pack Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', value: pack?.displayName ?? '' });
    nameInput.placeholder = 'e.g. Morning Vitamins';
    const nameError = attachFieldError(nameRow, nameInput);

    form.createEl('p', { text: 'Vitamins:', cls: 'vital-log-item-meta' });
    const itemsContainer = form.createDiv('vital-log-pack-items');
    const itemsError = attachFieldError(itemsContainer);

    const currentItems: Array<{ vitaminId: string; amount: number }> = pack
      ? pack.items.map((i) => ({ ...i }))
      : [];

    const renderItems = (): void => {
      itemsContainer.empty();
      currentItems.forEach((item, idx) => {
        const row = itemsContainer.createDiv('vital-log-pack-item-row');
        const sel = row.createEl('select');
        sel.setAttribute('aria-label', 'Vitamin');
        sel.createEl('option', { value: '', text: '— select vitamin —' });
        // Show all non-archived vitamins, plus the currently-selected one even if archived
        this.settings.vitamins
          .filter((v) => !v.archived || v.id === item.vitaminId)
          .forEach((v) => {
            const opt = sel.createEl('option', { value: v.id, text: v.displayName });
            if (v.id === item.vitaminId) opt.selected = true;
          });

        const amtInput = row.createEl('input', { type: 'number', value: String(item.amount || '') });
        amtInput.placeholder = 'amount';
        amtInput.setAttribute('aria-label', 'Amount');

        sel.addEventListener('change', () => {
          currentItems[idx].vitaminId = sel.value;
          const vit = this.settings.vitamins.find((v) => v.id === sel.value);
          if (vit && currentItems[idx].amount === 0) {
            currentItems[idx].amount = vit.defaultAmount;
            amtInput.value = String(vit.defaultAmount);
          }
        });
        amtInput.addEventListener('input', () => {
          currentItems[idx].amount = parseFloat(amtInput.value) || 0;
        });

        const rmBtn = iconButton(row, { icon: 'x', label: 'Remove vitamin', cls: 'mod-warning' });
        rmBtn.addEventListener('click', () => { currentItems.splice(idx, 1); renderItems(); });
      });
    };

    renderItems();

    const addItemBtn = form.createEl('button', { text: '+ Add Vitamin', cls: 'vital-log-btn' });
    addItemBtn.addEventListener('click', () => {
      currentItems.push({ vitaminId: '', amount: 0 });
      renderItems();
      itemsError.clear();
    });

    const actionsEl = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actionsEl.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    const cancel = (): void => { form.remove(); this.render(); };

    const save = async (): Promise<void> => {
      if (!requireValue(nameInput, nameError, 'Give this pack a name.')) return;

      const validItems = currentItems.filter((i) => i.vitaminId && i.amount > 0);
      if (validItems.length === 0) {
        itemsError.show('Add at least one vitamin with an amount greater than zero.');
        return;
      }
      itemsError.clear();

      if (isEdit) {
        const existing = this.settings.packs.find((p) => p.id === pack!.id);
        if (existing) {
          existing.displayName = nameInput.value.trim();
          existing.items = validItems as PackItem[];
        }
      } else {
        this.settings.packs.push({
          id: nanoid(),
          displayName: nameInput.value.trim(),
          items: validItems as PackItem[],
        });
      }

      await this.saveSettings();
      this.render();
    };

    cancelBtn.addEventListener('click', cancel);
    saveBtn.addEventListener('click', () => void save());
    initInlineForm(form, { onSave: () => void save(), onCancel: cancel });
  }

  // ════════════════════════════════════════════════════════════
  // STACKS TAB
  // ════════════════════════════════════════════════════════════

  private renderStacksTab(container: HTMLElement): void {
    const active = this.settings.stacks.filter((s) => !s.archived);
    const archived = this.settings.stacks.filter((s) => s.archived);

    const list = container.createDiv('vital-log-item-list');
    const registerRow = makeReorderable(list, async (from, to) => {
      moveWithin(this.settings.stacks, active, from, to);
      await this.saveSettings();
      this.render();
    });
    for (let i = 0; i < active.length; i++) {
      this.renderStackRow(list, active[i], i, registerRow);
    }
    if (active.length === 0) {
      list.createDiv({ cls: 'vital-log-empty-state', text: 'No stacks yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Stack', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      addBtn.remove();
      this.renderStackForm(container, null);
    });

    if (archived.length > 0) {
      const details = container.createEl('details', { cls: 'vital-log-archived-section' });
      details.createEl('summary', { text: `Archived (${archived.length})` });
      const archivedList = details.createDiv('vital-log-item-list');
      for (const stack of archived) {
        this.renderArchivedStackRow(archivedList, stack);
      }
    }
  }

  private renderStackRow(
    container: HTMLElement,
    stack: Stack,
    index: number,
    registerRow: (row: HTMLElement, index: number) => void
  ): void {
    const row = container.createDiv('vital-log-item-row');
    registerRow(row, index);
    addDragHandle(row);

    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: stack.displayName });
    info.createDiv({
      cls: 'vital-log-item-meta',
      text: `${stack.schedulingHint}  |  ${stack.items.length} item(s)`,
    });

    const actions = row.createDiv('vital-log-item-actions');

    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn mod-compact' });
    const archiveBtn = actions.createEl('button', { text: 'Archive', cls: 'vital-log-btn mod-compact' });

    editBtn.addEventListener('click', () => {
      void this.guarded(() => {
        row.remove();
        this.renderStackForm(container, stack);
      });
    });

    archiveBtn.addEventListener('click', () => {
      void this.guarded(async () => {
        const ok = await confirm(this.app, {
          title: 'Archive stack',
          message: `Archive "${stack.displayName}"? It won't appear in the stack picker. You can restore it any time.`,
          confirmText: 'Archive',
          destructive: false,
        });
        if (!ok) return;
        stack.archived = true;
        await this.saveSettings();
        this.render();
      });
    });
  }

  private renderArchivedStackRow(container: HTMLElement, stack: Stack): void {
    const row = container.createDiv('vital-log-item-row vital-log-item-row--archived');
    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: stack.displayName });
    info.createDiv({
      cls: 'vital-log-item-meta',
      text: `${stack.schedulingHint}  |  ${stack.items.length} item(s)`,
    });

    const actions = row.createDiv('vital-log-item-actions');

    const restoreBtn = actions.createEl('button', { text: 'Restore', cls: 'vital-log-btn mod-compact' });
    restoreBtn.addEventListener('click', async () => {
      delete stack.archived;
      await this.saveSettings();
      this.render();
    });

    const delBtn = iconButton(actions, { icon: 'trash-2', label: 'Delete', cls: 'mod-warning' });
    delBtn.addEventListener('click', async () => {
      const ok = await confirm(this.app, {
        title: 'Delete stack',
        message: `Delete stack "${stack.displayName}"? Its packs and vitamins stay in your library.`,
        confirmText: 'Delete',
      });
      if (!ok) return;
      this.settings.stacks = this.settings.stacks.filter((s) => s.id !== stack.id);
      this.saveSettings().then(() => this.render());
    });
  }

  private renderStackForm(container: HTMLElement, stack: Stack | null): void {
    const isEdit = stack !== null;
    const form = container.createDiv('vital-log-inline-form');
    form.createEl('h4', { text: isEdit ? 'Edit Stack' : 'Add Stack' });

    const nameRow = form.createDiv('vital-log-form-row');
    nameRow.createEl('label', { text: 'Stack Name' });
    const nameInput = nameRow.createEl('input', { type: 'text', value: stack?.displayName ?? '' });
    nameInput.placeholder = 'e.g. Morning Stack';
    const nameError = attachFieldError(nameRow, nameInput);

    const hintRow = form.createDiv('vital-log-form-row');
    hintRow.createEl('label', { text: 'Scheduling Hint' });
    const hintSel = hintRow.createEl('select');
    SCHEDULING_HINTS.forEach((h) => {
      const opt = hintSel.createEl('option', { value: h, text: h });
      if (h === (stack?.schedulingHint ?? 'Morning')) opt.selected = true;
    });

    form.createEl('p', { text: 'Items:', cls: 'vital-log-item-meta' });
    const itemsContainer = form.createDiv('vital-log-pack-items');
    const itemsError = attachFieldError(itemsContainer);

    type MutableStackItem =
      | { type: 'pack'; packId: string }
      | { type: 'vitamin'; vitaminId: string; amount: number };

    const currentItems: MutableStackItem[] = stack
      ? stack.items.map((i): MutableStackItem =>
          i.type === 'pack'
            ? { type: 'pack', packId: i.packId }
            : { type: 'vitamin', vitaminId: i.vitaminId, amount: i.amount ?? 0 }
        )
      : [];

    const renderStackItems = (): void => {
      itemsContainer.empty();
      currentItems.forEach((item, idx) => {
        const row = itemsContainer.createDiv('vital-log-pack-item-row');

        const typeSel = row.createEl('select', { cls: 'vital-log-pack-item-type' });
        typeSel.setAttribute('aria-label', 'Item type');
        const packOpt = typeSel.createEl('option', { value: 'pack', text: 'Pack' });
        const vitOpt = typeSel.createEl('option', { value: 'vitamin', text: 'Vitamin' });
        if (item.type === 'pack') packOpt.selected = true;
        else vitOpt.selected = true;

        const pickerSel = row.createEl('select');
        pickerSel.setAttribute('aria-label', 'Item');

        const renderPickerOptions = (type: 'pack' | 'vitamin', selectedId: string): void => {
          pickerSel.empty();
          pickerSel.createEl('option', { value: '', text: '— select —' });
          if (type === 'pack') {
            // Show non-archived packs, plus the currently-selected one even if archived
            this.settings.packs
              .filter((p) => !p.archived || p.id === selectedId)
              .forEach((p) => {
                const opt = pickerSel.createEl('option', { value: p.id, text: p.displayName });
                if (p.id === selectedId) opt.selected = true;
              });
          } else {
            // Show non-archived vitamins, plus the currently-selected one even if archived
            this.settings.vitamins
              .filter((v) => !v.archived || v.id === selectedId)
              .forEach((v) => {
                const opt = pickerSel.createEl('option', { value: v.id, text: v.displayName });
                if (v.id === selectedId) opt.selected = true;
              });
          }
        };

        renderPickerOptions(
          item.type,
          item.type === 'pack' ? item.packId : item.vitaminId
        );

        const amtInput = row.createEl('input', { type: 'number' });
        amtInput.placeholder = 'amount';
        amtInput.setAttribute('aria-label', 'Amount');
        amtInput.style.display = item.type === 'vitamin' ? '' : 'none';
        if (item.type === 'vitamin') amtInput.value = String(item.amount || '');

        typeSel.addEventListener('change', () => {
          const newType = typeSel.value as 'pack' | 'vitamin';
          if (newType === 'pack') {
            currentItems[idx] = { type: 'pack', packId: '' };
            amtInput.style.display = 'none';
          } else {
            currentItems[idx] = { type: 'vitamin', vitaminId: '', amount: 0 };
            amtInput.style.display = '';
            amtInput.value = '';
          }
          renderPickerOptions(newType, '');
        });

        pickerSel.addEventListener('change', () => {
          const cur = currentItems[idx];
          if (cur.type === 'pack') {
            cur.packId = pickerSel.value;
          } else {
            cur.vitaminId = pickerSel.value;
            const vit = this.settings.vitamins.find((v) => v.id === pickerSel.value);
            if (vit && cur.amount === 0) {
              cur.amount = vit.defaultAmount;
              amtInput.value = String(vit.defaultAmount);
            }
          }
        });

        amtInput.addEventListener('input', () => {
          const cur = currentItems[idx];
          if (cur.type === 'vitamin') {
            cur.amount = parseFloat(amtInput.value) || 0;
          }
        });

        const rmBtn = iconButton(row, { icon: 'x', label: 'Remove item', cls: 'mod-warning' });
        rmBtn.addEventListener('click', () => { currentItems.splice(idx, 1); renderStackItems(); });
      });
    };

    renderStackItems();

    const addItemBtn = form.createEl('button', { text: '+ Add Item', cls: 'vital-log-btn' });
    addItemBtn.addEventListener('click', () => {
      currentItems.push({ type: 'pack', packId: '' });
      renderStackItems();
      itemsError.clear();
    });

    const actionsEl = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actionsEl.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    const cancel = (): void => { form.remove(); this.render(); };

    const save = async (): Promise<void> => {
      if (!requireValue(nameInput, nameError, 'Give this stack a name.')) return;

      const validItems: StackItemType[] = currentItems
        .filter((i) => (i.type === 'pack' ? i.packId : i.vitaminId))
        .map((i): StackItemType =>
          i.type === 'pack'
            ? { type: 'pack', packId: i.packId }
            : { type: 'vitamin', vitaminId: i.vitaminId, amount: i.amount || undefined }
        );

      if (validItems.length === 0) {
        itemsError.show('Add at least one pack or vitamin to this stack.');
        return;
      }
      itemsError.clear();

      if (isEdit) {
        const existing = this.settings.stacks.find((s) => s.id === stack!.id);
        if (existing) {
          existing.displayName = nameInput.value.trim();
          existing.schedulingHint = hintSel.value;
          existing.items = validItems;
        }
      } else {
        this.settings.stacks.push({
          id: nanoid(),
          displayName: nameInput.value.trim(),
          schedulingHint: hintSel.value,
          items: validItems,
        });
      }

      await this.saveSettings();
      this.render();
    };

    cancelBtn.addEventListener('click', cancel);
    saveBtn.addEventListener('click', () => void save());
    initInlineForm(form, { onSave: () => void save(), onCancel: cancel });
  }
}
