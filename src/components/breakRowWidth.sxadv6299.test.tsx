import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from 'antd';
import type { UITree, UIRow } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_DUMMY, ELTYPE_SECTION_HEADER } from '../types/ui';

/* SXADV-6299 — la banda di rottura (riga di raggruppamento, riga server con
   cls 'breakRow' e una cella section header) non deve colorare lo spazio vuoto a
   destra dell'ultima colonna. Fonte di verita': il legacy, dove la banda e' una
   <td> larga quanto la tabella, cioe' quanto le colonne. Precedente: SXADV-5915.1
   per le bande di continuazione (bandWidth.sxadv5915.test.ts): ListRenderer
   scrive la somma delle colonne in --grid-cols-width sul contenitore quando e'
   minore del viewport, e la toglie quando le colonne sono piu' larghe.

   Come si prova. Niente layout (e nel worktree niente jsdom): ListRenderer si
   rende con renderToStaticMarkup, una passata senza effetti. AG Grid e' sostituita da un segnaposto che
   cattura le props: getRowClass, isFullWidthRow, fullWidthCellRenderer e rowData
   sono quelle vere di ListRenderer. Poi:
   - la RIGA: si cercano in global.css (vero, letto da disco) le regole che si
     applicano a un .ag-row.ag-full-width-row con le classi date da getRowClass,
     e si guarda se limitano il colore a --grid-cols-width;
   - il CONTENUTO: si rende la banda e si calcola, dallo stile scritto, fin dove
     arrivano sfondo e bordo di ogni elemento colorato, risolvendo
     var(--grid-cols-width, ...) come farebbe il browser nei due casi (colonne
     piu' strette / piu' larghe della griglia).
   Cosa NON si prova: la resa vera in Chrome, la misura delle colonne (gia'
   provata in bandWidth.sxadv5915.test.ts). */

const fs = await import(/* @vite-ignore */ 'node:fs' as string);
const CSS: string = fs.readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

type Props = Record<string, unknown> & {
  rowData: Record<string, unknown>[];
  getRowClass: (p: { data?: Record<string, unknown> }) => string | string[] | undefined;
  isFullWidthRow: (p: { rowNode: { data?: Record<string, unknown> } }) => boolean;
  fullWidthCellRenderer: (p: { data?: Record<string, unknown> }) => ReactElement | null;
};
const catturate = vi.hoisted(() => ({ props: null as unknown }));

vi.mock('ag-grid-react', () => ({
  AgGridReact: (p: unknown) => { catturate.props = p; return <div data-testid="griglia" />; },
}));

const { default: ListRenderer } = await import('./ListRenderer');

afterEach(() => { catturate.props = null; });

/* --- Una lista come Schede Contabili: rottura, record su due bande, record ---- */

const PATH = 'S1-0.0,S1-4';
const TITOLO = 'Conto 01.01.001 - Cassa contanti sede centrale';

const rottura = (n: number, text = TITOLO): UIRow => ({
  id: `b${n}`,
  cls: 'breakRow',
  cells: [{ elementType: ELTYPE_SECTION_HEADER, colspan: 3, text }],
} as unknown as UIRow);

const record = (pos: number): UIRow => ({
  id: `r${pos}`,
  cls: pos % 2 ? 'oddRow' : 'evenRow',
  props: { path: `${PATH}.${pos}` },
  cells: [
    { elementType: ELTYPE_CONTENT, colspan: 1, control: { name: `data.S1-4.${pos}`, id: 'data', type: 'text', editable: false, value: '01/10/2026' } },
    { elementType: ELTYPE_CONTENT, colspan: 1, control: { name: `desc.S1-4.${pos}`, id: 'desc', type: 'text', editable: false, value: `Movimento ${pos}` } },
    { elementType: ELTYPE_CONTENT, colspan: 1, control: { name: `imp.S1-4.${pos}`, id: 'imp', type: 'text', editable: false, value: '100,00' } },
  ],
} as unknown as UIRow);

