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

/**
 * Cosa un punto della UI accetta dall'HTML del server. I testi arrivano dal
 * dominio e dalle view, ma dentro ci finiscono valori del record — descrizioni,
 * nomi, parametri dei messaggi — scritti dagli utenti: messi in pagina cosi'
 * come arrivano, un `<img onerror=…>` girerebbe nel browser di chi guarda
 * (SXADV-5814 per i messaggi, poi tutti gli altri punti).
 */
export interface HtmlPolicy {
  /** Tag ammessi, in maiuscolo. Gli altri lasciano solo il proprio testo. */
  tags: ReadonlySet<string>;
  /** Attributi ammessi per tag; `*` vale per tutti i tag ammessi. */
  attrs: Readonly<Record<string, readonly string[]>>;
}

const TEXT_TAGS = ['BR', 'B', 'STRONG', 'I', 'EM', 'U', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI'];
const RICH_TEXT_TAGS = ['FONT', 'SMALL', 'SUB', 'SUP', 'PRE', 'CODE', 'HR', 'NOBR', 'CENTER', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
const TABLE_TAGS = ['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP', 'COL'];
const LINK_AND_IMAGE_ATTRS = {
  A: ['href', 'target'],
  IMG: ['src', 'alt', 'width', 'height', 'border', 'align'],
  FONT: ['color', 'size'],
};
const CELL_ATTRS = ['colspan', 'rowspan', 'width', 'valign', 'nowrap'];

export const HTML_POLICY: Readonly<Record<'message' | 'prompt' | 'cell' | 'content', HtmlPolicy>> = {
  /** Messaggi del server: solo formattazione, nessun attributo. */
  message: { tags: new Set(TEXT_TAGS), attrs: {} },
  /** Etichette dei campi: testo formattato e le icone accanto (`<img src="images/icons/…">`). */
  prompt: {
    tags: new Set([...TEXT_TAGS, 'FONT', 'NOBR', 'SMALL', 'SUB', 'SUP', 'IMG', 'A']),
    attrs: { '*': ['class', 'style', 'title'], ...LINK_AND_IMAGE_ATTRS },
  },
  /** Celle di lista e del pannello di riga: valori composti (#br#, #b#), classi
   *  del foglio legacy che portano icone, immagini e link. */
  cell: {
    tags: new Set([...TEXT_TAGS, ...RICH_TEXT_TAGS, 'IMG', 'A']),
    attrs: { '*': ['class', 'style', 'title'], ...LINK_AND_IMAGE_ATTRS },
  },
  /** Contenuti HTML veri (htmlFormat, avvisi, aiuto, banner, testi della
   *  toolbar, descrizioni dei controlli del plugin): anche le tabelle. */
  content: {
    tags: new Set([...TEXT_TAGS, ...RICH_TEXT_TAGS, ...TABLE_TAGS, 'IMG', 'A']),
    attrs: {
      '*': ['class', 'style', 'title', 'align'],
      ...LINK_AND_IMAGE_ATTRS,
      TD: CELL_ATTRS, TH: CELL_ATTRS,
      TABLE: ['width', 'border', 'cellpadding', 'cellspacing'],
      COL: ['width', 'span'],
    },
  },
};

/** Elementi che spariscono con tutto il contenuto: il loro testo non e' testo da leggere. */
const DROPPED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET',
  'NOSCRIPT', 'TITLE', 'TEXTAREA', 'SELECT', 'SVG', 'MATH', 'LINK', 'META', 'BASE',
]);

/** Toglie gli spazi e i caratteri di controllo che il browser ignora dentro uno
 *  schema (`java\tscript:` e' ancora javascript:). */
const compactUrl = (value: string) =>
  Array.from(value).filter((ch) => ch.charCodeAt(0) > 32 && ch.charCodeAt(0) !== 127).join('');
const urlScheme = (value: string) => /^([a-z][a-z0-9+.-]*):/i.exec(compactUrl(value))?.[1].toLowerCase();

/** Link: relativi, http(s), mailto, tel. Niente javascript:, data:, vbscript:… */
const isSafeHref = (value: string) => {
  const scheme = urlScheme(value);
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme);
};

/** Immagini: relative, http(s), o data: di un'immagine raster (niente svg, che
 *  porta script). */
const isSafeSrc = (value: string) => {
  const scheme = urlScheme(value);
  if (!scheme) return true;
  if (scheme === 'http' || scheme === 'https') return true;
  return scheme === 'data' && /^data:image\/(png|gif|jpe?g|webp|bmp)[;,]/i.test(compactUrl(value));
};

/** Stile inline senza modi per caricare o eseguire qualcosa. */
const isSafeStyle = (value: string) =>
  !/url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:|-moz-binding/i.test(value);

/**
 * Filtra l'HTML del server secondo la politica del punto in cui finisce. Il
 * parsing avviene in un documento inerte (DOMParser): nessuno script eseguito,
 * nessuna risorsa caricata. Restano i tag della politica con i soli attributi
 * ammessi e valori sicuri (mai un `on*`); gli altri elementi lasciano il proprio
 * testo; quelli di DROPPED_TAGS spariscono.
 */
export function sanitizeServerHtml(html: string, policy: HtmlPolicy): string {
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
      if (!policy.tags.has(tag)) {
        el.replaceWith(...Array.from(el.childNodes));
        continue;
      }
      const allowed = [...(policy.attrs['*'] ?? []), ...(policy.attrs[tag] ?? [])];
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const ok = allowed.includes(name)
          && (name !== 'href' || isSafeHref(attr.value))
          && (name !== 'src' || isSafeSrc(attr.value))
          && (name !== 'style' || isSafeStyle(attr.value))
          && (name !== 'target' || ['_blank', '_self'].includes(attr.value.toLowerCase()));
        if (!ok) el.removeAttribute(attr.name);
      }
      if (tag === 'A' && el.getAttribute('target')?.toLowerCase() === '_blank') {
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  clean(body);
  return body.innerHTML;
}

/** I messaggi del server: solo formattazione, nessun attributo (SXADV-5814). */
export function sanitizeMessageHtml(html: string): string {
  return sanitizeServerHtml(html, HTML_POLICY.message);
}

/** Il punto unico per mettere in pagina HTML del server: filtro della politica
 *  del punto, poi i percorsi `images/` riportati alla base del legacy. */
export function serverHtml(html: string, policy: HtmlPolicy): string {
  return fixServerHtml(sanitizeServerHtml(html, policy));
}
