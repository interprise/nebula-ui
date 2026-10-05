/* Il contenuto di una cella in modalità "un record per riga" (SXADV-6012).

   Anagrafica Unica, Clienti e Fornitori hanno poche colonne e stanno nella
   finestra: le righe sono alte perché Indirizzo e Contatti vanno a capo, con un
   `<br/>` composto dal server (via e civico sopra, CAP e città sotto) o perché
   il testo non entra nella colonna. Mettere quei record su una riga senza
   toccare il contenuto ne taglierebbe metà: CAP, città e cellulare sparirebbero.

   Quindi, in modalità una-riga e solo per le liste senza bande di
   continuazione (Iscritti ha già la sua resa, collaudata):
   - gli a capo del markup diventano un separatore sulla stessa riga;
   - la colonna si allarga al contenuto, mai sotto la larghezza dichiarata e
     fino a un tetto: la lista scorre in orizzontale e il blocco delle prime
     colonne torna utile. */

/** Quello che prende il posto di un a capo. */
export const ONE_LINE_SEPARATOR = ' · ';

/** Oltre questa larghezza una colonna non cresce per il contenuto (i Contatti
 *  dei Fornitori stanno quasi tutti fra 490 e 580px; i piu' lunghi, con piu'
 *  telefoni e cellulari, arrivano a 940 e restano con l'ellissi): una nota
 *  lunga resta tagliata con l'ellissi invece di allargare la lista a dismisura. */
export const ONE_LINE_MAX_COL_WIDTH = 720;

/** Padding orizzontale della cella (4px per lato) più margine per gli
 *  arrotondamenti della misura. */
export const ONE_LINE_CELL_PAD = 14;

// Spazi comuni soltanto: `\s` prenderebbe anche U+00A0, che e' indentazione.
const BR_RUN = /(?:[ \t\r\n]*<br\s*\/?>[ \t\r\n]*)+/gi;
const BR_ANY = /<br\s*\/?>/i;

/** Il valore porta almeno un a capo di markup (`<br>`, `<br/>`, `<br />`, in
 *  qualunque maiuscolo). Un valore che non è una stringa non ne porta. */
export function hasLineBreak(value: unknown): boolean {
  return typeof value === 'string' && BR_ANY.test(value);
}

/** Gli a capo del markup diventano `separator`. Più a capo di fila (anche con
 *  spazi in mezzo) valgono uno solo; quelli in testa o in coda spariscono senza
 *  lasciare separatori; gli spazi attorno all'a capo sono assorbiti dal
 *  separatore. Il resto del markup resta com'è; un valore senza a capo torna
 *  identico. */
export function joinLineBreaks(html: string, separator: string = ONE_LINE_SEPARATOR): string {
  if (!html || !BR_ANY.test(html)) return html;
  const parts = html.split(BR_RUN);
  return parts.filter((p, i) => !((i === 0 || i === parts.length - 1) && p.trim() === '')).join(separator);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

/** Il testo che la cella mostra in modalità una-riga, per misurarne la
 *  larghezza: con `asHtml` gli a capo diventano `separator` e i tag spariscono;
 *  in entrambi i casi le entità diventano caratteri e gli spazi comuni (anche
 *  gli a capo veri del testo) si comprimono in uno, senza spazi in testa o in
 *  coda. Gli spazi non separabili (`&#160;`) restano tutti: sono indentazione
 *  voluta e occupano larghezza. */
export function oneLinePlainText(value: string, asHtml: boolean, separator: string = ONE_LINE_SEPARATOR): string {
  if (!value) return '';
  let text = value;
  if (asHtml) // Un tag comincia con una lettera (o `/`): `< 100` resta testo, come per
  // il browser.
  text = joinLineBreaks(text, separator).replace(/<\/?[a-z][^>]*>/gi, '');
  return decodeEntities(text).replace(/[ \t\r\n]+/g, ' ').replace(/^ | $/g, '');
}

/** Larghezza di una colonna in modalità una-riga: quella dichiarata, o quella
 *  del contenuto più largo (`contentWidth` + `pad`) se è maggiore, ma mai oltre
 *  `cap` per effetto del contenuto. Una colonna dichiarata già più larga del
 *  tetto resta com'è: il tetto limita la crescita, non restringe. Una misura
 *  non valida (NaN, negativa) lascia la larghezza dichiarata. */
export function fitWidthToContent(
  declared: number,
  contentWidth: number,
  { pad = ONE_LINE_CELL_PAD, cap = ONE_LINE_MAX_COL_WIDTH }: { pad?: number; cap?: number } = {},
): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return declared;
  const wanted = Math.ceil(contentWidth) + pad;
  return Math.max(declared, Math.min(cap, wanted));
}

/** I record della pagina vanno a capo per un a capo di markup? Basta un valore:
 *  è il segnale con cui la lista offre la modalità una-riga anche quando le
 *  colonne entrano nella finestra (Indirizzo e Contatti di Clienti). */
export function pageHasLineBreaks(values: Iterable<unknown>): boolean {
  for (const v of values) if (hasLineBreak(v)) return true;
  return false;
}
