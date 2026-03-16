// ============================================================
// Vital Log — Manage Modal
// CRUD UI for vitamins, packs, and stacks.
// Delegates persistence to saveSettings callback.
// ============================================================

import { App, Modal, Notice } from 'obsidian';
import type {
  VitalLogSettings,
  Vitamin,
  Pack,
  Stack,
  PackItem,
  StackItemType,
} from './types';
import { SCHEDULING_HINTS } from './types';

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

function validatePropertyKey(key: string, vitamins: Vitamin[], excludeId?: string): string | null {
  if (!key) return 'Property key cannot be empty.';
  if (/\s/.test(key)) return 'Property key must not contain spaces.';
  if (!/^[a-zA-Z0-9_]+$/.test(key)) return 'Property key may only contain letters, numbers, and underscores.';
  const collision = vitamins.find((v) => v.propertyKey === key && v.id !== excludeId);
  if (collision) return `Property key "${key}" is already used by "${collision.displayName}".`;
  return null;
}

export class ManageModal extends Modal {
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
        this.activeTab = tab;
        this.render();
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
    const list = container.createDiv('vital-log-item-list');

    for (let i = 0; i < this.settings.vitamins.length; i++) {
      this.renderVitaminRow(list, this.settings.vitamins[i], i);
    }
    if (this.settings.vitamins.length === 0) {
      list.createDiv({ cls: 'vital-log-no-data', text: 'No vitamins yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Vitamin', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      addBtn.remove();
      this.renderVitaminForm(container, null);
    });
  }

