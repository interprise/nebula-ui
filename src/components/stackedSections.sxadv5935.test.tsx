import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from 'antd';
import type { UITree, UIRow } from '../types/ui';
import { ELTYPE_CONTENT, ELTYPE_CONTAINER } from '../types/ui';

// SXADV-5935 — un dettaglio a due aree il cui pannello inferiore porta due o piu'
// viste incorporate SENZA tab (Sottoconti: Versioni, Riclass., Sottolivello, Sedi,
// Riclassificazioni) non divide l'altezza in parti uguali: le sezioni si impilano,
// ognuna alta quanto il suo contenuto, e scorre l'area.
//
// Niente DOM nel progetto. Qui serve il percorso INTERO, ViewRenderer ->
// DetailFormView -> pannello -> vista incorporata -> ListRenderer -> griglia, e il
// punto delicato e' dove arriva un contesto React: con un motore di hook finto si
// proverebbe la propagazione del finto. Quindi resa lato server con React vero,
// come ListRenderer.search.sxadv4569.test.tsx, e l'esito si legge come dato: le
// props di AgGridReact catturate da uno stub, classi e stili dall'HTML. Gli effetti
// non girano: la misura di fillCapHeight non si prova, si prova solo che la griglia
// abbia un'altezza fissa invece di domLayout autoHeight.

const griglie = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('ag-grid-react', async () => {
  const { createElement } = await import('react');
  return {
    AgGridReact: (p: Record<string, unknown>) => {
      griglie.props.push(p);
      return createElement('div', { className: 'griglia-stub' });
    },
  };
});

const { default: ViewRenderer, SidContext } = await import('./ViewRenderer');
const { UiModeStoreContext, ZoomScopeContext } = await import('../hooks/uiMode');

// Come in ListRenderer.search: dopo l'import, ai moduli serve solo per misurare.
const g = globalThis as Record<string, unknown>;
if (typeof g.document === 'undefined') {
  g.document = { createElement: () => ({ getContext: () => null, style: {} }) };
}
if (typeof g.window === 'undefined') g.window = { innerHeight: 800, innerWidth: 1280 };

/* ── Fixture: la forma che manda il server ──────────────────────────────── */

interface OpzioniSezione {
  visible?: boolean;
  metaTitle?: string;
  gridTitle?: string;
  type?: 'detailView' | 'embeddedView';
}

/** Una vista incorporata in forma di lista. */
function sezione(viewName: string, o: OpzioniSezione = {}) {
  const path = `S1-0.1,${viewName}`;
  return {
    elementType: ELTYPE_CONTAINER,
    id: `cella_${viewName}`,
    ...(o.visible === undefined ? {} : { visible: o.visible }),
    control: {
      type: o.type ?? 'detailView',
      id: viewName,
      name: viewName,
      viewName,
      pageType: 1,
      headers: [{ text: 'Codice', colspan: 1 }],
      rows: [0, 1].map((pos) => ({
        id: `${viewName}_r${pos}`,
        props: { path: `${path}.${pos}` },
        cells: [{
          elementType: ELTYPE_CONTENT, colspan: 1, text: `v${pos}`,
          control: { name: `codice.${pos}`, id: 'codice', type: 'text', editable: false, value: `v${pos}` },
        }],
      })),
      header: { path, ...(o.metaTitle ? { title: o.metaTitle } : {}) },
      gridActions: { path, addCommand: 'Add', ...(o.gridTitle ? { title: o.gridTitle } : {}) },
    },
  };
}

/** Un tab selezionato il cui contenuto e' una griglia. */
function tabConGriglia(viewName: string) {
  return {
    elementType: ELTYPE_CONTAINER,
    id: 'cella_tab',
    control: {
      type: 'tab', id: 'schede', name: 'schede', controlName: 'schede', navpath: 'S1-0.1',
      tabs: [{ name: 'generale', prompt: 'Generale', selected: true }],
      contentViewName: 'schedaWrapper',
      contentRows: [{ id: 'tc0', cells: [{ ...sezione(viewName), colspan: 1 }] }],
    },
  };
}

