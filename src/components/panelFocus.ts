// Il fuoco nel pannello di riga dopo un Nuovo (SXADV-6052.1): la riga appena
// creata si scrive subito, senza cliccarla nella lista e poi nel campo.
// Contratto: docs/features/20261013_SXADV-6052_nuovo_rigo.md

import { isUsableField, dialogOpen, revealVertically } from '../services/focusRestore';

/** Il primo campo su cui puo' andare il cursore nel corpo del pannello (la
 *  testa, con i bottoni, resta fuori). Stesso criterio del fuoco sulla pagina
 *  nuova (SXADV-5803). */
export function firstPanelField(panel: ParentNode | null): HTMLElement | null {
  const body = panel?.querySelector('.edit-panel-body');
  if (!body) return null;
  return Array.from(body.querySelectorAll('input, textarea, select')).find(isUsableField) ?? null;
}

/** Mette il cursore sul primo campo del pannello, col testo selezionato come
 *  sulla pagina nuova, e lo porta in vista solo in verticale (SXADV-5922). I
 *  controlli possono montarsi un fotogramma dopo il pannello: riprova per
 *  qualche fotogramma. `onFocused` scatta quando il cursore e' arrivato: chi
 *  ha chiesto il fuoco spegne la richiesta, che non deve ripetersi a un
 *  rimontaggio del pannello. Restituisce chi annulla i tentativi rimasti. */
export function focusFirstPanelField(panel: ParentNode | null, onFocused?: () => void): () => void {
  let attempts = 0;
  let raf = 0;
  let cancelled = false;
  const tryFocus = () => {
    if (cancelled || dialogOpen()) return;
    const target = firstPanelField(panel);
    if (target) {
      target.focus({ preventScroll: true });
      if (target instanceof HTMLInputElement && target.type === 'text' && !target.readOnly) target.select();
      revealVertically(target);
      onFocused?.();
      return;
    }
    if (++attempts < 10) raf = requestAnimationFrame(tryFocus);
  };
  raf = requestAnimationFrame(tryFocus);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}
