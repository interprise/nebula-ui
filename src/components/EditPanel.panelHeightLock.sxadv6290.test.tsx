// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from 'antd';
import type { UITree, ListHeader } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';
import { registerBuiltinControls } from '../controls/builtins';
import EditPanel from './EditPanel';

// SXADV-6290: il pannello "Gestione riga" e' alto quanto il suo contenuto, quindi
// passando con le frecce a un record con piu' righe di testo la testata (con le
// frecce) saltava in alto e il puntatore non stava piu' sulla freccia.
// Il contratto:
//  1. alla pressione di una freccia, PRIMA di onNavigate, .edit-panel prende
//     style.height = altezza resa corrente (getBoundingClientRect().height, px);
//  2. pressioni successive a blocco attivo tengono il PRIMO valore;
//  3. un cambio di rowPath dovuto alla freccia lascia il blocco;
//  4. un cambio di rowPath per altro motivo (clic su un'altra riga, Nuovo) lo toglie;
//  5. una pressione che non porta a un cambio di rowPath non lascia uno stato
//     "in sospeso" che faccia tenere il blocco a un cambio successivo estraneo;
//  6. altezza misurata 0 (niente impaginato) = nessuna altezza in linea.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  registerBuiltinControls();
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!(globalThis as { ResizeObserver?: unknown }).ResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
  }
});

/** L'altezza che "misura" il pannello: la si cambia fra un passo e l'altro. */
let altezzaPannello = 0;

beforeEach(() => {
  altezzaPannello = 0;
  const originale = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('edit-panel')) {
      const h = altezzaPannello;
      return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: h, width: 800, height: h, toJSON: () => ({}) } as DOMRect;
    }
    return originale.call(this);
  });
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const textCell = (name: string, value: string) => ({
  elementType: ELTYPE_CONTENT,
  colspan: 1,
  control: { name: `${name}.S1-2`, id: name, type: 'text', editable: false, value },
});

/** Contenuto del pannello per il record di quel percorso (righe di testo diverse). */
function panelFor(path: string): UITree {
  return { rows: [{ id: 'r0', cells: [textCell('descr', `Record ${path}`)] }], path, pageType: 1 } as unknown as UITree;
}

const headers: ListHeader[] = [{ text: 'Descrizione', colspan: 1 }];
const listUi = { rows: [], headers, path: 'S1-2', pageType: 1 } as unknown as UITree;

/** Il genitore: tiene il percorso della riga, e le frecce lo spostano (come la lista). */
let setPathEsterno: ((p: string) => void) | null = null;
let ordineChiamate: string[] = [];

interface HarnessProps {
  /** Cosa fa onNavigate: 'sposta' cambia riga, 'niente' non cambia niente. */
  navigazione: 'sposta' | 'niente';
}

const Harness: React.FC<HarnessProps> = ({ navigazione }) => {
  const [index, setIndex] = React.useState(10);
  const [pathEsterno, setPath] = React.useState<string | null>(null);
  React.useEffect(() => { setPathEsterno = (p) => setPath(p); }, []);
  const rowPath = pathEsterno ?? `S1-2.${index}`;
  const onNavigate = (delta: number) => {
    const el = document.querySelector<HTMLElement>('.edit-panel');
    ordineChiamate.push(`onNavigate(${delta}) height=${el?.style.height ?? '?'}`);
    if (navigazione === 'sposta') {
      setPath(null);
      setIndex((i) => i + delta);
    }
  };
  return (
    <App>
      <EditPanel panel={panelFor(rowPath)} listUi={listUi} rowPath={rowPath} formShape={false}
        onAction={() => {}} onClose={() => {}} onNavigate={onNavigate} hasPrev hasNext />
    </App>
  );
};

function mount(navigazione: HarnessProps['navigazione'] = 'sposta') {
  ordineChiamate = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Harness navigazione={navigazione} />));
  return host!;
}

function pannello(): HTMLElement {
  const el = host!.querySelector<HTMLElement>('.edit-panel');
  if (!el) throw new Error('.edit-panel non trovato');
  return el;
}

function freccia(label: 'Record precedente' | 'Record successivo'): HTMLButtonElement {
  const b = host!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!b) throw new Error(`bottone ${label} non trovato`);
  return b;
}

function premi(label: 'Record precedente' | 'Record successivo') {
  act(() => freccia(label).click());
}

/** Un cambio di riga che NON viene dalle frecce: clic su un'altra riga della griglia, Nuovo. */
function cambioEsterno(path: string) {
  act(() => setPathEsterno!(path));
}

const pausa = () => new Promise((r) => setTimeout(r, 0));

describe('EditPanel: altezza bloccata durante la navigazione con le frecce (SXADV-6290)', () => {
  it('prima di qualunque freccia il pannello non ha altezza in linea', () => {
    altezzaPannello = 237;
    mount();
    expect(pannello().style.height).toBe('');
  });

  it('"Record successivo" fissa l\'altezza resa corrente in px', () => {
    mount();
    altezzaPannello = 237;
    premi('Record successivo');
    expect(pannello().style.height).toBe('237px');
  });

  it('"Record precedente" fissa l\'altezza resa corrente in px', () => {
    mount();
    altezzaPannello = 180;
    premi('Record precedente');
    expect(pannello().style.height).toBe('180px');
  });

  it('l\'altezza e\' gia\' in linea quando parte onNavigate', () => {
    mount();
    altezzaPannello = 237;
    premi('Record successivo');
    expect(ordineChiamate).toEqual(['onNavigate(1) height=237px']);
  });

  it('il cambio di rowPath dovuto alla freccia lascia il blocco', () => {
    const h = mount();
    altezzaPannello = 237;
    premi('Record successivo');
    // Il genitore ha davvero cambiato riga.
    expect(h.textContent).toContain('Record S1-2.11');
    expect(pannello().style.height).toBe('237px');
  });

  it('pressioni successive tengono il PRIMO valore, anche se la misura cambia', () => {
    const h = mount();
    altezzaPannello = 237;
    premi('Record successivo');
    altezzaPannello = 320;
    premi('Record successivo');
    altezzaPannello = 150;
    premi('Record precedente');
    expect(h.textContent).toContain('Record S1-2.11');
    expect(pannello().style.height).toBe('237px');
  });

  it('un cambio di rowPath non dovuto alle frecce toglie l\'altezza', () => {
    mount();
    altezzaPannello = 237;
    premi('Record successivo');
    expect(pannello().style.height).toBe('237px');
    cambioEsterno('S1-2.40');
    expect(pannello().style.height).toBe('');
  });

  it('tolto il blocco, una nuova freccia rimisura', () => {
    mount();
    altezzaPannello = 237;
    premi('Record successivo');
    cambioEsterno('S1-2.40');
    altezzaPannello = 300;
    premi('Record successivo');
    expect(pannello().style.height).toBe('300px');
  });

  it('una freccia che non cambia riga non lascia un "in sospeso" per un cambio successivo', async () => {
    mount('niente');
    altezzaPannello = 237;
    premi('Record successivo');
    await act(async () => { await pausa(); });
    cambioEsterno('S1-2.40');
    expect(pannello().style.height).toBe('');
  });

  it('altezza misurata 0 (niente impaginato): nessuna altezza in linea', () => {
    mount();
    altezzaPannello = 0;
    premi('Record successivo');
    expect(pannello().style.height).toBe('');
  });
});
