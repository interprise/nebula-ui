// Marchio di prodotto nel client React (SXADV-6115).
//
// Il server dice quale prodotto e' (loginInfo.brand: "Pandora" con il modulo
// associativi, altrimenti "Nebula"); il client sceglie il marchio da solo.
//
// Pandora: il logo nuovo approvato per la linea REACT (quello delle slide del
// 30/09). Sta nel bundle e non in /entrasp/images/logos/ perche' il client
// classico deve restare com'e': pandora_bianco.png e logo_sx.png li usano anche
// ui.jsp e il riconoscimento di ALFA (Utenti.isAlfaEnvironment confronta
// logo_sx.png con le varianti *_alfa.png). Il PNG ha il fondo bianco pieno:
// sulla testata colorata va su una piastrina bianca, non ricolorato.
//
// Nebula: resta logo_sx.png, che su ALFA il rilascio sostituisce con la
// variante col vessillo.

import pandoraLogo from './assets/pandora-logo.png';
import pandoraFavicon from './assets/pandora-favicon.png';

const NEBULA_LOGO = '/entrasp/images/logos/logo_sx.png';

/** Il server manda esattamente "Pandora" (Utenti.getLoginInfo). */
const isPandora = (brand?: string): boolean => brand === 'Pandora';

/** Logo di prodotto della testata. */
export function productLogo(brand?: string): string {
  return isPandora(brand) ? pandoraLogo : NEBULA_LOGO;
}

/** Icona della scheda del browser per il prodotto; null = quella della pagina. */
export function brandFavicon(brand?: string): string | null {
  return isPandora(brand) ? pandoraFavicon : null;
}

/**
 * Mette l'icona del prodotto sulla scheda del browser. Prima del login il
 * prodotto non e' noto, quindi lo fa la Shell; la funzione restituita rimette
 * l'icona di prima (al logout si torna alla pagina di accesso).
 */
export function applyBrandFavicon(brand: string | undefined, doc: Document = document): () => void {
  const href = brandFavicon(brand);
  if (!href) return () => {};
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const created = !link;
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'icon';
    doc.head.appendChild(link);
  }
  const prevHref = link.getAttribute('href');
  const prevType = link.getAttribute('type');
  link.setAttribute('href', href);
  link.setAttribute('type', 'image/png');
  const el = link;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (created) {
      el.remove();
      return;
    }
    if (prevHref === null) el.removeAttribute('href');
    else el.setAttribute('href', prevHref);
    if (prevType === null) el.removeAttribute('type');
    else el.setAttribute('type', prevType);
  };
}
