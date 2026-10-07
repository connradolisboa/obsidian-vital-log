// ============================================================
// Vital Log — Quick-add forms
// Compact inline forms for creating a vitamin, pack, stack, or event
// type from inside the log modal, without a trip to settings. Each
// form validates, pushes the new item into `settings`, and hands it
// back; saving settings is the caller's job.
// ============================================================

import type { EventType, Pack, Stack, StackItemType, VitalLogSettings, Vitamin } from './types';
import { attachFieldError, initInlineForm, requireValue } from './formUI';
import { createIconField } from './iconPicker';
import { allKeyOwners, uniquePropertyKey, validatePropertyKey } from './validation';

interface QuickAddCallbacks<T> {
  onSave: (created: T) => void;
  onCancel: () => void;
}

const SCHEDULING_HINTS = ['Morning', 'Evening', 'Pre-workout', 'Post-workout', 'Custom'];

function newId(): string {
  return crypto.randomUUID();
}

function nameTaken(list: { displayName: string }[], name: string): boolean {
  const lower = name.trim().toLowerCase();
  return list.some((item) => item.displayName.toLowerCase() === lower);
}

function formShell(container: HTMLElement, title: string): HTMLElement {
  const form = container.createDiv('vital-log-inline-form vital-log-quick-add');
  form.createEl('h4', { text: title });
  return form;
}

function formActions(
  form: HTMLElement,
  save: () => void,
  cancel: () => void
): void {
  const actions = form.createDiv('vital-log-inline-form-actions');
  actions.createEl('button', { text: 'Cancel', cls: 'vital-log-btn' })
    .addEventListener('click', cancel);
  actions.createEl('button', { text: 'Add', cls: 'vital-log-btn mod-cta' })
    .addEventListener('click', save);
  initInlineForm(form, { onSave: save, onCancel: cancel });
}

// ── Vitamin ──────────────────────────────────────────────────

export function renderVitaminQuickAdd(
  container: HTMLElement,
  settings: VitalLogSettings,
  cb: QuickAddCallbacks<Vitamin>
): void {
  const form = formShell(container, 'New substance');

  const nameRow = form.createDiv('vital-log-form-row');
  nameRow.createEl('label', { text: 'Name' });
  const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Magnesium' });
  const nameError = attachFieldError(nameRow, nameInput);

  // The key only matters in per-vitamin mode, where it names the frontmatter
  // property; show where the entries will go so it isn't a surprise.
  const keyHint = settings.logMode === 'substances'
    ? null
    : form.createDiv({ cls: 'vital-log-form-hint vital-log-quick-add-hint' });
  const refreshHint = (): void => {
    if (!keyHint) return;
    const key = uniquePropertyKey(nameInput.value, settings);
    keyHint.setText(key ? `Logs to property "${key}"` : '');
  };
  nameInput.addEventListener('input', refreshHint);

  const pair = form.createDiv('vital-log-quick-add-pair');
  const amtRow = pair.createDiv('vital-log-form-row');
  amtRow.createEl('label', { text: 'Default amount' });
  const amtInput = amtRow.createEl('input', { type: 'number', placeholder: '500' });
  amtInput.inputMode = 'decimal';
  const amtError = attachFieldError(amtRow, amtInput);

  const unitRow = pair.createDiv('vital-log-form-row');
  unitRow.createEl('label', { text: 'Unit' });
  const unitInput = unitRow.createEl('input', { type: 'text', placeholder: 'mg, IU…' });
  const unitError = attachFieldError(unitRow, unitInput);

  const save = (): void => {
    if (!requireValue(nameInput, nameError, 'Give it a name.')) return;
    const name = nameInput.value.trim();
    if (nameTaken(settings.vitamins, name)) {
      nameError.show(`"${name}" already exists.`);
      nameInput.focus();
      return;
    }
    const key = uniquePropertyKey(name, settings);
    const keyError = validatePropertyKey(key, allKeyOwners(settings));
    if (keyError) {
      nameError.show(`Can't derive a property key from this name: ${keyError}`);
      nameInput.focus();
      return;
    }
    const amount = parseFloat(amtInput.value);
    if (isNaN(amount) || amount <= 0) {
      amtError.show('Enter an amount greater than zero.');
      amtInput.focus();
      return;
    }
    amtError.clear();
    if (!requireValue(unitInput, unitError, 'Enter a unit, e.g. mg.')) return;

    const vitamin: Vitamin = {
      id: newId(),
      displayName: name,
      propertyKey: key,
      defaultAmount: amount,
      unit: unitInput.value.trim(),
    };
    settings.vitamins.push(vitamin);
    cb.onSave(vitamin);
  };

  formActions(form, save, cb.onCancel);
}

// ── Pack ─────────────────────────────────────────────────────

/** A checklist of vitamins with an amount box each; returns a reader for the checked ones. */
function renderVitaminChecklist(
  form: HTMLElement,
  settings: VitalLogSettings
): () => { vitaminId: string; amount: number }[] {
  const list = form.createDiv('vital-log-quick-add-checklist');
  const rows: { vitamin: Vitamin; check: HTMLInputElement; amount: HTMLInputElement }[] = [];
  for (const vitamin of settings.vitamins.filter((v) => !v.archived)) {
    const row = list.createEl('label', { cls: 'vital-log-quick-add-check-row' });
    const check = row.createEl('input', { type: 'checkbox' });
    row.createSpan({ cls: 'vital-log-quick-add-check-name', text: vitamin.displayName });
    const amount = row.createEl('input', { type: 'number', value: String(vitamin.defaultAmount) });
    amount.inputMode = 'decimal';
    amount.disabled = true;
    row.createSpan({ cls: 'vital-log-preview-unit', text: vitamin.unit });
    check.addEventListener('change', () => { amount.disabled = !check.checked; });
    rows.push({ vitamin, check, amount });
  }
  if (rows.length === 0) {
    list.createDiv({ cls: 'vital-log-no-data', text: 'No substances yet — add one first.' });
  }
  return () =>
    rows
      .filter((r) => r.check.checked)
      .map((r) => {
        const amount = parseFloat(r.amount.value);
        return { vitaminId: r.vitamin.id, amount: isNaN(amount) ? r.vitamin.defaultAmount : amount };
      });
}

