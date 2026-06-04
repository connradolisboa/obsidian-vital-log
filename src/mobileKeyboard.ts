// ============================================================
// Vital Log — Mobile soft-keyboard handling
//
// On mobile, focusing an input/textarea near the bottom of a modal
// would otherwise sit hidden behind the iOS/Android soft keyboard.
// We keep the focused field visible by scrolling it to the centre of
// the (shrunken) visual viewport both when it gains focus and when
// the viewport resizes/scrolls as the keyboard animates in/out.
//
// Paired with `.vital-log-modal .modal-content { padding-bottom: 40vh }`
// in styles.css, which gives bottom fields somewhere to scroll up into.
// ============================================================

import { Platform } from 'obsidian';
import type VitalLogPlugin from '../main';

const FOCUSABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isFocusableField(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && FOCUSABLE.has(el.tagName);
}

function centerInView(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function registerMobileKeyboard(plugin: VitalLogPlugin): void {
  if (!Platform.isMobile) return;

  // Add bottom scroll slack to the active modal only while typing, so a
  // field at the very bottom can scroll up above the keyboard (and the
  // gap isn't there when the keyboard is closed).
  const onFocusIn = (e: FocusEvent) => {
    const target = e.target;
    if (!isFocusableField(target)) return;
    target.closest('.vital-log-modal')?.addClass('vital-log-kb-open');
    // Delay past the keyboard slide-in animation so the viewport has settled.
    window.setTimeout(() => {
      if (document.activeElement === target) centerInView(target);
    }, 250);
  };
  const onFocusOut = (e: FocusEvent) => {
    const target = e.target;
    if (!isFocusableField(target)) return;
    target.closest('.vital-log-modal')?.removeClass('vital-log-kb-open');
  };
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  plugin.register(() => {
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
  });

  // The visual viewport shrinks/scrolls as the keyboard opens; keep the
  // active field centered through those changes.
  const vv = window.visualViewport;
  if (vv) {
    const onViewportChange = () => {
      const active = document.activeElement;
      if (isFocusableField(active)) centerInView(active);
    };
    vv.addEventListener('resize', onViewportChange);
    vv.addEventListener('scroll', onViewportChange);
    plugin.register(() => {
      vv.removeEventListener('resize', onViewportChange);
      vv.removeEventListener('scroll', onViewportChange);
    });
  }
}
