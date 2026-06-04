// ============================================================
// Vital Log — Drag-to-reorder helper
// Encapsulates the HTML5 drag handlers + .is-dragging/.drag-over classes
// shared by every reorderable list in the settings tab. The caller supplies
// an onReorder(from, to) that performs the actual array move.
// ============================================================

/**
 * Make rows in `listEl` reorderable by dragging. Returns a `register(row, index)`
 * to call for each row; on drop it invokes `onReorder(fromIndex, toIndex)`.
 *
 * The drag index is kept in a closure shared across the rows of one list, so
 * create one reorderer per list (re-created on each re-render is fine).
 */
export function makeReorderable(
  listEl: HTMLElement,
  onReorder: (fromIndex: number, toIndex: number) => void | Promise<void>
): (row: HTMLElement, index: number) => void {
  let dragIdx = -1;

  return (row: HTMLElement, index: number): void => {
    row.draggable = true;

    row.addEventListener('dragstart', (e) => {
      dragIdx = index;
      row.classList.add('is-dragging');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragIdx !== index) row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (dragIdx !== -1 && dragIdx !== index) {
        const from = dragIdx;
        dragIdx = -1;
        await onReorder(from, index);
      }
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      listEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      dragIdx = -1;
    });
  };
}