const continuazione = (pos: number): UIRow => ({
  id: `c${pos}`,
  cls: pos % 2 ? 'oddRow' : 'evenRow',
  cells: [
    { elementType: ELTYPE_DUMMY, colspan: 1 },
    { elementType: ELTYPE_CONTENT, colspan: 2, control: { name: `note.S1-4.${pos}`, id: 'note', type: 'text', editable: false, value: `Nota ${pos}` } },
  ],
} as unknown as UIRow);

function lista(): UITree {
  return {
    pageType: 1,
    viewName: 'schedeContabiliList',
    path: PATH,
    headers: [
      { text: 'Data', colspan: 1 },
      { text: 'Descrizione', colspan: 1 },
      { text: 'Importo', colspan: 1 },
    ],
    continuationHeaders: [[{ text: '', colspan: 1 }, { text: 'Note', colspan: 2 }]],
    rows: [rottura(0), record(1), continuazione(1), record(2), rottura(1, 'Conto 01.01.002'), record(3)],
  } as unknown as UITree;
}

function monta(): Props {
  // Il minimo di browser che la resa tocca, solo per la durata della resa: la
  // misura dei testi fa a meno del canvas.
  const g = globalThis as Record<string, unknown>;
  const prima = g.document;
  g.document = { createElement: () => ({ getContext: () => null, style: {} }) };
  try {
    renderToStaticMarkup(<App><ListRenderer ui={lista()} onAction={vi.fn()} /></App>);
  } finally {
    g.document = prima;
  }
  if (!catturate.props) throw new Error('AgGridReact non montata');
  return catturate.props as Props;
}

const classi = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v.join(' ') : v ?? '').split(/\s+/).filter(Boolean);

const righe = (p: Props) => {
  // Si riconoscono dal comportamento: la rottura e' la riga a tutta larghezza
  // che mostra il titolo, la continuazione quella che mostra la nota.
  const full = (d: Record<string, unknown>) => p.isFullWidthRow({ rowNode: { data: d } });
  const mostra = (d: Record<string, unknown>, t: string) => {
    const el = p.fullWidthCellRenderer({ data: d });
    return !!el && renderToStaticMarkup(<App>{el}</App>).includes(t);
  };
  const rot = p.rowData.find((d) => full(d) && mostra(d, TITOLO));
  const cont = p.rowData.find((d) => full(d) && mostra(d, 'Nota 1'));
  const norm = p.rowData.find((d) => !full(d));
  if (!rot || !cont || !norm) throw new Error(`righe mancanti: ${JSON.stringify(p.rowData)}`);
  return { rot, cont, norm };
};

/* --- CSS: quali regole si applicano a una riga con certe classi -------------- */

const REGOLE = (() => {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
})();

/** Regole il cui selettore (composto, senza combinatori) colpisce l'elemento di
 *  riga che ha esattamente queste classi. Pseudo-classi di stato (:hover ecc.)
 *  non contano: si guarda la riga a riposo. */
function regoleDellaRiga(cls: string[]): { selector: string; body: string }[] {
  const set = new Set(cls);
  return REGOLE.filter((r) => r.selector.split(',').some((s) => {
    const sel = s.trim();
    if (!sel || /[\s>+~[]/.test(sel) || sel.includes(':')) return false;
    const tag = sel.match(/^[a-z]+/i);
    if (tag && tag[0].toLowerCase() !== 'div') return false;
    const toks = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
    return toks.length > 0 && toks.every((t) => set.has(t));
  }));
}

/** La regola limita il colore della riga alla larghezza delle colonne, e senza
 *  misura (colonne piu' larghe) resta piena. */
const PROP_COLORE = /^(background|background-image|background-size|width|max-width|clip-path|mask|mask-image)$/;
function limitaIlColore(rs: { body: string }[]): boolean {
  return rs.some((r) => r.body.split(';').some((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return false;
    const prop = decl.slice(0, i).trim();
    const val = decl.slice(i + 1);
    if (!PROP_COLORE.test(prop) || !val.includes('--grid-cols-width')) return false;
    const fallbacks = [...val.matchAll(/var\(\s*--grid-cols-width\s*(?:,\s*([^)]*))?\)/g)].map((m) => (m[1] ?? '').trim());
    return fallbacks.every((f) => f === '100%' || f === 'none');
  }));
}

