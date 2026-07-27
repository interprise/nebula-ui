/**
 * Captures the focused element's id at the moment a reload is fired
 * and restores focus (with scroll-into-view) after the response's
 * re-render lands in the DOM.
 *
 * Why this matters: on a reload the scroll container might re-mount or
 * re-flow and the browser loses scroll / focus context. By snapshotting
 * document.activeElement before the request and re-focusing it after,
 * we get:
 *   - Tab-out reloads (text/combo/date fields): the browser had already
 *     moved focus to the NEXT tabIndex before onBlur fired, so the
 *     captured id IS the next field — we re-focus it.
 *   - Checkbox toggles: the checkbox stays focused on click, so the
 *     captured id is the same checkbox — we re-focus it.
 *   - scrollIntoView({block:'nearest'}) keeps the focused field visible
 *     without scrolling if it was already in view.
 */
let pending: string | null = null;

/**
 * Snapshot the element to refocus after the reload re-renders.
 *
 * Normally that's `document.activeElement` — for a Tab-out reload it's already
 * the next field, for a checkbox toggle it's the checkbox itself. But when the
 * change is fired from a widget whose popup has stolen focus (a DatePicker
 * calendar, whose panel div carries no id, or a menu that dropped focus to
 * <body>), `activeElement` has no id to restore. In that case fall back to
 * `fallbackId` — the control's own DOM id — so focus lands back on the field
 * that triggered the reload instead of being stranded on <body> (whence the
 * next Tab jumps to the first focusable element on the page). SXADV-5680.
 */
export function captureFocusBeforeReload(fallbackId?: string | null): void {
  const el = document.activeElement as HTMLElement | null;
  pending = el?.id || fallbackId || null;
}

export function consumePendingFocus(): string | null {
  const t = pending;
  pending = null;
  return t;
}

export function restoreFocus(id: string | null): void {
  if (!id) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}
