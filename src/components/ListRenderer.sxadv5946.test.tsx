// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from 'antd';
import ts from 'typescript';
import type { UITree, UIRow, UIControl } from '../types/ui';
import { ELTYPE_CONTAINER, ELTYPE_CONTENT } from '../types/ui';
import shellSorgente from './Shell.tsx?raw';

// SXADV-5946 — griglia incorporata con headerShown="false" e piu' di una pagina:
// CORE manda un'intestazione SENZA titolo (title:'') che porta solo i numeri
// della barra di pagine. Il client deve mostrare la barra e niente titolo vuoto.
//
// Come si prova. DOM vero (jsdom) e antd vero: i clic sono clic veri sui bottoni
// della barra. AG Grid e' sostituita da un segnaposto: la griglia non e' sotto
// prova e in jsdom non ha dimensioni. applyDetailPage (Shell.tsx) non e' esportata:
// si estrae dal sorgente e si compila qui, cosi' la prova vede la funzione vera.
//
// Cosa NON si prova: l'aspetto a schermo e il giro col server (CORE).

vi.mock('ag-grid-react', () => ({ AgGridReact: () => <div data-testid="griglia" /> }));

const { default: ListRenderer } = await import('./ListRenderer');
const { default: ViewRenderer } = await import('./ViewRenderer');

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  class FakeRO { observe() {} unobserve() {} disconnect() {} }
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  // jsdom non ha un canvas: ListRenderer misura i testi e sa fare a meno del contesto.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const PATH = 'S1-0.2,S1-3.0';

const row = (pos: number, text = `Nome ${pos}`): UIRow => ({
  id: `r${pos}`,
  props: { path: `${PATH.slice(0, -2)}.${pos}` },
  cells: [{ elementType: ELTYPE_CONTENT, colspan: 1, text, control: { name: `nome.S1-3.${pos}`, id: 'nome', type: 'text', editable: false, value: text } }],
} as unknown as UIRow);

const HEADER = { title: '', path: PATH, recordCount: 1216, pageSize: 100, position: 0 };
const PAGING = (over: Partial<NonNullable<UITree['paging']>> = {}) =>
  ({ currentPage: 2, totalPages: 13, totalRows: 1216, pageSize: 100, position: 100, ...over }) as NonNullable<UITree['paging']>;

function griglia(over: Record<string, unknown> = {}): UITree {
  return {
    pageType: 1,
    viewName: 'docRigheList',
    path: PATH,
    headers: [{ text: 'Nome', colspan: 1 }],
    rows: [row(0), row(1), row(2)],
    header: HEADER,
    ...over,
  } as unknown as UITree;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function monta(ui: UITree, embedded = true) {
  const onAction = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const disegna = (u: UITree) => act(() => {
    root!.render(<App><ListRenderer ui={u} onAction={onAction} embedded={embedded} /></App>);
  });
  disegna(ui);
  return { onAction, ridisegna: disegna };
}

const testo = () => host!.textContent ?? '';
const haBarra = () => !!host!.querySelector('.ant-pagination');
const bottoneIcona = (icona: string): HTMLButtonElement => {
  const b = host!.querySelector(`.anticon-${icona}`)?.closest('button');
  if (!b) throw new Error(`manca il bottone con icona ${icona}: ${host!.innerHTML}`);
  return b as HTMLButtonElement;
};
const prima = () => bottoneIcona('vertical-right');
const ultima = () => bottoneIcona('vertical-left');
const paginaCorrente = () => {
  const i = host!.querySelector<HTMLInputElement>('.ant-pagination-simple-pager input');
  if (!i) throw new Error(`manca il campo della pagina corrente: ${host!.innerHTML}`);
  return i.value;
};
const clic = (el: Element) => act(() => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
const dopo = () => {
  const el = host!.querySelector('.ant-pagination-next');
  if (!el) throw new Error('manca «pagina dopo»');
  return el.querySelector('button') ?? el;
};

describe('SXADV-5946: intestazione senza titolo, piu\' di una pagina', () => {
  it('mostra i record, prima e ultima pagina e la pagina corrente', () => {
    monta(griglia());
    expect(haBarra()).toBe(true);
    expect(testo()).toContain('1216 record');
    expect(prima()).toBeTruthy();
    expect(ultima()).toBeTruthy();
    expect(paginaCorrente()).toBe('1');
  });

  it('non disegna un titolo vuoto', () => {
    monta(griglia());
    expect(host!.querySelector('.view-title')).toBeNull();
    expect(host!.querySelector('.view-subtitle')).toBeNull();
  });

  it('un titolo vero resta, insieme alla barra', () => {
    monta(griglia({ header: { ...HEADER, title: 'Righe documento' } }));
    expect(host!.querySelector('.view-title')?.textContent).toBe('Righe documento');
    expect(haBarra()).toBe(true);
  });

  it('la pagina corrente viene dalla position', () => {
    monta(griglia({ header: { ...HEADER, position: 200 } }));
    expect(paginaCorrente()).toBe('3');
  });

  it('pagina dopo: DetailPage col path della griglia e pagina 2', () => {
    const { onAction } = monta(griglia());
    clic(dopo());
    expect(onAction).toHaveBeenCalledTimes(1);
    // Il contratto dice page:2; onAction porta parametri di richiesta, Record<string,string>.
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '2' });
  });

  it('ultima pagina: DetailPage con la 13', () => {
    const { onAction } = monta(griglia());
    clic(ultima());
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '13' });
  });

  it('prima pagina da pagina 3: DetailPage con la 1', () => {
    const { onAction } = monta(griglia({ header: { ...HEADER, position: 200 } }));
    clic(prima());
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '1' });
  });

  it('agli estremi il salto e\' spento e non chiama nessuno', () => {
    const { onAction } = monta(griglia());
    expect(prima().disabled).toBe(true);
    expect(ultima().disabled).toBe(false);
    clic(prima());
    expect(onAction).not.toHaveBeenCalled();
  });

  it('sull\'ultima pagina e\' spenta «ultima»', () => {
    monta(griglia({ header: { ...HEADER, position: 1200 } }));
    expect(paginaCorrente()).toBe('13');
    expect(ultima().disabled).toBe(true);
    expect(prima().disabled).toBe(false);
  });
});

