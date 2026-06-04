// ============================================================
// Vital Log — Mobile soft-keyboard handling
//
// On mobile the modal content is made scrollable with extra empty space
// at the bottom (see styles.css), so a field near the bottom can be
// scrolled up above the soft keyboard. We bring the focused field into
// view when it gains focus, and — because the soft keyboard animates in
// and resizes the visual viewport over a few hundred ms — we keep
// re-centering it while the viewport changes, so it doesn't drift back
// under the keyboard on slower devices.
// ============================================================

import { Platform } from 'obsidian';
import type VitalLogPlugin from '../main';

const FOCUSABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isFocusableField(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && FOCUSABLE.has(el.tagName);
}

/** The currently-focused field inside a Vital Log modal, if any. */
function activeVitalLogField(): HTMLElement | null {
  const el = document.activeElement;
  if (!isFocusableField(el)) return null;
  if (!el.closest('.vital-log-modal')) return null;
  return el;
}

function center(el: HTMLElement, behavior: ScrollBehavior): void {
  el.scrollIntoView({ block: 'center', behavior });
}

export function registerMobileKeyboard(plugin: VitalLogPlugin): void {
  if (!Platform.isMobile) return;

  const onFocusIn = (e: FocusEvent): void => {
    if (!isFocusableField(e.target)) return;
    if (!e.target.closest('.vital-log-modal')) return;
    const target = e.target;
    // Wait for the keyboard slide-in to begin, then bring the field into view.
    window.setTimeout(() => {
      if (document.activeElement === target) center(target, 'smooth');
    }, 300);
  };

  // The visual viewport shrinks as the keyboard animates in and may keep
  // shifting; re-center (instantly, to avoid fighting the animation) on each
  // change so the focused field stays visible above the keyboard.
  const onViewportChange = (): void => {
    const target = activeVitalLogField();
    if (target) center(target, 'auto');
  };

  document.addEventListener('focusin', onFocusIn, true);
  plugin.register(() => document.removeEventListener('focusin', onFocusIn, true));

  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', onViewportChange);
    vv.addEventListener('scroll', onViewportChange);
    plugin.register(() => {
      vv.removeEventListener('resize', onViewportChange);
      vv.removeEventListener('scroll', onViewportChange);
    });
  }
}
