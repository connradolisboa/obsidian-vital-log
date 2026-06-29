// ============================================================
// Vital Log — Mobile soft-keyboard handling
//
// On mobile the modal is a bottom sheet anchored to the bottom of the
// layout viewport, so when the soft keyboard slides in it covers the lower
// part of the sheet. The keyboard does NOT shrink the layout viewport (and
// therefore not `vh` units) on iOS — only the *visual* viewport shrinks.
//
// We use `window.visualViewport` to measure the real visible region and:
//   1. add bottom padding to the scrollable modal content equal to the
//      keyboard height, so any field can be scrolled up clear of the keyboard;
//   2. manually scroll the focused field into the visible region (more
//      reliable than `scrollIntoView` inside a clipped/translated sheet on
//      iOS WebView).
// Padding is removed again when the keyboard closes.
// ============================================================

import { Platform } from 'obsidian';
import type VitalLogPlugin from '../main';

const FOCUSABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
// Visual-viewport shrink below this (px) is treated as browser chrome, not a keyboard.
const KEYBOARD_THRESHOLD = 120;
// Breathing room (px) kept between the focused field and the keyboard / sheet top.
const MARGIN = 16;

function isFocusableField(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && FOCUSABLE.has(el.tagName);
}

/** The scrollable `.modal-content` for the Vital Log modal containing `field`. */
function getScroller(field: HTMLElement): HTMLElement | null {
  const root = field.closest('.vital-log-modal') as HTMLElement | null;
  if (!root) return null;
  // Most modals add `vital-log-modal` directly to `.modal-content`; a few
  // (dashboard, custom-modal editor) add it to a wrapper around it.
  if (root.classList.contains('modal-content')) return root;
  return (root.querySelector(':scope > .modal-content') as HTMLElement | null) ?? root;
}

/** The currently-focused field inside a Vital Log modal, if any. */
function activeVitalLogField(): HTMLElement | null {
  const el = document.activeElement;
  if (!isFocusableField(el)) return null;
  if (!el.closest('.vital-log-modal')) return null;
  return el;
}

/** Height (px) the soft keyboard is currently covering, 0 if closed. */
function keyboardHeight(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

/** Scroll `field` so it sits inside the visible viewport, clear of the keyboard. */
function bringIntoView(field: HTMLElement): void {
  const vv = window.visualViewport;
  const scroller = getScroller(field);
  if (!vv || !scroller) return;
  const rect = field.getBoundingClientRect();
  const visibleTop = vv.offsetTop + MARGIN;
  const visibleBottom = vv.offsetTop + vv.height - MARGIN;
  if (rect.bottom > visibleBottom) {
    scroller.scrollTop += rect.bottom - visibleBottom;
  } else if (rect.top < visibleTop) {
    scroller.scrollTop -= visibleTop - rect.top;
  }
}

export function registerMobileKeyboard(plugin: VitalLogPlugin): void {
  if (!Platform.isMobile) return;

  // Remember which scroller we padded so we can reset it once the keyboard hides.
  let paddedScroller: HTMLElement | null = null;

  const syncPadding = (kb: number): void => {
    if (kb > KEYBOARD_THRESHOLD) {
      const field = activeVitalLogField();
      const scroller = field ? getScroller(field) : paddedScroller;
      if (scroller) {
        scroller.style.paddingBottom = `${kb}px`;
        paddedScroller = scroller;
      }
    } else if (paddedScroller) {
      paddedScroller.style.paddingBottom = '';
      paddedScroller = null;
    }
  };

  const onFocusIn = (e: FocusEvent): void => {
    if (!isFocusableField(e.target)) return;
    if (!e.target.closest('.vital-log-modal')) return;
    const target = e.target;
    // Wait for the keyboard slide-in to begin, then make room and reveal the field.
    window.setTimeout(() => {
      if (document.activeElement !== target) return;
      syncPadding(keyboardHeight());
      bringIntoView(target);
    }, 300);
  };

  // The visual viewport shrinks as the keyboard animates in and may keep
  // shifting; re-apply padding and re-reveal the field on each change so it
  // stays visible above the keyboard.
  const onViewportChange = (): void => {
    syncPadding(keyboardHeight());
    const target = activeVitalLogField();
    if (target) bringIntoView(target);
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