const RIGA_AG = ['ag-row', 'ag-full-width-row'];

/* --- Contenuto: fin dove arriva il colore ------------------------------------ */

type Caso = { griglia: number; colonne: number[] };
/** Come il contratto di 5915: la variabile c'e' solo se le colonne sono piu' strette. */
const varColonne = (c: Caso): number | null => {
  const tot = c.colonne.reduce((a, b) => a + b, 0);
  return tot > 0 && tot < c.griglia ? tot : null;
};
const STRETTE: Caso = { griglia: 900, colonne: [100, 120, 80] };
const LARGHE: Caso = { griglia: 900, colonne: [500, 500] };

/** Un albero minimo dal markup di renderToStaticMarkup (niente DOM in node). */
type Nodo = { tag: string; style: string; children: Nodo[]; text: string };
function albero(markup: string): Nodo {
  const radice: Nodo = { tag: '#root', style: '', children: [], text: '' };
  const pila = [radice];
  const VUOTI = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'col', 'wbr']);
  for (const m of markup.matchAll(/<\/([\w-]+)>|<([\w-]+)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    const top = pila[pila.length - 1];
    if (m[1]) { pila.pop(); continue; }
    if (m[5]) { for (const n of pila) n.text += m[5]; continue; }
    const st = (m[3] ?? '').match(/\sstyle="([^"]*)"/);
    const n: Nodo = { tag: m[2], style: (st?.[1] ?? '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), children: [], text: '' };
    top.children.push(n);
    if (!m[4] && !VUOTI.has(m[2].toLowerCase())) pila.push(n);
  }
  return radice;
}
const tutti = (n: Nodo): Nodo[] => n.children.flatMap((c) => [c, ...tutti(c)]);

function stile(el: Nodo): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of el.style.split(';')) {
    const i = d.indexOf(':');
    if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
  }
  return out;
}

/** Risolve una lunghezza CSS semplice in px rispetto alla larghezza del padre. */
function px(v: string, padre: number, cols: number | null): number | null {
  const r = v.replace(/var\(\s*--grid-cols-width\s*(?:,\s*([^)]*))?\)/g, (_m, fb) =>
    (cols != null ? `${cols}px` : (fb ?? '').trim()));
  const t = r.trim();
  if (!t || t === 'auto' || t === 'none') return null;
  let m = t.match(/^(-?[\d.]+)px$/);
  if (m) return Number(m[1]);
  m = t.match(/^(-?[\d.]+)%$/);
  if (m) return (Number(m[1]) / 100) * padre;
  if (/^0$/.test(t)) return 0;
  const mm = t.match(/^min\((.*)\)$/);
  if (mm) {
    const parts = mm[1].split(',').map((p) => px(p, padre, cols));
    if (parts.every((p) => p != null)) return Math.min(...(parts as number[]));
  }
  throw new Error(`lunghezza non interpretata dal test: ${v}`);
}

const lato = (v: string | undefined, padre: number, cols: number | null) =>
  v ? (px(v.split(/\s+/)[0], padre, cols) ?? 0) : 0;
function orizzontali(s: Record<string, string>, k: 'padding' | 'border', padre: number, cols: number | null): number {
  if (k === 'border') {
    const w = (v?: string) => (v ? Number((v.match(/([\d.]+)px/) ?? [0, 0])[1]) : 0);
    const all = w(s.border);
    return (s['border-left'] != null ? w(s['border-left']) : all) + (s['border-right'] != null ? w(s['border-right']) : all);
  }
  const parts = (s.padding ?? '').split(/\s+/).filter(Boolean);
  const right = parts.length <= 1 ? parts[0] : parts[1];
  const left = parts.length <= 1 ? parts[0] : parts.length === 4 ? parts[3] : parts[1];
  return lato(s['padding-left'] ?? left, padre, cols) + lato(s['padding-right'] ?? right, padre, cols);
}