const TESTATA: UIRow = {
  id: 'h0',
  cells: [
    { elementType: 0, prompt: 'Conto:' },
    { elementType: 1, control: { type: 'text', name: 'conto', id: 'conto', value: '12' } },
  ],
} as unknown as UIRow;

/** Dettaglio a due aree: testata, poi una riga di pannello per ogni gruppo di celle. */
function dettaglio(...righePannello: unknown[][]): UITree {
  return {
    viewName: 'sottocontiDetail',
    pageType: 2,
    path: 'S1-0.1',
    rows: [TESTATA, ...righePannello.map((cells, i) => ({ id: `b${i}`, cells }))],
  } as unknown as UITree;
}

/* ── Resa e lettura ─────────────────────────────────────────────────────── */

const SCOPE = 'S1|sottocontiDetail';

function rendi(ui: UITree, zoomedGrid?: string): string {
  griglie.props.length = 0;
  const store = {
    immersive: false, setImmersive: () => {},
    zoomByScope: zoomedGrid ? { [SCOPE]: zoomedGrid } : {},
    setZoomForScope: () => {},
    oneLineGrids: {}, setOneLineForScope: () => {},
  };
  return renderToStaticMarkup(
    <App>
      <SidContext.Provider value="S1">
        <UiModeStoreContext.Provider value={store as never}>
          <ZoomScopeContext.Provider value={SCOPE}>
            <ViewRenderer ui={ui} onAction={() => undefined} onChange={() => undefined} onGridChange={() => undefined} />
          </ZoomScopeContext.Provider>
        </UiModeStoreContext.Provider>
      </SidContext.Provider>
    </App>,
  );
}

/** Il tag di apertura di ogni elemento con quella classe. */
function aperture(html: string, cls: string): string[] {
  const re = new RegExp(`<div\\b[^>]*class="(?:[^"]*\\s)?${cls}(?:\\s[^"]*)?"[^>]*>`, 'g');
  return html.match(re) ?? [];
}

/** L'HTML del div che si apre a `start`, fino alla sua chiusura. */
function bloccoDa(html: string, start: number): string {
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + 6);
  }
  return html.slice(start);
}

/** La cella del pannello: il figlio diretto di .view-split-bottom. */
function figliDelPannello(html: string): string[] {
  const [apertura] = aperture(html, 'view-split-bottom');
  expect(apertura, '.view-split-bottom presente').toBeDefined();
  const start = html.indexOf(apertura);
  const interno = bloccoDa(html, start).slice(apertura.length, -'</div>'.length);
  const out: string[] = [];
  for (let i = 0; i < interno.length;) {
    if (!interno.startsWith('<div', i)) { i++; continue; }
    const b = bloccoDa(interno, i);
    out.push(b);
    i += b.length;
  }
  return out;
}

const apertoDi = (blocco: string) => blocco.slice(0, blocco.indexOf('>') + 1);

/** Il contenitore immediato di ogni griglia, nell'ordine di resa. */
function contenitoriGriglia(html: string): string[] {
  return html.match(/<div\b[^>]*>(?=<div class="griglia-stub")/g) ?? [];
}

