/**
 * Where a key press belongs. Global keyboard shortcuts (single letters, "/", arrows, ⌘K/⌘J) must never take keys
 * from someone typing: a text input, a textarea, a select, an editable region, or a combobox or search field — in a
 * page, a dialog or a side panel alike.
 */
const FIELD = [
  "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='reset']):not([type='range']):not([type='color']):not([type='file']):not([type='image'])",
  "textarea", "select", "[contenteditable]:not([contenteditable='false'])",
  "[role='combobox']", "[role='searchbox']", "[role='textbox']", "[role='spinbutton']",
].join(", ");

/** Dialogs, menus, popovers and side panels (marked `data-side-panel`) own the keys pressed inside them. */
const OVERLAY = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-side-panel]";

/** The person is typing into this element (or one it is inside). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return Boolean(target.closest(FIELD));
}

/** The element is inside a dialog, a menu or a side panel. */
export function inOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(OVERLAY));
}

/**
 * A page's global shortcut leaves this key alone: someone is typing, or the key was pressed inside a dialog or side
 * panel (whose own fields and lists handle it), or another handler already used it.
 */
export function shortcutBlocked(event: Pick<KeyboardEvent, "target" | "defaultPrevented">): boolean {
  return event.defaultPrevented || isTypingTarget(event.target) || inOverlay(event.target);
}