  private renderVitaminRow(container: HTMLElement, vit: Vitamin, index: number): void {
    const row = container.createDiv('vital-log-item-row');
    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: vit.displayName });
    info.createDiv({
      cls: 'vital-log-item-meta',
      text: `key: ${vit.propertyKey}  |  default: ${vit.defaultAmount} ${vit.unit}`,
    });

    const actions = row.createDiv('vital-log-item-actions');

    if (index > 0) {
      const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn mod-compact' });
      upBtn.addEventListener('click', async () => {
        [this.settings.vitamins[index - 1], this.settings.vitamins[index]] = [this.settings.vitamins[index], this.settings.vitamins[index - 1]];
        await this.saveSettings();
        this.render();
      });
    }
    if (index < this.settings.vitamins.length - 1) {
      const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn mod-compact' });
      downBtn.addEventListener('click', async () => {
        [this.settings.vitamins[index], this.settings.vitamins[index + 1]] = [this.settings.vitamins[index + 1], this.settings.vitamins[index]];
        await this.saveSettings();
        this.render();
      });
    }

    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn mod-compact' });
    const delBtn = actions.createEl('button', { text: '✕', cls: 'vital-log-btn mod-compact mod-warning', attr: { 'aria-label': 'Delete' } });

    editBtn.addEventListener('click', () => {
      const form = createDiv();
      this.renderVitaminForm(form, vit);
      row.replaceWith(form);
    });

    delBtn.addEventListener('click', () => {
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

    const keyRow = form.createDiv('vital-log-form-row');
    keyRow.createEl('label', { text: 'Property Key' });
    const keyInput = keyRow.createEl('input', { type: 'text', value: vit?.propertyKey ?? '' });
    const keyError = form.createDiv({ cls: 'vital-log-error' });
    keyError.style.display = 'none';

    if (!isEdit) {
      nameInput.addEventListener('input', () => {
        keyInput.value = slugify(nameInput.value);
      });
    }

    const amtRow = form.createDiv('vital-log-form-row');
    amtRow.createEl('label', { text: 'Default Amount' });
    const amtInput = amtRow.createEl('input', { type: 'number', value: String(vit?.defaultAmount ?? '') });

    const unitRow = form.createDiv('vital-log-form-row');
    unitRow.createEl('label', { text: 'Unit' });
    const unitInput = unitRow.createEl('input', { type: 'text', value: vit?.unit ?? '' });
    unitInput.placeholder = 'mg, IU, mcg…';

    const actionsEl = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actionsEl.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    cancelBtn.addEventListener('click', () => { form.remove(); this.render(); });

    saveBtn.addEventListener('click', async () => {
      const keyErr = validatePropertyKey(
        keyInput.value,
        this.settings.vitamins,
        isEdit ? vit!.id : undefined
      );
      if (keyErr) {
        keyError.textContent = keyErr;
        keyError.style.display = 'block';
        return;
      }
      keyError.style.display = 'none';

      const amount = parseFloat(amtInput.value);
      if (isNaN(amount) || amount <= 0) { new Notice('Vital Log: Default amount must be a positive number.'); return; }
      if (!unitInput.value.trim()) { new Notice('Vital Log: Unit cannot be empty.'); return; }

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
    });
  }

  // ════════════════════════════════════════════════════════════
  // PACKS TAB
  // ════════════════════════════════════════════════════════════

  private renderPacksTab(container: HTMLElement): void {
    const list = container.createDiv('vital-log-item-list');

    for (let i = 0; i < this.settings.packs.length; i++) {
      this.renderPackRow(list, this.settings.packs[i], i);
    }
    if (this.settings.packs.length === 0) {
      list.createDiv({ cls: 'vital-log-no-data', text: 'No packs yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Pack', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      addBtn.remove();
      this.renderPackForm(container, null);
    });
  }

  private renderPackRow(container: HTMLElement, pack: Pack, index: number): void {
    const wrapper = container.createDiv();
    const row = wrapper.createDiv('vital-log-item-row');
    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: pack.displayName });
    info.createDiv({ cls: 'vital-log-item-meta', text: `${pack.items.length} vitamin(s)` });

    const actions = row.createDiv('vital-log-item-actions');

    if (index > 0) {
      const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn mod-compact' });
      upBtn.addEventListener('click', async () => {
        [this.settings.packs[index - 1], this.settings.packs[index]] = [this.settings.packs[index], this.settings.packs[index - 1]];
        await this.saveSettings();
        this.render();
      });
    }
    if (index < this.settings.packs.length - 1) {
      const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn mod-compact' });
      downBtn.addEventListener('click', async () => {
        [this.settings.packs[index], this.settings.packs[index + 1]] = [this.settings.packs[index + 1], this.settings.packs[index]];
        await this.saveSettings();
        this.render();
      });
    }

    let expanded = false;
    const expandBtn = actions.createEl('button', { text: '▶', cls: 'vital-log-btn mod-compact' });
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
      expandBtn.textContent = expanded ? '▼' : '▶';
    });

    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn mod-compact' });
    const delBtn = actions.createEl('button', { text: '✕', cls: 'vital-log-btn mod-compact mod-warning', attr: { 'aria-label': 'Delete' } });

    editBtn.addEventListener('click', () => {
      wrapper.remove();
      this.renderPackForm(container, pack);
    });

    delBtn.addEventListener('click', () => {
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

    form.createEl('p', { text: 'Vitamins:', cls: 'vital-log-item-meta' });
    const itemsContainer = form.createDiv('vital-log-pack-items');

    const currentItems: Array<{ vitaminId: string; amount: number }> = pack
      ? pack.items.map((i) => ({ ...i }))
      : [];

    const renderItems = (): void => {
      itemsContainer.empty();
      currentItems.forEach((item, idx) => {
        const row = itemsContainer.createDiv('vital-log-pack-item-row');
        const sel = row.createEl('select');
        sel.createEl('option', { value: '', text: '— select vitamin —' });
        this.settings.vitamins.forEach((v) => {
          const opt = sel.createEl('option', { value: v.id, text: v.displayName });
          if (v.id === item.vitaminId) opt.selected = true;
        });

        const amtInput = row.createEl('input', { type: 'number', value: String(item.amount || '') });
        amtInput.placeholder = 'amount';

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

        const rmBtn = row.createEl('button', { text: '✕', cls: 'vital-log-btn mod-compact mod-warning' });
        rmBtn.addEventListener('click', () => { currentItems.splice(idx, 1); renderItems(); });
      });
    };

    renderItems();

    const addItemBtn = form.createEl('button', { text: '+ Add Vitamin', cls: 'vital-log-btn' });
    addItemBtn.addEventListener('click', () => {
      currentItems.push({ vitaminId: '', amount: 0 });
      renderItems();
    });

    const actionsEl = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actionsEl.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    cancelBtn.addEventListener('click', () => { form.remove(); this.render(); });

    saveBtn.addEventListener('click', async () => {
      if (!nameInput.value.trim()) { new Notice('Vital Log: Pack name cannot be empty.'); return; }
      const validItems = currentItems.filter((i) => i.vitaminId && i.amount > 0);
      if (validItems.length === 0) {
        new Notice('Vital Log: Pack must have at least one vitamin with a valid amount.');
        return;
      }

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
    });
  }

  // ════════════════════════════════════════════════════════════
  // STACKS TAB
  // ════════════════════════════════════════════════════════════

  private renderStacksTab(container: HTMLElement): void {
    const list = container.createDiv('vital-log-item-list');

    for (let i = 0; i < this.settings.stacks.length; i++) {
      this.renderStackRow(list, this.settings.stacks[i], i);
    }
    if (this.settings.stacks.length === 0) {
      list.createDiv({ cls: 'vital-log-no-data', text: 'No stacks yet.' });
    }

    const addBtn = container.createEl('button', { text: '+ Add Stack', cls: 'vital-log-btn mod-cta' });
    addBtn.addEventListener('click', () => {
      addBtn.remove();
      this.renderStackForm(container, null);
    });
  }

  private renderStackRow(container: HTMLElement, stack: Stack, index: number): void {
    const row = container.createDiv('vital-log-item-row');
    const info = row.createDiv('vital-log-item-info');
    info.createDiv({ cls: 'vital-log-item-name', text: stack.displayName });
    info.createDiv({
      cls: 'vital-log-item-meta',
      text: `${stack.schedulingHint}  |  ${stack.items.length} item(s)`,
    });

    const actions = row.createDiv('vital-log-item-actions');

    if (index > 0) {
      const upBtn = actions.createEl('button', { text: '\u2191', cls: 'vital-log-btn mod-compact' });
      upBtn.addEventListener('click', async () => {
        [this.settings.stacks[index - 1], this.settings.stacks[index]] = [this.settings.stacks[index], this.settings.stacks[index - 1]];
        await this.saveSettings();
        this.render();
      });
    }
    if (index < this.settings.stacks.length - 1) {
      const downBtn = actions.createEl('button', { text: '\u2193', cls: 'vital-log-btn mod-compact' });
      downBtn.addEventListener('click', async () => {
        [this.settings.stacks[index], this.settings.stacks[index + 1]] = [this.settings.stacks[index + 1], this.settings.stacks[index]];
        await this.saveSettings();
        this.render();
      });
    }

    const editBtn = actions.createEl('button', { text: 'Edit', cls: 'vital-log-btn mod-compact' });
    const delBtn = actions.createEl('button', { text: '✕', cls: 'vital-log-btn mod-compact mod-warning', attr: { 'aria-label': 'Delete' } });

    editBtn.addEventListener('click', () => {
      row.remove();
      this.renderStackForm(container, stack);
    });
    delBtn.addEventListener('click', () => {
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

    const hintRow = form.createDiv('vital-log-form-row');
    hintRow.createEl('label', { text: 'Scheduling Hint' });
    const hintSel = hintRow.createEl('select');
    SCHEDULING_HINTS.forEach((h) => {
      const opt = hintSel.createEl('option', { value: h, text: h });
      if (h === (stack?.schedulingHint ?? 'Morning')) opt.selected = true;
    });

    form.createEl('p', { text: 'Items:', cls: 'vital-log-item-meta' });
    const itemsContainer = form.createDiv('vital-log-pack-items');

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

        const typeSel = row.createEl('select');
        typeSel.style.width = '90px';
        typeSel.style.flexShrink = '0';
        const packOpt = typeSel.createEl('option', { value: 'pack', text: 'Pack' });
        const vitOpt = typeSel.createEl('option', { value: 'vitamin', text: 'Vitamin' });
        if (item.type === 'pack') packOpt.selected = true;
        else vitOpt.selected = true;

        const pickerSel = row.createEl('select');

        const renderPickerOptions = (type: 'pack' | 'vitamin', selectedId: string): void => {
          pickerSel.empty();
          pickerSel.createEl('option', { value: '', text: '— select —' });
          if (type === 'pack') {
            this.settings.packs.forEach((p) => {
              const opt = pickerSel.createEl('option', { value: p.id, text: p.displayName });
              if (p.id === selectedId) opt.selected = true;
            });
          } else {
            this.settings.vitamins.forEach((v) => {
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

        const rmBtn = row.createEl('button', { text: '✕', cls: 'vital-log-btn mod-compact mod-warning' });
        rmBtn.addEventListener('click', () => { currentItems.splice(idx, 1); renderStackItems(); });
      });
    };

    renderStackItems();

    const addItemBtn = form.createEl('button', { text: '+ Add Item', cls: 'vital-log-btn' });
    addItemBtn.addEventListener('click', () => {
      currentItems.push({ type: 'pack', packId: '' });
      renderStackItems();
    });

    const actionsEl = form.createDiv('vital-log-inline-form-actions');
    const cancelBtn = actionsEl.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' });
    const saveBtn = actionsEl.createEl('button', { text: 'Save', cls: 'vital-log-btn mod-cta' });

    cancelBtn.addEventListener('click', () => { form.remove(); this.render(); });

    saveBtn.addEventListener('click', async () => {
      if (!nameInput.value.trim()) { new Notice('Vital Log: Stack name cannot be empty.'); return; }

      const validItems: StackItemType[] = currentItems
        .filter((i) => (i.type === 'pack' ? i.packId : i.vitaminId))
        .map((i): StackItemType =>
          i.type === 'pack'
            ? { type: 'pack', packId: i.packId }
            : { type: 'vitamin', vitaminId: i.vitaminId, amount: i.amount || undefined }
        );

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
    });
  }
}
