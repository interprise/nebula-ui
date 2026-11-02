import type { ModalProps } from 'antd';

/**
 * Footer delle finestre con un'azione e "Annulla": l'azione prima, Annulla
 * all'estrema destra, come nel legacy (SXADV-5779). E' il primo pulsante che il
 * puntatore incontra arrivando da destra, quindi quello che non fa danni.
 *
 * L'ordine e' nel DOM e non nel CSS, cosi' il Tab segue quello che si vede. Vale
 * per `<Modal footer=...>` e per `modal.confirm({ footer })`; un footer scritto a
 * mano, o un Drawer, mette gli stessi pulsanti nello stesso ordine.
 */
export const annullaADestra: Extract<ModalProps['footer'], (...args: never[]) => unknown> = (
  _,
  { OkBtn, CancelBtn },
) => (
  <>
    <OkBtn />
    <CancelBtn />
  </>
);
