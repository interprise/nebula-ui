// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ExpBuilderControl from './ExpBuilderControl';
import { DataVersionContext } from './dataVersion';
import type { UIControl } from '../types/ui';

// SXADV-6257: l'editor di espressioni (textarea) segue control.value quando il server
// lo cambia (frecce del pannello di riga, Nuovo che lo svuota) e quando cambia la
// versione dei dati; un ri-render con stesso valore e stessa versione non cancella
// il digitato.

vi.mock('../services/api', () => ({
  fetchMetadata: vi.fn(() => Promise.resolve([])),
}));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function ctrl(value: unknown): UIControl {
  return { type: 'expBuilder', name: 'esprRagg.S1-4', navpath: 'S1-4.0', editable: true, value } as unknown as UIControl;
}

function render(value: unknown, version: number, onChange: (v: unknown) => void = () => {}) {
  const el = (
    <DataVersionContext.Provider value={version}>
      <ExpBuilderControl control={ctrl(value)} onChange={onChange} />
    </DataVersionContext.Provider>
  );
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  act(() => root!.render(el));
}

function textarea(): HTMLTextAreaElement {
  const t = host!.querySelector('textarea');
  if (!t) throw new Error('textarea assente');
  return t;
}

/** Digita come l'utente: valore nativo + evento input (quello che React ascolta). */
function type(text: string) {
  const t = textarea();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(t, text);
    t.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ExpBuilderControl: il testo segue il server', () => {
  it('mostra il valore iniziale', () => {
    render('coalesce(idCondPag, x)', 1);
    expect(textarea().value).toBe('coalesce(idCondPag, x)');
  });

  it('freccia giu\': rigo 2 con un altro valore -> la textarea mostra il nuovo', () => {
    render('coalesce(idCondPag, x)', 1);
    render('idCentroGest', 2);
    expect(textarea().value).toBe('idCentroGest');
  });

  it('cambio valore anche senza cambio di versione -> segue il valore', () => {
    render('coalesce(idCondPag, x)', 1);
    render('idCentroGest', 1);
    expect(textarea().value).toBe('idCentroGest');
  });

  it('dopo Nuovo, valore null -> textarea vuota', () => {
    render('idCentroGest', 1);
    render(null, 2);
    expect(textarea().value).toBe('');
  });

  it('dopo Nuovo, valore stringa vuota -> textarea vuota', () => {
    render('idCentroGest', 1);
    render('', 2);
    expect(textarea().value).toBe('');
  });

  it('dopo Nuovo, valore undefined -> textarea vuota', () => {
    render('idCentroGest', 1);
    render(undefined, 2);
    expect(textarea().value).toBe('');
  });
});

describe('ExpBuilderControl: digitato', () => {
  it('onChange riceve il testo digitato', () => {
    const onChange = vi.fn();
    render('', 1, onChange);
    type('importo * 2');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]).toBe('importo * 2');
  });

  it('ri-render con stesso valore e stessa versione non cancella il digitato', () => {
    render('idCentroGest', 1);
    type('idCentroGest + 1');
    render('idCentroGest', 1);
    expect(textarea().value).toBe('idCentroGest + 1');
  });

  it('nuova versione con lo STESSO valore: torna al valore del server', () => {
    render('idCentroGest', 1);
    type('idCentroGest + 1');
    render('idCentroGest', 2);
    expect(textarea().value).toBe('idCentroGest');
  });

  it('dopo digitato su un record, Nuovo con valore vuoto svuota', () => {
    render('', 1);
    type('scritto a mano');
    render('', 2);
    expect(textarea().value).toBe('');
  });

  it('dopo digitato, cambio del valore del server lo sostituisce', () => {
    render('a', 1);
    type('a + b');
    render('idCentroGest', 1);
    expect(textarea().value).toBe('idCentroGest');
  });
});
