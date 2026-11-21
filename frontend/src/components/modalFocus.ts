/**
 * Focus restoration for dialogs, including nested dialogs (#1592).
 *
 * Every open dialog registers the element that had focus when it opened. On
 * close we:
 *  1. return focus to that trigger when it is still in the document;
 *  2. otherwise fall back to the nearest dialog that is still open — the
 *     correct destination when a nested dialog's trigger was removed (for
 *     example a row that disappeared) while its parent stayed open;
 *  3. otherwise move focus to the page's main landmark instead of dropping it
 *     on `<body>`, which is where a detached `.focus()` call leaves it.
 *
 * A stack (rather than a DOM query) is used so a closing parent and its child
 * cannot race and steal focus from each other during the same unmount.
 */

export interface ModalFocusEntry {
  /** Element focused when the dialog opened; may be removed while it is open. */
  trigger: HTMLElement | null;
  /** The dialog container itself, for focus fallbacks. */
  dialog: HTMLElement | null;
}

const openModals: ModalFocusEntry[] = [];

export function registerModal(entry: ModalFocusEntry): void {
  openModals.push(entry);
}

export function isModalRegistered(entry: ModalFocusEntry): boolean {
  return openModals.includes(entry);
}

/** Removes an entry without moving focus. Used by tests and by close handling. */
export function unregisterModal(entry: ModalFocusEntry): void {
  const index = openModals.lastIndexOf(entry);
  if (index !== -1) openModals.splice(index, 1);
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "iframe",
  "object",
  "embed",
  '[tabindex]:not([tabindex="-1"])',
  "[contenteditable]",
].join(", ");

function isFocusable(element: HTMLElement): boolean {
  return element.isConnected && typeof element.focus === "function";
}

/** Focuses the first focusable descendant, or the container itself. */
export function focusInside(container: HTMLElement): boolean {
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).find(
    (element) =>
      element.isConnected && element.getAttribute("tabindex") !== "-1",
  );

  if (focusable) {
    focusable.focus();
    return true;
  }

  if (!container.hasAttribute("tabindex"))
    container.setAttribute("tabindex", "-1");
  container.focus();
  return true;
}

function focusMainLandmark(): void {
  // Only move focus if nothing meaningful holds it: if the parent dialog's
  // cleanup already restored the trigger, leave it there.
  const active = document.activeElement;
  if (active && active !== document.body) return;

  const main =
    document.querySelector<HTMLElement>('[role="main"]') ??
    document.querySelector<HTMLElement>("main");
  if (main) {
    focusInside(main);
  }
}

/**
 * Restores focus after `entry`'s dialog closed. The entry is removed from the
 * stack first so the fallback looks at the dialogs that remain open.
 */
export function restoreFocusAfterClose(entry: ModalFocusEntry): void {
  unregisterModal(entry);

  if (entry.trigger && isFocusable(entry.trigger)) {
    entry.trigger.focus();
    return;
  }

  // The trigger is gone. A still-open parent dialog is the right place for
  // focus; otherwise fall back to the page's main landmark.
  const parent = openModals[openModals.length - 1];
  if (parent?.dialog?.isConnected) {
    focusInside(parent.dialog);
    return;
  }

  focusMainLandmark();
}

/** Test helper: clears process-wide dialog state between cases. */
export function resetModalFocusForTests(): void {
  openModals.length = 0;
}
