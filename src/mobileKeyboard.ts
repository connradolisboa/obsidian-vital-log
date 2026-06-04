// ============================================================
// Vital Log — Mobile soft-keyboard handling
//
// On mobile the modal content is made scrollable with extra empty space
// at the bottom (see styles.css), so a field near the bottom can be
// scrolled up above the soft keyboard. Here we just nudge the focused
// field into view; the user can always scroll the rest of the way.
// ============================================================

import { Platform } from 'obsidian';
import type VitalLogPlugin from '../main';

const FOCUSABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isFocusableField(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && FOCUSABLE.has(el.tagName);
}

export function registerMobileKeyboard(plugin: VitalLogPlugin): void {
  if (!Platform.isMobile) return;

  const onFocusIn = (e: FocusEvent): void => {
    const target = e.target;
    if (!isFocusableField(target)) return;
    if (!target.closest('.vital-log-modal')) return;
    // Wait for the keyboard slide-in, then bring the field into view.
    window.setTimeout(() => {
      if (document.activeElement === target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 300);
  };

  document.addEventListener('focusin', onFocusIn, true);
  plugin.register(() => document.removeEventListener('focusin', onFocusIn, true));
}
