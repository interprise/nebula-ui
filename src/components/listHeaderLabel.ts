import { serverHtml, HTML_POLICY } from '../services/serverHtml';

/**
 * L'etichetta di una colonna di lista come arriva dal server (`ui.headers[].text`,
 * `ui.continuationHeaders[][].text`): e' il prompt del ViewItem, che il legacy
 * scriveva nella pagina come HTML. Alcuni portano l'icona accanto al nome —
 * `Telefono: <img src="images/icons/telephone.png">` nei contatti e nelle
 * estrazioni dati, dove il prompt sta nel DB (DATA_VIEW_ITEM) — e scritti come
 * testo mostravano il tag invece dell'icona (SXADV-5771).
 *
 * - `text`: l'etichetta leggibile, senza markup: e' quella che AG Grid usa per
 *   menu, esportazione e copia, e quella su cui si misura la colonna.
 * - `html`: solo se il prompt porta markup o entita'; filtrato con la politica
 *   delle etichette dei campi, la stessa dei prompt della form (SXADV-5741.4).
 */
export interface ListHeaderLabel {
  text: string;
  html?: string;
}

const cache = new Map<string, ListHeaderLabel>();

export function listHeaderLabel(raw: string | null | undefined): ListHeaderLabel {
  if (!raw) return { text: '' };
  if (!/[<&]/.test(raw)) return { text: raw };
  let label = cache.get(raw);
  if (!label) {
    const html = serverHtml(raw, HTML_POLICY.prompt);
    const text = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    label = { text, html };
    cache.set(raw, label);
  }
  return label;
}
