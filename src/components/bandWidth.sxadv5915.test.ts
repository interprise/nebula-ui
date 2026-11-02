import SRC from './ListRenderer.tsx?raw';
import ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import { columnsOverflow } from './oneLineOffer';

/* SXADV-5915. Niente jsdom nel progetto: measureColsOverflow e widthsFromOffsets
   non sono esportate, quindi si estraggono dal sorgente VERO e si eseguono su un
   DOM finto; le regole si leggono da global.css VERO. La resa non si prova qui: le
   geometrie citate nei commenti sono misurate in Chrome con AG Grid e global.css
   reali, e sono la ragione dei test sui ritagli. */

// Il CSS si legge da disco: in vitest `?raw` su un .css torna vuoto. Il nome del
// modulo e' una stringa perche' tsconfig.app non ha i tipi di node.
const fs = await import(/* @vite-ignore */ 'node:fs' as string);
const CSS: string = fs.readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  if (a < 0) throw new Error(`non trovato: ${from}`);
  const b = text.indexOf(to, a);
  if (b < 0) throw new Error(`non trovato: ${to}`);
  return text.slice(a + from.length, b);
}

const js = (code: string) => ts.transpile(code, { target: ts.ScriptTarget.ES2022 });

/* --- La funzione vera, su un DOM finto ------------------------------------- */

const MEASURE_BODY = js(between(SRC, 'const measureColsOverflow = useCallback(() => {', '}, [getGridViewport]);'));

function fakeGrid(opts: { widths: number[]; clientWidth: number; destroyed?: boolean; noViewport?: boolean }) {
  const props = new Map<string, string>();
  const state = { ...opts };
  const container = {
    style: {
      setProperty: (k: string, v: string) => { props.set(k, v); },
      removeProperty: (k: string) => { props.delete(k); },
    },
  };
  const api = {
    isDestroyed: () => !!state.destroyed,
    getAllDisplayedColumns: () => state.widths.map((w) => ({ getActualWidth: () => w })),
  };
  const setColsOverflow = vi.fn();
  const run = new Function(
    'gridApiRef', 'getGridViewport', 'setColsOverflow', 'columnsOverflow', 'gridContainerRef',
    MEASURE_BODY,
  );
  const measure = () => run(
    { current: api },
    () => (state.noViewport ? null : { clientWidth: state.clientWidth }),
    setColsOverflow,
    columnsOverflow,
    { current: container },
  );
  return { measure, props, state, setColsOverflow };
}

const VAR = '--grid-cols-width';

describe('measureColsOverflow: --grid-cols-width', () => {
  it('colonne piu strette della griglia: il limite e la loro somma', () => {
    const g = fakeGrid({ widths: [100, 120, 80], clientWidth: 900 });
    g.measure();
    expect(g.props.get(VAR)).toBe('300px');
  });

  it('conta anche la colonna selettore bloccata: le bande le passano sopra', () => {
    const g = fakeGrid({ widths: [30, 100, 100], clientWidth: 900 });
    g.measure();
    expect(g.props.get(VAR)).toBe('230px');
  });

  it('colonne piu larghe: nessun limite', () => {
    const g = fakeGrid({ widths: [500, 500], clientWidth: 900 });
    g.measure();
    expect(g.props.has(VAR)).toBe(false);
  });

  it('colonne larghe esattamente come la griglia: nessun limite', () => {
    const g = fakeGrid({ widths: [450, 450], clientWidth: 900 });
    g.measure();
    expect(g.props.has(VAR)).toBe(false);
  });

  it('le colonne si allargano oltre la griglia: il limite di prima non resta', () => {
    const g = fakeGrid({ widths: [100], clientWidth: 900 });
    g.measure();
    expect(g.props.has(VAR)).toBe(true);
    g.state.widths = [1000, 200];
    g.measure();
    expect(g.props.has(VAR)).toBe(false);
  });

  it('la griglia si restringe (pannello, zoom): il limite cade', () => {
    const g = fakeGrid({ widths: [300, 300], clientWidth: 900 });
    g.measure();
    expect(g.props.get(VAR)).toBe('600px');
    g.state.clientWidth = 500;
    g.measure();
    expect(g.props.has(VAR)).toBe(false);
  });

  it('griglia nascosta (larghezza 0): nessun limite, e nessuno sforamento', () => {
    const g = fakeGrid({ widths: [100, 100], clientWidth: 0 });
    g.measure();
    expect(g.props.has(VAR)).toBe(false);
    expect(g.setColsOverflow).toHaveBeenCalledWith(false);
  });

  it('nessuna colonna a vista: nessun limite a 0px', () => {
    const g = fakeGrid({ widths: [], clientWidth: 900 });
    g.measure();
    expect(g.props.has(VAR)).toBe(false);
  });

  it('griglia distrutta o senza viewport: non tocca niente', () => {
    for (const o of [{ destroyed: true }, { noViewport: true }]) {
      const g = fakeGrid({ widths: [100], clientWidth: 900, ...o });
      g.measure();
      expect(g.props.size).toBe(0);
      expect(g.setColsOverflow).not.toHaveBeenCalled();
    }
  });

  it('la decisione sulla una-riga resta quella di prima', () => {
    const g = fakeGrid({ widths: [500, 500], clientWidth: 900 });
    g.measure();
    expect(g.setColsOverflow).toHaveBeenCalledWith(true);
  });
});

describe('quando si misura', () => {
  it.each(['onGridReady', 'onGridSizeChanged', 'onDisplayedColumnsChanged', 'onColumnResized', 'onModelUpdated'])(
    '%s rimisura', (ev) => {
      const line = SRC.split('\n').find((l) => l.trim().startsWith(`${ev}=`));
      expect(line).toBeDefined();
      expect(line).toContain('measureColsOverflow');
    },
  );
});