export function renderPackQuickAdd(
  container: HTMLElement,
  settings: VitalLogSettings,
  cb: QuickAddCallbacks<Pack>
): void {
  const form = formShell(container, 'New pack');

  const nameRow = form.createDiv('vital-log-form-row');
  nameRow.createEl('label', { text: 'Name' });
  const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Morning Pack' });
  const nameError = attachFieldError(nameRow, nameInput);

  form.createEl('label', { cls: 'vital-log-quick-add-label', text: 'Contents' });
  const readItems = renderVitaminChecklist(form, settings);
  const itemsError = attachFieldError(form.lastElementChild as HTMLElement);

  const save = (): void => {
    if (!requireValue(nameInput, nameError, 'Give the pack a name.')) return;
    const name = nameInput.value.trim();
    if (nameTaken(settings.packs, name)) {
      nameError.show(`"${name}" already exists.`);
      nameInput.focus();
      return;
    }
    const items = readItems();
    if (items.length === 0) {
      itemsError.show('Tick at least one substance.');
      return;
    }
    itemsError.clear();
    const pack: Pack = { id: newId(), displayName: name, items };
    settings.packs.push(pack);
    cb.onSave(pack);
  };

  formActions(form, save, cb.onCancel);
}

// ── Stack ────────────────────────────────────────────────────

export function renderStackQuickAdd(
  container: HTMLElement,
  settings: VitalLogSettings,
  cb: QuickAddCallbacks<Stack>
): void {
  const form = formShell(container, 'New stack');

  const nameRow = form.createDiv('vital-log-form-row');
  nameRow.createEl('label', { text: 'Name' });
  const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Morning Stack' });
  const nameError = attachFieldError(nameRow, nameInput);

  const hintRow = form.createDiv('vital-log-form-row');
  hintRow.createEl('label', { text: 'When' });
  const hintSelect = hintRow.createEl('select');
  for (const hint of SCHEDULING_HINTS) hintSelect.createEl('option', { value: hint, text: hint });

  const activePacks = settings.packs.filter((p) => !p.archived);
  const packChecks: { pack: Pack; check: HTMLInputElement }[] = [];
  if (activePacks.length > 0) {
    form.createEl('label', { cls: 'vital-log-quick-add-label', text: 'Packs' });
    const list = form.createDiv('vital-log-quick-add-checklist');
    for (const pack of activePacks) {
      const row = list.createEl('label', { cls: 'vital-log-quick-add-check-row' });
      const check = row.createEl('input', { type: 'checkbox' });
      row.createSpan({ cls: 'vital-log-quick-add-check-name', text: pack.displayName });
      packChecks.push({ pack, check });
    }
  }

  form.createEl('label', { cls: 'vital-log-quick-add-label', text: 'Substances' });
  const readVitamins = renderVitaminChecklist(form, settings);
  const itemsError = attachFieldError(form.lastElementChild as HTMLElement);

  const save = (): void => {
    if (!requireValue(nameInput, nameError, 'Give the stack a name.')) return;
    const name = nameInput.value.trim();
    if (nameTaken(settings.stacks, name)) {
      nameError.show(`"${name}" already exists.`);
      nameInput.focus();
      return;
    }
    const items: StackItemType[] = [
      ...packChecks.filter((p) => p.check.checked).map((p) => ({ type: 'pack' as const, packId: p.pack.id })),
      ...readVitamins().map((v) => ({ type: 'vitamin' as const, vitaminId: v.vitaminId, amount: v.amount })),
    ];
    if (items.length === 0) {
      itemsError.show('Tick at least one pack or substance.');
      return;
    }
    itemsError.clear();
    const stack: Stack = { id: newId(), displayName: name, schedulingHint: hintSelect.value, items };
    settings.stacks.push(stack);
    cb.onSave(stack);
  };

  formActions(form, save, cb.onCancel);
}

// ── Event type ───────────────────────────────────────────────

export function renderEventTypeQuickAdd(
  container: HTMLElement,
  settings: VitalLogSettings,
  cb: QuickAddCallbacks<EventType>
): void {
  const form = formShell(container, 'New event type');

  const nameRow = form.createDiv('vital-log-form-row');
  nameRow.createEl('label', { text: 'Name' });
  const nameInput = nameRow.createEl('input', { type: 'text', placeholder: 'e.g. Sick, Traveling…' });
  const nameError = attachFieldError(nameRow, nameInput);

  const iconRow = form.createDiv('vital-log-form-row');
  iconRow.createEl('label', { text: 'Icon (optional)' });
  const iconInput = createIconField(iconRow, { placeholder: 'e.g. thermometer' });

  const save = (): void => {
    if (!requireValue(nameInput, nameError, 'Give the event a name.')) return;
    const name = nameInput.value.trim();
    if (nameTaken(settings.eventTypes, name)) {
      nameError.show(`"${name}" already exists.`);
      nameInput.focus();
      return;
    }
    const icon = iconInput.value.trim();
    const eventType: EventType = { id: newId(), displayName: name, ...(icon ? { icon } : {}) };
    settings.eventTypes.push(eventType);
    cb.onSave(eventType);
  };

  formActions(form, save, cb.onCancel);
}