const COLORATO = (s: Record<string, string>) =>
  ['background', 'background-color', 'background-image', 'border', 'border-left', 'border-right', 'border-top', 'border-bottom']
    .some((k) => s[k] != null && !/^(none|transparent|0)$/.test(s[k]));

/** Margine destro dipinto (sfondo o bordo) da ogni elemento colorato della banda,
 *  in px dal bordo sinistro della riga. La riga a tutta larghezza e' larga quanto
 *  il viewport della griglia. */
function bordiDestri(markup: string, c: Caso): { el: string; destra: number }[] {
  const cols = varColonne(c);
  const out: { el: string; destra: number }[] = [];
  const visita = (el: Nodo, padre: number) => {
    const s = stile(el);
    let w = padre;
    const dich = s.width != null ? px(s.width, padre, cols) : null;
    const max = s['max-width'] != null ? px(s['max-width'], padre, cols) : null;
    if (dich != null) {
      w = s['box-sizing'] === 'border-box' ? dich : dich + orizzontali(s, 'padding', padre, cols) + orizzontali(s, 'border', padre, cols);
    }
    if (max != null) {
      const maxBox = s['box-sizing'] === 'border-box' ? max : max + orizzontali(s, 'padding', padre, cols) + orizzontali(s, 'border', padre, cols);
      w = Math.min(w, maxBox);
    }
    if (COLORATO(s)) out.push({ el: `<${el.tag} style="${el.style.slice(0, 60)}">`, destra: w });
    const interno = Math.max(0, w - orizzontali(s, 'padding', padre, cols) - orizzontali(s, 'border', padre, cols));
    for (const ch of el.children) visita(ch, interno);
  };
  for (const ch of albero(markup).children) visita(ch, c.griglia);
  return out;
}

const bandaMarkup = (p: Props, d: Record<string, unknown>) => {
  const el = p.fullWidthCellRenderer({ data: d });
  if (!el) throw new Error('nessun renderer per la banda di rottura');
  return renderToStaticMarkup(el);
};

/* --- Le prove ---------------------------------------------------------------- */

