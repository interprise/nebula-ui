import React from 'react';
import { Tooltip } from 'antd';

/** Classe dell'ancora del tooltip di modulo nel menu collassato (SXADV-6277). */
const MODULE_TOOLTIP_ANCHOR_CLASS = 'menu-module-tooltip-anchor';

/** Ritardo d'apertura del tooltip al passaggio del mouse: quello di antd (0,1 s). */
const MODULE_TOOLTIP_DELAY_MS = 100;

/** I popup del menu laterale (SIDEBAR_POPUP_CLASS di sidebarMenu.tsx, che importa
 *  questo file: ripetuta qui per non fare un import circolare). */
const SIDEBAR_POPUP_SELECTOR = '.ant-menu-submenu-popup.sidebar-menu-popup';

/** Un popup del menu laterale e' aperto (visibile) da qualche parte? */
function anySidebarPopupOpen(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(SIDEBAR_POPUP_SELECTOR))
    .some((p) => !/-hidden\b/.test(p.className) && p.style.display !== 'none');
}

/** Il fuoco e' arrivato da tastiera? Il titolo ha tabIndex -1, quindi prende il
 *  fuoco anche col clic, e il browser glielo ridà tornando sulla finestra: solo
 *  quello da tastiera (:focus-visible) deve mostrare il nome. */
function keyboardFocus(el: HTMLElement): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; }
}

/**
 * Il nome del modulo nella colonna di icone del menu collassato (SXADV-6277).
 *
 * Fino a SXADV-6264 i popup dei moduli si aprivano al passaggio del mouse e la
 * loro testata diceva il nome del modulo: era quello il "tooltip" che
 * identificava l'icona. Da quando si aprono col clic (6264/6270/6271, che
 * resta) passando sull'icona non compariva piu' niente, e antd il tooltip lo
 * mette da se' solo sulle voci SENZA figli, non sui moduli.
 *
 * Il nome resta il testo della voce (nascosto da antd a menu collassato, letto
 * dagli screen reader); accanto c'e' un'ancora invisibile, larga quanto la riga
 * (CSS in sidebarMenu.css), a cui si aggancia il tooltip. Gli eventi si
 * ascoltano sul titolo del sottomenu, non sull'icona: vale tutta la riga, e il
 * fuoco da tastiera (rc-menu lo mette sul titolo con le frecce) lo mostra come
 * il passaggio del mouse; il fuoco dato dal clic o dal ritorno sulla finestra
 * no. Il tooltip sparisce alla pressione del mouse o all'apertura da tastiera e
 * non compare finche' un popup del menu e' aperto: la testata del popup dice
 * gia' il nome, e il tooltip (z-index piu' alto) coprirebbe le sue voci.
 */
export const ModuleRailLabel = React.memo(function ModuleRailLabel({ name }: { name: string }) {
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const title = anchorRef.current?.closest<HTMLElement>('.ant-menu-submenu-title');
    if (!title) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopTimer = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
    let pressing = false;
    const popupOpen = () => title.getAttribute('aria-expanded') === 'true'
      || !!title.closest('.ant-menu-submenu-open')
      || anySidebarPopupOpen();
    const show = () => { stopTimer(); if (!pressing && !popupOpen()) setOpen(true); };
    const hide = () => { stopTimer(); setOpen(false); };
    const onFocus = () => { if (keyboardFocus(title)) show(); };
    const onDown = () => { pressing = true; hide(); };
    const onUp = () => { pressing = false; };
    const onEnter = () => { stopTimer(); timer = setTimeout(show, MODULE_TOOLTIP_DELAY_MS); };
    const onKey = (e: KeyboardEvent) => {
      // Invio, spazio, freccia: si apre il popup, il tooltip lascia il posto.
      if (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow') || e.key === 'Escape') hide();
    };
    title.addEventListener('mouseenter', onEnter);
    title.addEventListener('mouseleave', hide);
    title.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp, true);
    title.addEventListener('click', hide);
    title.addEventListener('focus', onFocus);
    title.addEventListener('blur', hide);
    title.addEventListener('keydown', onKey);
    return () => {
      stopTimer();
      title.removeEventListener('mouseenter', onEnter);
      title.removeEventListener('mouseleave', hide);
      title.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp, true);
      title.removeEventListener('click', hide);
      title.removeEventListener('focus', onFocus);
      title.removeEventListener('blur', hide);
      title.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      {name}
      <Tooltip title={name} placement="right" open={open}>
        <span ref={anchorRef} className={MODULE_TOOLTIP_ANCHOR_CLASS} aria-hidden="true" />
      </Tooltip>
    </>
  );
});
