/**
 * Decide whether a title-chrome mousedown should start window dragging.
 *
 * Radix menus portal to document.body. React still bubbles those events through
 * the React tree back to the header handler, but DOM `closest()` from the
 * portaled target cannot see `[data-lm-window-interactive]` under the header.
 * Starting drag in that case captures the mouse and drops pointerup/click —
 * which matches packaged "menu opens, item click does nothing".
 */
export function shouldStartChromeDragging(
  currentTarget: EventTarget | null,
  target: EventTarget | null,
): boolean {
  if (!(currentTarget instanceof Element) || !(target instanceof Element)) {
    return false;
  }

  // Portaled / non-descendant targets must never drag the window.
  if (!currentTarget.contains(target)) {
    return false;
  }

  if (target.closest('[data-lm-window-interactive="true"]')) {
    return false;
  }

  if (
    target.closest(
      '[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .lm-menu-content',
    )
  ) {
    return false;
  }

  return true;
}