describe('SXADV-6299: la banda di rottura finisce con le colonne', () => {
  it('la banda di rottura e una riga a tutta larghezza col titolo del server', () => {
    const p = monta();
    const { rot } = righe(p);
    expect(p.isFullWidthRow({ rowNode: { data: rot } })).toBe(true);
    expect(bandaMarkup(p, rot)).toContain(TITOLO);
  });

  // ROSSO su HEAD: getRowClass non da' classi alla banda di rottura, quindi
  // nessuna regola di global.css la raggiunge e lo sfondo di riga (tema AG Grid,
  // hover) copre il viewport intero, oltre l'ultima colonna.
  it('colonne piu strette: lo sfondo della riga non prosegue oltre le colonne', () => {
    const p = monta();
    const { rot } = righe(p);
    const cls = [...RIGA_AG, ...classi(p.getRowClass({ data: rot }))];
    expect(limitaIlColore(regoleDellaRiga(cls))).toBe(true);
  });

  // ROSSO su HEAD: il riquadro azzurro (sfondo a gradiente e bordo) non ha
  // larghezza, quindi e' largo quanto la riga: 900px con colonne da 300px.
  it('colonne piu strette: sfondo e bordo del contenuto finiscono con l\'ultima colonna', () => {
    const p = monta();
    const { rot } = righe(p);
    const fine = bordiDestri(bandaMarkup(p, rot), STRETTE);
    expect(fine.length).toBeGreaterThan(0);
    const tot = STRETTE.colonne.reduce((a, b) => a + b, 0);
    expect(Math.max(...fine.map((f) => f.destra))).toBeLessThanOrEqual(tot);
  });

  it('colonne piu strette: la banda non si restringe sotto le colonne', () => {
    const p = monta();
    const { rot } = righe(p);
    const fine = bordiDestri(bandaMarkup(p, rot), STRETTE);
    const tot = STRETTE.colonne.reduce((a, b) => a + b, 0);
    // Il riquadro piu' esterno copre almeno le colonne, come la <td> legacy.
    expect(Math.max(...fine.map((f) => f.destra))).toBeGreaterThanOrEqual(tot);
  });

  it('colonne piu larghe della griglia: la banda resta piena', () => {
    const p = monta();
    const { rot } = righe(p);
    const fine = bordiDestri(bandaMarkup(p, rot), LARGHE);
    expect(fine.length).toBeGreaterThan(0);
    expect(Math.max(...fine.map((f) => f.destra))).toBe(LARGHE.griglia);
  });

  it('il testo della banda resta visibile', () => {
    const p = monta();
    const { rot } = righe(p);
    const doc = albero(bandaMarkup(p, rot));
    expect(doc.text).toContain(TITOLO);
    for (const el of tutti(doc)) {
      const s = stile(el);
      expect(s.display).not.toBe('none');
      expect(s.visibility).not.toBe('hidden');
      expect(s.opacity).not.toBe('0');
      expect(s['font-size']).not.toMatch(/^0(px)?$/);
      expect(s.color).not.toBe('transparent');
    }
    for (const c of [STRETTE, LARGHE]) {
      for (const f of bordiDestri(bandaMarkup(p, rot), c)) expect(f.destra).toBeGreaterThan(0);
    }
  });

  it('un titolo piu lungo delle colonne non viene tagliato dal limite', () => {
    // Come la <td> legacy, il testo non si perde: ne' la banda ne' la riga
    // nascondono cio' che sborda.
    const p = monta();
    const { rot } = righe(p);
    for (const el of tutti(albero(bandaMarkup(p, rot)))) {
      const s = stile(el);
      expect(s.overflow ?? 'visible').not.toMatch(/hidden|clip/);
      expect(s['text-overflow']).toBeUndefined();
    }
    const cls = [...RIGA_AG, ...classi(p.getRowClass({ data: rot }))];
    const overflowRiga = regoleDellaRiga(cls)
      .map((r) => r.body.match(/(?:^|;)\s*overflow\s*:\s*([^;]+)/)?.[1]?.trim())
      .filter(Boolean);
    expect(overflowRiga.every((o) => o === 'visible')).toBe(true);
  });
});

describe('SXADV-6299: le altre righe restano come sono', () => {
  it('le bande di continuazione (5915.1) restano limitate alle colonne', () => {
    const p = monta();
    const { cont } = righe(p);
    expect(p.isFullWidthRow({ rowNode: { data: cont } })).toBe(true);
    const cls = classi(p.getRowClass({ data: cont }));
    expect(cls).toContain('continuation-row');
    expect(cls).not.toContain('break-row');
    expect(limitaIlColore(regoleDellaRiga([...RIGA_AG, ...cls]))).toBe(true);
  });

  it('il rigo normale non e a tutta larghezza e non riceve il limite', () => {
    const p = monta();
    const { norm } = righe(p);
    expect(p.isFullWidthRow({ rowNode: { data: norm } })).toBe(false);
    expect(p.fullWidthCellRenderer({ data: norm })).toBeNull();
    const cls = classi(p.getRowClass({ data: norm }));
    expect(cls.some((c) => /break|continuation/.test(c))).toBe(false);
    expect(limitaIlColore(regoleDellaRiga(['ag-row', ...cls]))).toBe(false);
  });

  it('nessuna regola limita a --grid-cols-width un .ag-row qualunque', () => {
    // Il limite riguarda solo le righe a tutta larghezza: le righe a celle
    // finiscono gia' con l'ultima colonna.
    const generiche = REGOLE.filter((r) => /--grid-cols-width/.test(r.body)
      && r.selector.split(',').some((s) => !s.includes('ag-full-width-row')));
    expect(generiche).toEqual([]);
  });
});
