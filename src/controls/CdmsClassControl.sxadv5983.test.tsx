// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as antd from 'antd';
import { makeCdmsClassControl } from '../../../entrasp/react-plugins/entrasp-controls/src/CdmsClassControl';
import type { HostAPI, UIControl } from '../../../entrasp/react-plugins/entrasp-controls/src/hostApi';
import { withoutPositionalArrays } from '../services/positionalValues';

// SXADV-5983 — controllo cdmsClass (Gestione Documentale, cdmsRisorseDetail).
// Il server (CdmsClassUIControl.postData) legge due array allineati alle righe:
// <name> = valori scelti, <name>_2 = valori di partenza. Il navpath e' quello che
// il server manda davvero: ToolViewState.getPath() finisce SEMPRE con ".<posizione>".
//
// Due livelli: antd finto per il contratto (si chiama onChange della Select come
// fa antd), antd vero per verificare che la tendina funzioni davvero.

const NAME = 'this.S1-3';
const NAVPATH = 'S1-3.0';

type Row = {
  containerId: string;
  containerDescription: string;
  selectedKey?: string;
  resourceNodeKey?: string;
  selectedDescription?: string;
  options?: { value: string; text: string }[];
};

const opzioni = (...v: string[]) => v.map((value) => ({ value, text: `testo ${value}` }));
const righe = (): Row[] => [
  { containerId: 'c1', containerDescription: 'ANNO', options: opzioni('44|a1', '44|a2') },
  { containerId: 'c2', containerDescription: 'TIPO DOCUMENTO', selectedKey: '44|t1', resourceNodeKey: '44|t1|r1', options: opzioni('44|t1', '44|t2') },
  { containerId: 'c3', containerDescription: 'REPARTO', options: opzioni('44|d1') },
];

function controllo(extra: Partial<UIControl> = {}): UIControl {
  return { type: 'cdmsClass', name: NAME, navpath: NAVPATH, editable: true, isQuery: false, rows: righe(), ...extra };
}

// antd finto: la tabella disegna le colonne, la Select si legge come dato.
type SelectProps = { value?: string; onChange: (v: string | undefined) => void };
function hostFinto() {
  const selects: SelectProps[] = [];
  const bottoni: { onClick: () => void }[] = [];
  const Table = ({ dataSource, columns }: { dataSource: Row[]; columns: { render: (v: unknown, r: Row) => React.ReactNode; dataIndex?: string }[] }) => (
    <table><tbody>
      {dataSource.map((r) => (
        <tr key={r.containerId}>
          {columns.map((c, i) => <td key={i}>{c.render(c.dataIndex ? r[c.dataIndex as keyof Row] : undefined, r)}</td>)}
        </tr>
      ))}
    </tbody></table>
  );
  const Select = (p: SelectProps) => { selects.push(p); return <i data-select="1" />; };
  const Button = (p: { onClick: () => void; title?: string }) => { bottoni.push(p); return <button title={p.title} />; };
  const host = { React, antd: { Table, Select, Button } } as unknown as HostAPI;
  return { host, selects, bottoni };
}

let root: Root | null = null;
let box: HTMLElement | null = null;

function monta(C: React.ComponentType<Record<string, unknown>>, props: Record<string, unknown>) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<C {...props} />); });
}

function montaFinto(control: UIControl) {
  const { host, selects, bottoni } = hostFinto();
  const C = makeCdmsClassControl(host);
  const onChange = vi.fn();
  const onAction = vi.fn();
  // ordine delle chiamate condiviso
  const ordine: string[] = [];
  onChange.mockImplementation((n: string) => { ordine.push(`change:${n}`); });
  onAction.mockImplementation((a: string) => { ordine.push(`action:${a}`); });
  monta(C as never, { control, onChange, onAction });
  return { selects, bottoni, onChange, onAction, ordine };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // cio' che jsdom non ha e antd usa
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  box?.remove();
  box = null;
  document.body.innerHTML = '';
});

