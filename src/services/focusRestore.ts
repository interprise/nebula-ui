/**
 * Restores focus (with scroll-into-view) after a reload's response has
 * re-rendered the form, on the element that held it when the response
 * arrived.
 *
 * Why this matters: on a reload the scroll container might re-mount or
 * re-flow and the browser loses scroll / focus context. By reading
 * document.activeElement when the response arrives and re-focusing it after
 * the re-render, we get:
 *   - Tab-out reloads (text/date fields): il commit parte col fuoco ancora
 *     in transito (nel `blur`, o nel keydown del Tab per una data scritta nel
 *     formato esatto); all'arrivo della risposta il fuoco e' sul campo
 *     SUCCESSIVO, e lo si rimette li' dopo il ridisegno.
 *   - Checkbox toggles: the checkbox stays focused on click, so it is
 *     the element we find and re-focus.
 *   - scrollIntoView({block:'nearest'}) keeps the focused field visible
 *     without scrolling if it was already in view.
 */
let pending: { fallbackId: string | null } | null = null;

/** Il fuoco e' "sospeso": su <body>, o sul pannello di un popup antd
 *  (calendario, tendina) che sta per sparire. */
function focusStranded(el: Element | null): boolean {
  return !(el instanceof HTMLElement) || el === document.body
    || el.closest('.ant-picker-dropdown, .ant-select-dropdown') != null;
}

/**
 * Arma il ripristino del fuoco per il reload che sta partendo. Il nome e'
 * rimasto quello di quando il fuoco si fotografava qui.
 *
 * Il fuoco da ridare NON si legge qui ma all'arrivo della risposta
 * ({@link consumePendingFocus}), quando la mossa dell'utente e' finita: qui
 * sarebbe troppo presto. Un commit fatto nel `blur` (data flessibile, testo
 * con reload) arriva col fuoco in transito su `<body>`; uno fatto nel keydown
 * del Tab (data nel formato esatto, che rc-picker conferma li') arriva col
 * fuoco ancora sul campo che si sta lasciando. In tutti e due i casi
 * rileggerlo subito rimetteva il cursore sul campo appena lasciato, e col Tab
 * non si usciva mai da un campo con reload come "Data doc" (SXADV-5740.0,
 * "servono due TAB"). All'arrivo della risposta: dove il fuoco e' posato
 * (campo successivo, checkbox appena cliccata, bottone su cui l'utente e'
 * andato nel frattempo) resta; solo se e' sospeso si torna a `fallbackId`, il
 * campo che ha fatto partire il reload — e' il caso di una scelta da un popup
 * (calendario, menu) che ha lasciato il fuoco su <body>, SXADV-5680.
 */
export function captureFocusBeforeReload(fallbackId?: string | null): void {
  pending = { fallbackId: fallbackId || null };
}

export function consumePendingFocus(): string | null {
  const p = pending;
  pending = null;
  if (!p) return null;
  const active = document.activeElement;
  // Posato su qualcosa senza id: e' dell'utente, non lo si sposta.
  return focusStranded(active) ? p.fallbackId : (active as HTMLElement).id || null;
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