/** Altezza fissa in pixel scritta sul contenitore, se c'e'. */
function altezzaFissa(contenitore: string): number | null {
  const m = /[";]height:\s*([\d.]+)px/.exec(contenitore);
  return m ? Number(m[1]) : null;
}

const domLayout = () => griglie.props.map((p) => p.domLayout);

/** Quante volte `testo` e' scritto come contenuto di un elemento. */
function occorrenze(html: string, testo: string): number {
  return (html.match(new RegExp(`>${testo}<`, 'g')) ?? []).length;
}

beforeEach(() => { griglie.props.length = 0; });

/* ── Prove ──────────────────────────────────────────────────────────────── */

describe('fixture (prerequisito)', () => {
  it('il dettaglio si divide in due aree e ogni sezione disegna la sua griglia', () => {
    const html = rendi(dettaglio([sezione('versioniList')], [sezione('sediList')]));
    expect(aperture(html, 'view-split-form')).toHaveLength(1);
    expect(aperture(html, 'view-split-bottom')).toHaveLength(1);
    expect(griglie.props).toHaveLength(2);
    expect(contenitoriGriglia(html)).toHaveLength(2);
  });

  it('il tab del pannello disegna davvero la griglia che ha dentro', () => {
    const html = rendi(dettaglio([tabConGriglia('righeList')]));
    expect(aperture(html, 'tab-content')).toHaveLength(1);
    expect(griglie.props).toHaveLength(1);
    expect(contenitoriGriglia(html)).toHaveLength(1);
  });
});

describe('SXADV-5935 — 1. la pila di sezioni non divide l\'altezza', () => {
  // Le due forme possibili: una riga per sezione, o piu' celle sulla stessa riga.
  const forme: [string, () => UITree][] = [
    ['una riga per sezione', () => dettaglio([sezione('versioniList')], [sezione('sediList')])],
    ['due celle sulla stessa riga', () => dettaglio([sezione('versioniList'), sezione('sediList')])],
  ];

  it.each(forme)('%s: il pannello ha la classe stacked', (_n, ui) => {
    const [pannello] = aperture(rendi(ui()), 'view-split-bottom');
    expect(pannello).toMatch(/class="[^"]*\bview-split-bottom--stacked\b/);
  });

  it.each(forme)('%s: ogni sezione e\' .bottom-section con flex 0 0 auto', (_n, ui) => {
    const sezioni = aperture(rendi(ui()), 'bottom-section');
    expect(sezioni).toHaveLength(2);
    for (const s of sezioni) expect(s).toMatch(/flex:\s*0 0 auto/);
  });

  it('cinque sezioni come Sottoconti: tutte impilate, nessuna a flex 1', () => {
    const nomi = ['versioni', 'riclass', 'sottolivello', 'sedi', 'riclassificazioni'];
    const html = rendi(dettaglio(...nomi.map((n) => [sezione(`${n}List`)])));
    const sezioni = aperture(html, 'bottom-section');
    expect(sezioni).toHaveLength(5);
    for (const s of sezioni) expect(s).not.toMatch(/flex:\s*1\b/);
  });

  it('anche con viste embeddedView, non solo detailView', () => {
    const html = rendi(dettaglio(
      [sezione('versioniList', { type: 'embeddedView' })],
      [sezione('sediList', { type: 'embeddedView' })],
    ));
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(1);
    expect(aperture(html, 'bottom-section')).toHaveLength(2);
  });

  it('delle tre sezioni una e\' nascosta: due visibili restano una pila, quella nascosta non si disegna', () => {
    const html = rendi(dettaglio(
      [sezione('versioniList')],
      [sezione('nascostaList', { visible: false })],
      [sezione('sediList')],
    ));
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(1);
    expect(aperture(html, 'bottom-section')).toHaveLength(2);
    expect(griglie.props).toHaveLength(2);
  });
});

describe('SXADV-5935 — 2. griglie delle sezioni alte quanto il contenuto', () => {
  it('ogni griglia in una pila ha domLayout autoHeight', () => {
    rendi(dettaglio([sezione('versioniList')], [sezione('sediList')]));
    expect(domLayout()).toEqual(['autoHeight', 'autoHeight']);
  });

  it('il contenitore di ogni griglia non ha un\'altezza fissa', () => {
    const html = rendi(dettaglio([sezione('versioniList')], [sezione('sediList')]));
    const cont = contenitoriGriglia(html);
    expect(cont).toHaveLength(2);
    for (const c of cont) expect(altezzaFissa(c), c).toBeNull();
  });

  it('il contenitore non ritaglia: overflow hidden taglierebbe la griglia', () => {
    const html = rendi(dettaglio([sezione('versioniList')], [sezione('sediList')]));
    for (const c of contenitoriGriglia(html)) expect(c).not.toMatch(/overflow:\s*hidden/);
  });
});