/* --- CSS -------------------------------------------------------------------- */

function rulesFor(fragment: string): { selector: string; body: string }[] {
  const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].includes(fragment)) out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

const limitRules = () => rulesFor('.ag-full-width-row').filter((r) => /max-width/.test(r.body));

describe('regola della banda', () => {
  it('usa la variabile e senza variabile non limita', () => {
    // Si limita il colore, non la riga: senza variabile il gradiente copre il 100%.
    expect(limitRules()).toEqual([]);
    const r = rulesFor('.ag-full-width-row.continuation-row');
    expect(r.map((x) => x.body).join(' ').replace(/\s+/g, ' ')).toContain('var(--grid-cols-width, 100%)');
  });

  it('non e scavalcata da un altro max-width su .ag-row', () => {
    expect(rulesFor('.ag-row').filter((r) => /max-width/.test(r.body) && !r.selector.includes('.ag-full-width-row'))).toEqual([]);
  });
});

const FOCUS = () => {
  const r = rulesFor('.ag-cell-focus');
  expect(r.length).toBe(1);
  return r[0];
};

describe('regola del bordo di fuoco', () => {
  it('riguarda solo la cella a fuoco e non i fuochi da tastiera', () => {
    const s = FOCUS().selector;
    expect(s).toContain('.ag-cell.ag-cell-focus');
    expect(s).toContain(':not(:focus-visible)');
  });

  it.each(['input', 'select', 'textarea', '.ant-select'])('esclude le celle con %s', (c) => {
    const has = FOCUS().selector.match(/:not\(:has\(([^)]*)\)\)/);
    expect(has).not.toBeNull();
    expect(has![1].split(',').map((t) => t.trim())).toContain(c);
  });

  it('batte il tema con !important', () => {
    expect(FOCUS().body).toMatch(/border-color:\s*transparent\s*!important/);
    expect(FOCUS().body).toMatch(/outline:\s*none\s*!important/);
  });

  it('non tocca il fuoco di riga di focusRow: il selettore e sulla cella', () => {
    expect(FOCUS().selector).not.toMatch(/\.ag-row/);
  });

  // ROSSO. AG Grid toglie il separatore delle colonne bloccate alla cella a fuoco
  // perche al suo posto mette il bordo; col bordo trasparente non resta nessuno dei
  // due. Chrome: borderRightColor trasparente, sulle altre righe alpha .15.
  it('l\'ultima colonna bloccata conserva il separatore dopo il clic', () => {
    const f = FOCUS();
    const safe = f.selector.includes('ag-cell-last-left-pinned') || !/border-color/.test(f.body);
    expect(safe).toBe(true);
  });
});

/* --- Il limite non deve tagliare il contenuto delle bande ------------------- */

const OFFSETS_FN = js(`function widthsFromOffsets(${between(SRC, 'function widthsFromOffsets(', '/** Height a continuation row')}`);
const widthsFromOffsets = new Function(`${OFFSETS_FN}; return widthsFromOffsets;`)() as (o: number[], s: number[]) => number[];
const RENDERER = between(SRC, 'const ContinuationRowRenderer =', '/** Detect continuation rows');
const clipsAtRow = () => {
  const row = rulesFor('.ag-full-width-row').filter((r) => /overflow/.test(r.body));
  return limitRules().some((r) => !/overflow:\s*visible/.test(r.body)) && !row.some((r) => /overflow:\s*visible/.test(r.body));
};
/** Le bande di continuazione hanno un limite che taglia? */
const limitTouchesBreakRows = () => limitRules().some((r) => !/continuation-row/.test(r.selector));

describe('contenuto delle bande e limite', () => {
  // ROSSO. In Chrome: 3 colonne da 100, cella in piu a x=367-467, riga limitata a
  // 330: la cella sparisce intera. Il caso e' dichiarato da widthsFromOffsets: la
  // banda puo avere piu unita delle colonne.
  it('una banda con piu unita delle colonne non perde le celle in coda', () => {
    const total = 300;
    const cells = widthsFromOffsets([0, 100, 200, 300], [1, 1, 1, 1]);
    const contentRight = cells.reduce((n, w) => n + w, 0);
    const limit = clipsAtRow() ? total : Infinity;
    expect(contentRight).toBeLessThanOrEqual(limit);
  });

  // ROSSO. Le celle di una banda non hanno classi ag-*, quindi sono content-box:
  // ogni cella misura w + 8 di padding. In Chrome con 3 colonne da 100 l'ultima
  // finisce 29px oltre il limite: un importo allineato a destra in ultima colonna
  // e tagliato sempre, per 8px a cella.
  it('il testo dell\'ultima cella resta dentro il limite', () => {
    const n = 3;
    const total = 300;
    const borderBox = /boxSizing:\s*'border-box'/.test(RENDERER);
    const contentRight = borderBox ? total : total + 8 * n;
    const limit = clipsAtRow() ? total : Infinity;
    expect(contentRight).toBeLessThanOrEqual(limit);
  });

  // ROSSO. SXADV-5457.1 lascia sbordare apposta i controlli (overflow: visible):
  // in Chrome un pulsante largo in ultima colonna arriva a 475 e la riga a 330.
  it('un controllo che sborda dalla cella non viene tagliato', () => {
    expect(RENDERER).toContain("overflow: 'visible'");
    expect(clipsAtRow()).toBe(false);
  });

  // ROSSO. Il selettore prende anche i separatori di gruppo: nowrap e overflow
  // hidden, in Chrome titolo da 517px in una riga da 330.
  it('il titolo di un separatore di gruppo non viene tagliato', () => {
    expect(limitTouchesBreakRows()).toBe(false);
  });
});