describe('SXADV-5946: quando la barra non c\'e\'', () => {
  it('recordCount uguale a pageSize', () => {
    monta(griglia({ header: { ...HEADER, recordCount: 100 } }));
    expect(haBarra()).toBe(false);
    expect(testo()).not.toContain('100 record');
  });

  it('recordCount minore di pageSize', () => {
    monta(griglia({ header: { ...HEADER, recordCount: 7 } }));
    expect(haBarra()).toBe(false);
    expect(testo()).not.toContain('7 record');
  });

  it('senza header: niente barra e nessun errore', () => {
    const errori = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => monta(griglia({ header: undefined }))).not.toThrow();
      expect(haBarra()).toBe(false);
      expect(host!.querySelector('.view-title')).toBeNull();
      expect(errori).not.toHaveBeenCalled();
    } finally {
      errori.mockRestore();
    }
  });

  it('senza header e senza righe: nessun errore', () => {
    expect(() => monta(griglia({ header: undefined, rows: [] }))).not.toThrow();
    expect(haBarra()).toBe(false);
  });

  it('lista a pagina intera (non incorporata): la barra e\' quella della toolbar, non questa', () => {
    monta(griglia(), false);
    expect(haBarra()).toBe(false);
  });
});

describe('SXADV-5946: dopo un aggiornamento vale ui.paging', () => {
  it('ui.paging prevale sui numeri vecchi dell\'intestazione', () => {
    monta(griglia({ paging: PAGING({ currentPage: 5, position: 400, totalRows: 900, totalPages: 9 }) }));
    expect(testo()).toContain('900 record');
    expect(testo()).not.toContain('1216 record');
    expect(paginaCorrente()).toBe('5');
  });

  it('il clic parte dalla pagina di ui.paging', () => {
    const { onAction } = monta(griglia({ paging: PAGING({ currentPage: 5, position: 400 }) }));
    clic(dopo());
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '6' });
  });

  it('ui.paging di una pagina sola toglie la barra anche se l\'intestazione ne dice tante', () => {
    monta(griglia({ paging: PAGING({ currentPage: 1, totalPages: 1, totalRows: 40, position: 0 }) }));
    expect(haBarra()).toBe(false);
  });

  it('ridisegnando con ui.paging la barra si aggiorna', () => {
    const { ridisegna, onAction } = monta(griglia());
    expect(paginaCorrente()).toBe('1');
    ridisegna(griglia({ paging: PAGING() }));
    expect(paginaCorrente()).toBe('2');
    expect(prima().disabled).toBe(false);
    clic(dopo());
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '3' });
  });
});

// ---------------------------------------------------------------------------
// Shell.applyDetailPage: non esportata, estratta dal sorgente senza toccarlo.
// ---------------------------------------------------------------------------

type ApplyDetailPage = (ui: UITree, path: string, rows: UIRow[], paging: UITree['paging']) => UITree;

function estraiApplyDetailPage(): ApplyDetailPage {
  const inizio = shellSorgente.indexOf('function applyDetailPage(');
  if (inizio < 0) throw new Error('applyDetailPage non si trova piu\' in Shell.tsx');
  // La funzione e' a livello di modulo: finisce alla prima graffa a colonna zero.
  const fine = shellSorgente.indexOf('\n}', inizio);
  const js = ts.transpile(shellSorgente.slice(inizio, fine + 2), {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
  });
  return new Function(`${js}\nreturn applyDetailPage;`)() as ApplyDetailPage;
}
const applyDetailPage = estraiApplyDetailPage();