describe('SXADV-5935 — 3. un solo titolo per sezione', () => {
  const ENTRAMBI = { metaTitle: 'Versioni', gridTitle: 'Versioni' };
  const altra = () => sezione('sediList', { gridTitle: 'Sedi' });

  it('meta.title e gridActions.title uguali: il testo compare una volta sola', () => {
    const html = rendi(dettaglio([sezione('versioniList', ENTRAMBI)], [altra()]));
    expect(occorrenze(html, 'Versioni')).toBe(1);
  });

  it('meta.title e gridActions.title diversi: un solo titolo, non due blocchi', () => {
    const html = rendi(dettaglio(
      [sezione('versioniList', { metaTitle: 'Titolo vista', gridTitle: 'Titolo griglia' })],
      [altra()],
    ));
    const [prima] = figliDelPannello(html);
    expect(occorrenze(prima, 'Titolo vista') + occorrenze(prima, 'Titolo griglia')).toBe(1);
  });

  it('solo meta.title: resta, altrimenti la sezione non avrebbe nome', () => {
    const html = rendi(dettaglio([sezione('versioniList', { metaTitle: 'Versioni' })], [altra()]));
    expect(occorrenze(html, 'Versioni')).toBe(1);
  });

  it('solo gridActions.title: resta', () => {
    const html = rendi(dettaglio([sezione('versioniList', { gridTitle: 'Versioni' })], [altra()]));
    expect(occorrenze(html, 'Versioni')).toBe(1);
  });

  it('griglia zoomata in una pila con entrambi i titoli: sempre un titolo solo', () => {
    const html = rendi(
      dettaglio([sezione('versioniList', ENTRAMBI)], [altra()]),
      'versioniList',
    );
    expect(occorrenze(html, 'Versioni')).toBe(1);
  });
});

describe('SXADV-5935 — 4a. guardia: una sola sezione visibile (SXADV-5874.5)', () => {
  const unaVisibile = () => dettaglio(
    [sezione('azioniList')],
    [sezione('cerved1List', { visible: false })],
    [sezione('cerved2List', { visible: false })],
    [sezione('cerved3List', { visible: false })],
    [sezione('cerved4List', { visible: false })],
  );

  it('nessuna classe stacked sul pannello ne\' sulle sezioni', () => {
    const html = rendi(unaVisibile());
    expect(aperture(html, 'view-split-bottom')).toHaveLength(1);
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(0);
    expect(aperture(html, 'bottom-section')).toHaveLength(0);
  });

  it('la sezione riempie l\'area: flex 1', () => {
    const figli = figliDelPannello(rendi(unaVisibile()));
    expect(figli).toHaveLength(1);
    expect(apertoDi(figli[0])).toMatch(/flex:\s*1\b/);
    expect(apertoDi(figli[0])).not.toMatch(/0 0 auto/);
  });

  it('la griglia resta misurata: niente autoHeight, altezza fissa', () => {
    const html = rendi(unaVisibile());
    expect(domLayout()).toEqual([undefined]);
    const [cont] = contenitoriGriglia(html);
    expect(altezzaFissa(cont), cont).toBeGreaterThan(0);
  });

  it('i due titoli di una sezione sola restano com\'erano', () => {
    const html = rendi(dettaglio([sezione('azioniList', { metaTitle: 'Vista', gridTitle: 'Griglia' })]));
    expect(occorrenze(html, 'Vista')).toBe(1);
    expect(occorrenze(html, 'Griglia')).toBe(1);
  });

  it('due celle sulla stessa riga, una nascosta: non e\' una pila', () => {
    const html = rendi(dettaglio([sezione('azioniList'), sezione('cerved1List', { visible: false })]));
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(0);
    expect(domLayout()).toEqual([undefined]);
  });
});

