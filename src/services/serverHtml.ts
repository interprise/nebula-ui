/**
 * Server-emitted HTML snippets (view prompts, hints, HtmlFormat content, list
 * cell HTML, toolbar help, banners) come from view XML / domain code written
 * for the legacy UI, which was served from /entrasp/ — so they reference
 * assets with document-relative URLs like src="images/icons/telephone.png".
 * The React app's document base is /entrasp/app/, so those URLs now resolve
 * to /entrasp/app/images/... → 404 (broken icon), even though the assets are
 * all still served at /entrasp/images/... (SXADV: broken prompt icons).
 *
 * Rewrite relative images/ references to the legacy-absolute /entrasp/ base
 * at the point of injection. Only the known "images/" convention is touched;
 * absolute, http(s) and data: URLs pass through untouched.
 */
export function fixServerHtml(html: string): string {
  if (!html || !html.includes('images/')) return html;
  return html.replace(/(src|href)=(["'])images\//gi, '$1=$2/entrasp/images/');
}

/** Tag di formattazione del testo che un messaggio puo' portare. */
const MESSAGE_TAGS = new Set(['BR', 'B', 'STRONG', 'I', 'EM', 'U', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI']);
/** Elementi che spariscono con tutto il contenuto: il loro testo non e' testo da leggere. */
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TITLE', 'TEXTAREA', 'SELECT']);

/**
 * I testi dei messaggi del server (entrasp.properties) portano un po' di
 * formattazione — `<br>`, `<b>`, `<u>` — ma i loro parametri (%1, %2…) sono
 * valori presi dal record: descrizioni, nomi, codici scritti dagli utenti.
 * Messi in pagina cosi' come arrivano, un valore con `<img onerror=…>` girerebbe
 * nel browser di chi legge il messaggio (SXADV-5814).
 *
 * Restano solo i tag di formattazione, senza alcun attributo; gli altri
 * elementi lasciano il proprio testo, quelli di DROPPED_TAGS spariscono. Il
 * parsing avviene in un documento inerte (DOMParser): nessuno script eseguito,
 * nessuna risorsa caricata.
 */
export function sanitizeMessageHtml(html: string): string {
  if (!html || !html.includes('<')) return html;
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const clean = (parent: Node) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        continue;
      }
      const el = node as Element;
      const tag = el.tagName.toUpperCase();
      if (DROPPED_TAGS.has(tag)) {
        el.remove();
        continue;
      }
      clean(el);
      if (MESSAGE_TAGS.has(tag)) {
        for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
      } else {
        el.replaceWith(...Array.from(el.childNodes));
      }
    }
  };
  clean(body);
  return body.innerHTML;
}