const controlloGriglia = (over: Record<string, unknown> = {}): UIControl => ({
  type: 'detailView',
  id: 'righe',
  name: 'righe',
  pageType: 1,
  viewName: 'docRigheList',
  headers: [{ text: 'Nome', colspan: 1 }],
  header: HEADER,
  rows: [row(0)],
  ...over,
} as unknown as UIControl);

const form = (...controlli: UIControl[]): UITree => ({
  pageType: 0,
  viewName: 'documentiDetail',
  path: 'S1-0.2',
  rows: controlli.map((control, i) => ({
    id: `f${i}`,
    cells: [{ elementType: ELTYPE_CONTAINER, colspan: 1, control }],
  })),
} as unknown as UITree);

const controlloDi = (ui: UITree, i = 0) => ui.rows[i].cells[0].control as unknown as {
  rows?: UIRow[]; contentRows?: UIRow[]; paging?: UITree['paging'];
  header?: { title?: string; path?: string; position?: number; recordCount?: number };
};

describe('SXADV-5946: Shell.applyDetailPage con intestazione senza titolo', () => {
  const nuove = [row(100), row(101)];

  it('trova il controllo e gli sostituisce righe e paginazione', () => {
    const prima = form(controlloGriglia());
    const dopo = applyDetailPage(prima, PATH, nuove, PAGING());
    expect(dopo).not.toBe(prima);
    expect(controlloDi(dopo).rows).toEqual(nuove);
    expect(controlloDi(dopo).paging).toEqual(PAGING());
  });

  it('l\'intestazione resta senza titolo e col suo path, coi numeri nuovi', () => {
    const dopo = applyDetailPage(form(controlloGriglia()), PATH, nuove, PAGING());
    expect(controlloDi(dopo).header).toMatchObject({ title: '', path: PATH, position: 100, recordCount: 1216 });
  });

  it('griglia con le righe in contentRows', () => {
    const dopo = applyDetailPage(
      form(controlloGriglia({ rows: undefined, contentRows: [row(0)] })), PATH, nuove, PAGING(),
    );
    expect(controlloDi(dopo).contentRows).toEqual(nuove);
    expect(controlloDi(dopo).paging).toEqual(PAGING());
  });

  it('griglia annidata dentro un tab', () => {
    const tab = {
      type: 'tab', id: 't', name: 't',
      contentRows: [{ id: 'x', cells: [{ elementType: ELTYPE_CONTAINER, colspan: 1, control: controlloGriglia() }] }],
    } as unknown as UIControl;
    const dopo = applyDetailPage(form(tab), PATH, nuove, PAGING());
    const interno = (controlloDi(dopo).contentRows as UIRow[])[0].cells[0].control as unknown as { rows: UIRow[] };
    expect(interno.rows).toEqual(nuove);
  });

  it('un altro path non tocca niente e rende lo stesso oggetto', () => {
    const prima = form(controlloGriglia());
    expect(applyDetailPage(prima, 'S1-0.2,S1-9.0', nuove, PAGING())).toBe(prima);
  });

  it('la griglia accanto, con un altro path, resta identica', () => {
    const altra = controlloGriglia({ header: { ...HEADER, path: 'S1-0.2,S1-4.0' } });
    const prima = form(controlloGriglia(), altra);
    const dopo = applyDetailPage(prima, PATH, nuove, PAGING());
    expect(dopo.rows[1]).toBe(prima.rows[1]);
    expect(controlloDi(dopo).rows).toEqual(nuove);
  });
});

describe('SXADV-5946: dal controllo del server alla barra, attraverso ViewRenderer', () => {
  // La sola strada che porta l'intestazione dentro una griglia incorporata:
  // ViewRenderer ricopia a mano i campi del controllo in un UITree.
  function montaForm(ui: UITree) {
    const onAction = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const disegna = (u: UITree) => act(() => {
      root!.render(<App><ViewRenderer ui={u} onAction={onAction} onChange={() => undefined} /></App>);
    });
    disegna(ui);
    return { onAction, disegna };
  }

  it('la barra compare e il clic porta il path dell\'intestazione', () => {
    const { onAction } = montaForm(form(controlloGriglia()));
    expect(testo()).toContain('1216 record');
    expect(host!.querySelector('.view-title')).toBeNull();
    clic(dopo());
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '2' });
  });

  it('dopo applyDetailPage la barra e\' sulla pagina nuova e la prossima e\' la 3', () => {
    const iniziale = form(controlloGriglia());
    const { onAction, disegna } = montaForm(iniziale);
    disegna(applyDetailPage(iniziale, PATH, [row(100)], PAGING()));
    expect(paginaCorrente()).toBe('2');
    clic(dopo());
    expect(onAction).toHaveBeenCalledWith('DetailPage', { navpath: PATH, page: '3' });
  });

  it('griglia di una pagina sola nel form: nessuna barra', () => {
    montaForm(form(controlloGriglia({ header: undefined, path: PATH })));
    expect(host!.querySelector('[data-testid="griglia"]')).not.toBeNull();
    expect(haBarra()).toBe(false);
  });
});
