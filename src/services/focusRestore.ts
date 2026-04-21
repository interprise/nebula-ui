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

export function captureFocusBeforeReload(): void {
  const el = document.activeElement as HTMLElement | null;
  pending = el?.id || null;
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