describe('SXADV-5983 — scelta in una riga', () => {
  it('onChange(name, array) allineato: nuovo valore in quella riga, selectedKey o "" nelle altre', () => {
    const { selects, onChange } = montaFinto(controllo());
    selects[0].onChange('44|a2');
    expect(onChange).toHaveBeenCalledWith(NAME, ['44|a2', '44|t1', '']);
  });

  it('la scelta nell\'ultima riga resta nell\'ultima posizione', () => {
    const { selects, onChange } = montaFinto(controllo());
    selects[2].onChange('44|d1');
    expect(onChange).toHaveBeenCalledWith(NAME, ['', '44|t1', '44|d1']);
  });

  it('cambiare una riga gia\' valorizzata: _2 conserva il valore di partenza', () => {
    const { selects, onChange } = montaFinto(controllo());
    selects[1].onChange('44|t2');
    expect(onChange).toHaveBeenCalledWith(NAME, ['', '44|t2', '']);
    expect(onChange).toHaveBeenCalledWith(`${NAME}_2`, ['', '44|t1', '']);
  });

  it('onChange(name_2, array) con i selectedKey di partenza, allineati', () => {
    const { selects, onChange } = montaFinto(controllo());
    selects[0].onChange('44|a1');
    expect(onChange).toHaveBeenCalledWith(`${NAME}_2`, ['', '44|t1', '']);
  });

  it('i due array hanno una voce per riga', () => {
    const { selects, onChange } = montaFinto(controllo());
    selects[0].onChange('44|a1');
    for (const [, v] of onChange.mock.calls) expect(v).toHaveLength(3);
  });

  it('Post una volta sola, dopo i due onChange, con navpath e option1 = name', () => {
    const { selects, onAction, ordine } = montaFinto(controllo());
    selects[0].onChange('44|a1');
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('Post', { navpath: NAVPATH, option1: NAME });
    expect(ordine).toEqual([`change:${NAME}`, `change:${NAME}_2`, 'action:Post']);
  });

  it('clear (undefined): "" in quella riga, _2 tiene il valore da togliere, Post parte', () => {
    const { selects, onChange, onAction } = montaFinto(controllo());
    selects[1].onChange(undefined);
    expect(onChange).toHaveBeenCalledWith(NAME, ['', '', '']);
    expect(onChange).toHaveBeenCalledWith(`${NAME}_2`, ['', '44|t1', '']);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('senza name non fa nulla', () => {
    const { selects, onChange, onAction } = montaFinto(controllo({ name: undefined }));
    selects[0].onChange('44|a1');
    expect(onChange).not.toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('senza navpath: i valori si, il Post no', () => {
    const { selects, onChange, onAction } = montaFinto(controllo({ navpath: undefined }));
    selects[0].onChange('44|a1');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('senza righe non si rompe', () => {
    const { selects } = montaFinto(controllo({ rows: undefined }));
    expect(selects).toHaveLength(0);
  });
});

describe('SXADV-5983 — il valore deve arrivare al server', () => {
  // postAction applica withoutPositionalArrays(formValues, navpath) prima di
  // spedire (services/api.ts). postData esce subito se <name> manca: mData == null.
  function spedito(navpath: string) {
    const { selects, onChange, onAction } = montaFinto(controllo({ navpath }));
    selects[0].onChange('44|a1');
    const form = Object.fromEntries(onChange.mock.calls as [string, string[]][]);
    return withoutPositionalArrays(form, onAction.mock.calls[0][1].navpath, onAction.mock.calls[0][1].option1);
  }

  it('dettaglio di primo livello: <name> non viene tolto dal filtro posizionale', () => {
    expect(spedito('S1-3.0')[NAME]).toEqual(['44|a1', '44|t1', '']);
  });

  it('dettaglio aperto da una lista: <name> non viene tolto dal filtro posizionale', () => {
    expect(spedito('S1-0.5,S1-3.0')[NAME]).toEqual(['44|a1', '44|t1', '']);
  });

  it('<name> e <name>_2 partono insieme o per niente', () => {
    const f = spedito('S1-3.0');
    expect(NAME in f).toBe(`${NAME}_2` in f);
  });
});

describe('SXADV-5983 — sola lettura', () => {
  it('nessuna tendina, si vede la descrizione', () => {
    const rows = righe().map((r) => ({ ...r, options: undefined, selectedDescription: r.selectedKey ? 'Fattura' : undefined }));
    const { selects, bottoni } = montaFinto(controllo({ editable: false, rows }));
    expect(selects).toHaveLength(0);
    expect(bottoni).toHaveLength(0);
    expect(box!.textContent).toContain('Fattura');
  });
});

describe('SXADV-5983 — modalita\' query (cdmsRisorseQuery, tag="class")', () => {
  // In query renderJSON non manda mai selectedKey (nodi resta vuoto).
  const qRows = (): Row[] => righe().map(({ containerId, containerDescription, options }) => ({ containerId, containerDescription, options }));
  const q = () => controllo({ isQuery: true, name: 'class.S1-7', navpath: 'S1-7.0', rows: qRows(), value: undefined });

  it('una scelta: array con "" nelle altre righe e nessun Post', () => {
    const { selects, onChange, onAction } = montaFinto(q());
    selects[1].onChange('44|t2');
    expect(onChange).toHaveBeenCalledWith('class.S1-7', ['', '44|t2', '']);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('nessun pulsante Elimina', () => {
    const { bottoni } = montaFinto(q());
    expect(bottoni).toHaveLength(0);
  });

  // Due scelte di fila: provato con antd vero piu' sotto; il finto non ridisegna.

});

describe('SXADV-5983 — pulsante Elimina', () => {
  // Toglie come la x della tendina: nessun comando che salvi la Session.
  it('solo sulla riga salvata', () => {
    const { bottoni } = montaFinto(controllo());
    expect(bottoni).toHaveLength(1);
  });

  it('svuota la riga con un Post, senza comando di cancellazione', () => {
    const { bottoni, onChange, onAction } = montaFinto(controllo());
    bottoni[0].onClick();
    expect(onChange).toHaveBeenCalledWith(NAME, ['', '', '']);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).toBe('Post');
  });
});

describe('SXADV-5983 — con antd vero', () => {
  const hostVero = { React, antd } as unknown as HostAPI;

  function montaVero(control: UIControl) {
    const onChange = vi.fn();
    const onAction = vi.fn();
    monta(makeCdmsClassControl(hostVero) as never, { control, onChange, onAction });
    return { onChange, onAction };
  }

  async function scegli(riga: number, testo: string) {
    const sel = box!.querySelectorAll('.ant-select')[riga];
    await act(async () => {
      sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });
    const opt = [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
      .filter((o) => o.isConnected)
      .find((o) => o.textContent === testo);
    expect(opt, `opzione ${testo}`).toBeTruthy();
    await act(async () => {
      opt!.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it('una tendina per riga, nessuna in sola lettura', () => {
    montaVero(controllo());
    expect(box!.querySelectorAll('.ant-select')).toHaveLength(3);
    act(() => { root?.unmount(); });
    box?.remove();
    montaVero(controllo({ editable: false }));
    expect(box!.querySelectorAll('.ant-select')).toHaveLength(0);
  });

  it('clic su un\'opzione: array allineato e Post una volta', async () => {
    const { onChange, onAction } = montaVero(controllo());
    await scegli(0, 'testo 44|a2');
    expect(onChange).toHaveBeenCalledWith(NAME, ['44|a2', '44|t1', '']);
    expect(onChange).toHaveBeenCalledWith(`${NAME}_2`, ['', '44|t1', '']);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('query: quello che la tendina mostra e\' quello che parte', async () => {
    // Select senza value e' non controllata: dopo la scelta continua a mostrarla.
    const rows = righe().map(({ containerId, containerDescription, options }) => ({ containerId, containerDescription, options }));
    const { onChange } = montaVero(controllo({ isQuery: true, name: 'class.S1-7', navpath: 'S1-7.0', rows }));
    await scegli(0, 'testo 44|a1');
    await scegli(1, 'testo 44|t2');
    const mostrati = [...box!.querySelectorAll('.ant-select')].map((s) => s.textContent);
    expect(mostrati[0]).toContain('testo 44|a1');
    expect(mostrati[1]).toContain('testo 44|t2');
    expect(onChange.mock.calls.filter(([n]) => n === 'class.S1-7').at(-1)![1]).toEqual(['44|a1', '44|t2', '']);
  });
});
