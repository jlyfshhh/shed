"use client";

import { useEffect } from "react";
import { dialogKeyAction } from "@/lib/dialog-accessibility";

const DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type BackgroundState = { inert: boolean; ariaHidden: string | null };

function visibleDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(DIALOG_SELECTOR))
    .filter((dialog) => dialog.isConnected && !dialog.hidden);
}

function focusableInside(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.closest("[inert]") && element.getAttribute("aria-hidden") !== "true");
}

function ensureAccessibleName(dialog: HTMLElement, serial: number): void {
  if (dialog.hasAttribute("aria-label") || dialog.hasAttribute("aria-labelledby")) return;
  const heading = dialog.querySelector<HTMLElement>("h1,h2,h3,[role=heading],.overlay-head b");
  if (!heading) {
    dialog.setAttribute("aria-label", "Shed dialog");
    return;
  }
  if (!heading.id) heading.id = `shed-dialog-title-${serial}`;
  dialog.setAttribute("aria-labelledby", heading.id);
}

/**
 * Applies modal behavior consistently to every existing Shed overlay.
 *
 * Individual features remain simple conditional React components. This one
 * observer adds focus entry, Tab containment, Escape, opener restoration, and
 * `inert` background isolation even to nested edit sheets.
 */
export default function DialogAccessibilityManager() {
  useEffect(() => {
    let previous: HTMLElement[] = [];
    let serial = 0;
    let lastFocused: HTMLElement | null = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const originalBodyOverflow = document.body.style.overflow;
    const openers = new WeakMap<HTMLElement, HTMLElement | null>();
    const background = new Map<HTMLElement, BackgroundState>();

    const restoreBackground = () => {
      for (const [element, state] of background) {
        element.inert = state.inert;
        if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", state.ariaHidden);
      }
      background.clear();
    };

    const isolate = (top: HTMLElement | undefined) => {
      restoreBackground();
      document.body.style.overflow = top ? "hidden" : originalBodyOverflow;
      if (!top) return;

      // Inert siblings at every ancestor level. Shed renders dialogs inside the
      // same React root as the page, and some edit sheets are nested inside a
      // full-screen manager, so only looking at <body> siblings is insufficient.
      let current: HTMLElement = top;
      while (current.parentElement) {
        const parent = current.parentElement;
        for (const sibling of Array.from(parent.children)) {
          if (!(sibling instanceof HTMLElement) || sibling === current) continue;
          if (["SCRIPT", "STYLE", "LINK"].includes(sibling.tagName)) continue;
          if (sibling.hasAttribute("data-modal-live")) continue;
          if (!background.has(sibling)) {
            background.set(sibling, { inert: sibling.inert, ariaHidden: sibling.getAttribute("aria-hidden") });
          }
          sibling.inert = true;
          sibling.setAttribute("aria-hidden", "true");
        }
        if (parent === document.body) break;
        current = parent;
      }
    };

    const sync = () => {
      const current = visibleDialogs();
      const removed = previous.filter((dialog) => !current.includes(dialog));
      const added = current.filter((dialog) => !previous.includes(dialog));
      const replacementOpener = removed.length ? openers.get(removed.at(-1)!) ?? null : null;

      for (const dialog of added) {
        ensureAccessibleName(dialog, ++serial);
        if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        openers.set(
          dialog,
          active?.isConnected && !dialog.contains(active) ? active : replacementOpener ?? lastFocused,
        );
      }

      const top = current.at(-1);
      if (top && added.includes(top)) {
        const autofocus = top.querySelector<HTMLElement>("[autofocus]");
        (autofocus ?? top).focus({ preventScroll: true });
      }
      isolate(top);

      if (!added.length && removed.length) {
        const closed = removed.at(-1)!;
        const opener = openers.get(closed);
        window.requestAnimationFrame(() => {
          if (opener?.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
          else visibleDialogs().at(-1)?.focus({ preventScroll: true });
        });
      }
      previous = current;
    };

    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) lastFocused = event.target;
    };
    const onKey = (event: KeyboardEvent) => {
      const top = visibleDialogs().at(-1);
      if (!top) return;
      const focusable = focusableInside(top);
      const action = dialogKeyAction(
        event.key,
        event.shiftKey,
        focusable.indexOf(document.activeElement as HTMLElement),
        focusable.length,
      );
      if (action === "close") {
        const close = top.querySelector<HTMLButtonElement>(
          'button[aria-label^="Close"],button[aria-label="Cancel"],[data-dialog-close]',
        );
        if (close) {
          event.preventDefault();
          event.stopPropagation();
          close.click();
        }
      } else if (action === "dialog") {
        event.preventDefault();
        top.focus();
      } else if (action === "first") {
        event.preventDefault();
        focusable[0]?.focus();
      } else if (action === "last") {
        event.preventDefault();
        focusable.at(-1)?.focus();
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("keydown", onKey, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("keydown", onKey, true);
      restoreBackground();
      document.body.style.overflow = originalBodyOverflow;
    };
  }, []);

  return null;
}