describe('SXADV-5935 — 4b. guardia: il pannello col solo tab', () => {
  it('non e\' stacked e la griglia nel tab resta misurata', () => {
    const html = rendi(dettaglio([tabConGriglia('righeList')]));
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(0);
    expect(aperture(html, 'bottom-section')).toHaveLength(0);
    expect(domLayout()).toEqual([undefined]);
    expect(altezzaFissa(contenitoriGriglia(html)[0]) ?? 0).toBeGreaterThan(0);
  });

  it('un tab e una sezione sola: nessuna pila, si conta solo la sezione', () => {
    const html = rendi(dettaglio([sezione('versioniList')], [tabConGriglia('righeList')]));
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(0);
    expect(domLayout()).toEqual([undefined, undefined]);
  });
});

describe('SXADV-5935 — 4c. guardia: griglia zoomata in una pila', () => {
  it('la griglia zoomata non e\' piu\' autoHeight e riprende l\'altezza fissa', () => {
    const html = rendi(dettaglio([sezione('versioniList')], [sezione('sediList')]), 'versioniList');
    expect(griglie.props[0].domLayout).toBeUndefined();
    expect(altezzaFissa(contenitoriGriglia(html)[0]) ?? 0).toBeGreaterThan(0);
  });

  it('solo quella: l\'altra sezione della pila resta alta quanto il contenuto', () => {
    const html = rendi(dettaglio([sezione('versioniList')], [sezione('sediList')]), 'versioniList');
    expect(griglie.props[1].domLayout).toBe('autoHeight');
    expect(altezzaFissa(contenitoriGriglia(html)[1])).toBeNull();
  });
});

describe('SXADV-5935 — 4d. guardia: il tab accanto a due sezioni', () => {
  // La griglia nel tab non e' una sezione della pila: vive nell'area scorrevole del
  // tab e deve misurarsi su quella, altrimenti una griglia lunga spinge via la
  // barra dei tab invece di scorrere dentro.
  const misto = () => dettaglio(
    [sezione('versioniList')],
    [sezione('sediList')],
    [tabConGriglia('righeList')],
  );

  it('fixture: ci sono tre griglie, e la terza e\' quella del tab', () => {
    const html = rendi(misto());
    expect(griglie.props).toHaveLength(3);
    const tab = html.indexOf('tab-content');
    expect(tab).toBeGreaterThan(html.lastIndexOf('bottom-section'));
    expect(html.indexOf('griglia-stub', tab)).toBeGreaterThan(tab);
  });

  it('le due sezioni restano una pila', () => {
    const html = rendi(misto());
    expect(aperture(html, 'view-split-bottom--stacked')).toHaveLength(1);
    expect(aperture(html, 'bottom-section')).toHaveLength(2);
    expect(domLayout().slice(0, 2)).toEqual(['autoHeight', 'autoHeight']);
  });

  it('la griglia nel tab NON eredita autoHeight', () => {
    rendi(misto());
    expect(griglie.props[2].domLayout).toBeUndefined();
  });

  it('la griglia nel tab conserva l\'altezza misurata', () => {
    const html = rendi(misto());
    expect(altezzaFissa(contenitoriGriglia(html)[2]) ?? 0).toBeGreaterThan(0);
  });

  it('il titolo della griglia nel tab non viene toccato dalla regola della pila', () => {
    const conTitoli = sezione('righeList', { metaTitle: 'Vista tab', gridTitle: 'Griglia tab' });
    const tab = tabConGriglia('righeList');
    tab.control.contentRows = [{ id: 'tc0', cells: [{ ...conTitoli, colspan: 1 }] }];
    const html = rendi(dettaglio([sezione('versioniList')], [sezione('sediList')], [tab]));
    expect(occorrenze(html, 'Vista tab')).toBe(1);
    expect(occorrenze(html, 'Griglia tab')).toBe(1);
  });
});
