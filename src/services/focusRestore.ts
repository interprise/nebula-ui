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

/** Un campo su cui il cursore puo' andare: i criteri di skipElem del legacy
 *  (ui.js) — niente tabindex -1, nascosti, disabilitati, sola lettura — piu'
 *  il fatto che sia visibile. L'input di una combo antd e' `readOnly` anche
 *  quando la combo e' modificabile (e' solo l'appiglio del fuoco): li' conta
 *  la combo. */
function isUsableField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
  if (el.tabIndex === -1 || el.disabled) return false;
  if (el instanceof HTMLInputElement && ['hidden', 'button', 'reset', 'submit'].includes(el.type)) return false;
  const select = el.closest('.ant-select');
  if (select) {
    if (select.classList.contains('ant-select-disabled')) return false;
  } else if ((el as HTMLInputElement).readOnly) {
    return false;
  }
  return el.getClientRects().length > 0;
}

function dialogOpen(): boolean {
  return Array.from(document.querySelectorAll('.ant-modal-wrap'))
    .some((w) => getComputedStyle(w).display !== 'none');
}

/** Di quanto scorrere in verticale un contenitore perche' un campo ci stia
 *  dentro, come `block: 'nearest'`: zero se si vede gia', altrimenti il minimo
 *  che lo porta dentro dal lato da cui esce (se e' piu' alto del contenitore,
 *  conta la sua cima). Negativo = verso l'alto. */
export function nearestVerticalDelta(
  field: { top: number; bottom: number },
  box: { top: number; bottom: number },
): number {
  if (field.top < box.top) return field.top - box.top;
  if (field.bottom > box.bottom) return Math.min(field.bottom - box.bottom, field.top - box.top);
  return 0;
}

/** Porta il campo in vista scorrendo SOLO in verticale i contenitori che lo
 *  contengono. `scrollIntoView({ inline: 'nearest' })` scorreva anche in
 *  orizzontale: in una testata piu' larga della finestra (fattura con una
 *  descrizione lunga, schermo al 125%) il primo campo modificabile sta in fondo
 *  a destra, e la maschera si apriva spostata, con le etichette di sinistra
 *  tagliate (SXADV-5922). Il legacy la apriva sempre dall'inizio. */
function revealVertically(el: HTMLElement): void {
  for (let box = el.parentElement; box; box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight) continue;
    if (!/(auto|scroll)/.test(getComputedStyle(box).overflowY)) continue;
    box.scrollTop += nearestVerticalDelta(el.getBoundingClientRect(), box.getBoundingClientRect());
  }
}

/**
 * Pagina nuova: il cursore va dove lo metteva il legacy dopo ogni pagina
 * (ui.js: `focusInputField(json.currField)`, altrimenti `nextField()`), cioe'
 * sul campo indicato dal server e, se manca o non e' usabile, sul primo campo
 * modificabile della vista. Senza, il fuoco restava sul <body> e il primo TAB
 * finiva sulla barra dell'applicazione ("Logout") invece che nella mappa
 * (SXADV-5803).
 *
 * Non si muove se l'utente e' gia' su un campo della vista o se c'e' una
 * finestra aperta. Riprova per qualche fotogramma: i controlli che arrivano
 * dal plugin o da un Suspense si montano un attimo dopo il resto.
 */
export function focusNewPage(currField?: string | null): void {
  let attempts = 0;
  const tryFocus = () => {
    const view = document.querySelector('.tab-content .view-container');
    const active = document.activeElement;
    if (dialogOpen() || (active && active !== document.body && view?.contains(active))) return;
    const byServer = currField ? document.getElementById(currField) : null;
    const target = isUsableField(byServer)
      ? byServer
      : Array.from(view?.querySelectorAll('input, textarea, select') ?? []).find(isUsableField);
    if (target) {
      target.focus({ preventScroll: true });
      // Come focusInputField: il testo gia' presente resta selezionato.
      if (target instanceof HTMLInputElement && target.type === 'text' && !target.readOnly) target.select();
      revealVertically(target);
      return;
    }
    if (++attempts < 10) requestAnimationFrame(tryFocus);
  };
  requestAnimationFrame(tryFocus);
}
