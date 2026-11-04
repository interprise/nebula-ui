// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as antd from 'antd';
import * as icons from '@ant-design/icons';
import { makeReportBarControl } from '../../../entrasp/react-plugins/entrasp-controls/src/ReportBarControl';
import type { HostAPI, UIControl } from '../../../entrasp/react-plugins/entrasp-controls/src/hostApi';

// SXADV-5951 — colonna "Stampa" delle liste (controlType="ReportBar", es. documentiList).
// Con un nome di report lungo i bottoni stampa e email restano visibili: non si
// restringono, cede spazio la tendina. Aperta, la tendina mostra i nomi interi.
//
// Due livelli, come CdmsClassControl.sxadv5983: antd finto per leggere come dato le
// prop e gli stili di layout, antd vero per il comportamento. jsdom non calcola il
// layout: qui si prova la DICHIARAZIONE flex, non i pixel (vedi il rapporto).

const LUNGO_A = 'Fattura immediata di vendita con dettaglio delle righe, scadenze e riepilogo IVA per aliquota';
const LUNGO_B = 'Documento di trasporto valorizzato con indicazione del vettore, dei colli e del peso complessivo';
const BREVE = 'Ordine';

const TRE = [
  { value: 'REP_A', text: LUNGO_A },
  { value: 'REP_B', text: LUNGO_B },
  { value: 'REP_C', text: BREVE },
];

function controllo(extra: Partial<UIControl> = {}): UIControl {
  return { type: 'reportBar', editable: false, reports: TRE, selected: 'REP_A', ...extra };
}

// ---- antd finto: prop e stili si leggono come dati ----

type Stile = React.CSSProperties;
type SelectProps = {
  value?: string;
  style?: Stile;
  popupMatchSelectWidth?: boolean | number;
  dropdownMatchSelectWidth?: boolean | number;
  popupStyle?: Stile;
  dropdownStyle?: Stile;
  styles?: { popup?: { root?: Stile } };
  options?: { value: string; label: React.ReactNode }[];
  onChange: (v: string) => void;
};
type ButtonProps = { style?: Stile; title?: string; onClick: () => void };

function hostFinto() {
  const selects: SelectProps[] = [];
  const bottoni: ButtonProps[] = [];
  const Select = (p: SelectProps) => { selects.push(p); return <i data-select="1" />; };
  const Button = (p: ButtonProps) => { bottoni.push(p); return <button title={p.title} style={p.style} />; };
  const fintaIcona = () => <i />;
  const host = {
    React,
    antd: { Select, Button },
    icons: { PrinterOutlined: fintaIcona, MailOutlined: fintaIcona },
  } as unknown as HostAPI;
  return { host, selects, bottoni };
}

/** La stessa semantica comunque sia scritta: `flex: '0 1 170px'` o le tre longhand. */
function flexDi(s: Stile = {}): { grow: number; shrink: number; basis: string } {
  let grow = 0;
  let shrink = 1;
  let basis = 'auto';
  if (s.flex === 'none') {
    shrink = 0;
  } else if (typeof s.flex === 'string') {
    const [g, sh, b] = s.flex.split(/\s+/);
    grow = Number(g);
    if (sh !== undefined) shrink = Number(sh);
    if (b !== undefined) basis = b;
  } else if (typeof s.flex === 'number') {
    grow = s.flex;
    basis = '0';
  }
  if (s.flexGrow !== undefined) grow = Number(s.flexGrow);
  if (s.flexShrink !== undefined) shrink = Number(s.flexShrink);
  if (s.flexBasis !== undefined) basis = String(s.flexBasis);
  return { grow, shrink, basis };
}

const px = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  const m = typeof v === 'string' ? /^(\d+(?:\.\d+)?)px$/.exec(v) : null;
  return m ? Number(m[1]) : null;
};

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
  const C = makeReportBarControl(host);
  const onAction = vi.fn();
  monta(C as never, { control, onAction, onChange: vi.fn() });
  return { selects, bottoni, onAction };
}

// ---- antd vero ----

const hostVero = { React, antd, icons } as unknown as HostAPI;

function montaVero(control: UIControl) {
  const onAction = vi.fn();
  const C = makeReportBarControl(hostVero);
  monta(C as never, { control, onAction, onChange: vi.fn() });
  return { onAction, C };
}

const attesa = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function apri() {
  const sel = box!.querySelector('.ant-select')!;
  await act(async () => {
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await attesa();
  });
}

const opzioni = () =>
  [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')].filter((o) => o.isConnected);

async function scegli(testo: string) {
  await apri();
  const opt = opzioni().find((o) => o.textContent === testo);
  expect(opt, `opzione ${testo}`).toBeTruthy();
  await act(async () => {
    opt!.click();
    await attesa();
  });
}

function bottone(title: string): HTMLButtonElement {
  const b = box!.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  expect(b, `bottone ${title}`).toBeTruthy();
  return b!;
}
const STAMPA = 'Visualizza report';
const EMAIL = 'Invia report via email';

function clic(title: string) {
  act(() => { bottone(title).click(); });
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
  vi.restoreAllMocks();
});

describe('SXADV-5951 — chi cede spazio nella colonna', () => {
  it('i bottoni stampa ed email non si restringono', () => {
    const { bottoni } = montaFinto(controllo());
    expect(bottoni).toHaveLength(2);
    for (const b of bottoni) expect(flexDi(b.style).shrink, b.title).toBe(0);
  });

  it('i bottoni non crescono a rubare spazio alla tendina', () => {
    const { bottoni } = montaFinto(controllo());
    for (const b of bottoni) expect(flexDi(b.style).grow, b.title).toBe(0);
  });

  it('la tendina puo\' stringersi', () => {
    const { selects } = montaFinto(controllo());
    expect(flexDi(selects[0].style).shrink).toBeGreaterThan(0);
  });

  it('il pavimento della tendina e\' dichiarato e sotto il tetto: senza, min-width:auto non la lascia stringere', () => {
    const { selects } = montaFinto(controllo());
    const min = px(selects[0].style?.minWidth);
    expect(min, 'minWidth in pixel').not.toBeNull();
    expect(min!).toBeLessThan(170);
  });

  it('la tendina non ha una larghezza rigida che annullerebbe il restringimento', () => {
    const { selects } = montaFinto(controllo());
    expect(selects[0].style?.width).toBeUndefined();
  });

  it('la tendina non cresce oltre 170px, qualunque sia il nome', () => {
    const { selects } = montaFinto(controllo());
    const s = selects[0].style;
    const f = flexDi(s);
    const tetto = px(s?.maxWidth);
    const tenutaDalFlex = f.grow === 0 && px(f.basis) !== null && px(f.basis)! <= 170;
    expect(tetto !== null ? tetto <= 170 : tenutaDalFlex, JSON.stringify(s)).toBe(true);
  });

  it('il contenitore e\' flex e limitato alla colonna, senza andare a capo', () => {
    const { selects } = montaFinto(controllo());
    expect(selects).toHaveLength(1);
    const c = box!.firstElementChild as HTMLElement;
    expect(c.style.display).toMatch(/^(inline-)?flex$/);
    expect(c.style.maxWidth).toBe('100%');
    expect(c.style.flexWrap === '' || c.style.flexWrap === 'nowrap').toBe(true);
  });
});

describe('SXADV-5951 — con antd vero e nomi lunghi', () => {
  it('gli stili arrivano al DOM: il contenitore e la radice della Select', () => {
    montaVero(controllo());
    const c = box!.firstElementChild as HTMLElement;
    expect(c.style.maxWidth).toBe('100%');
    const sel = box!.querySelector<HTMLElement>('.ant-select')!;
    expect(sel.parentElement).toBe(c);
    expect(sel.style.minWidth).toBe('60px');
    expect(sel.style.flexShrink).toBe('1');
    expect(sel.style.flexBasis).toBe('170px');
  });

  it('gli stili dei bottoni arrivano al DOM', () => {
    montaVero(controllo());
    for (const t of [STAMPA, EMAIL]) {
      expect(bottone(t).parentElement).toBe(box!.firstElementChild);
      expect(bottone(t).style.flexShrink, t).toBe('0');
    }
  });

  it('entrambi i bottoni ci sono, con l\'icona, accanto alla tendina', () => {
    montaVero(controllo());
    expect(box!.querySelectorAll('.ant-select')).toHaveLength(1);
    expect(bottone(STAMPA).querySelector('.anticon-printer')).toBeTruthy();
    expect(bottone(EMAIL).querySelector('.anticon-mail')).toBeTruthy();
  });

  it('il campo chiuso mostra il report selezionato', () => {
    montaVero(controllo());
    expect(box!.querySelector('.ant-select')!.textContent).toContain(LUNGO_A);
  });
});

describe('SXADV-5951 — la tendina aperta si legge intera', () => {
  it('la larghezza del menu non e\' legata a quella del campo', () => {
    const { selects } = montaFinto(controllo());
    expect(selects[0].popupMatchSelectWidth).toBe(false);
  });

  it('nessuna larghezza imposta al menu per altra via', () => {
    const { selects } = montaFinto(controllo());
    const s = selects[0];
    for (const stile of [s.popupStyle, s.dropdownStyle, s.styles?.popup?.root]) {
      expect(stile?.width).toBeUndefined();
      expect(stile?.maxWidth).toBeUndefined();
    }
    expect(s.dropdownMatchSelectWidth).toBeUndefined();
  });

  it('antd vero: ogni nome compare per intero nel menu', async () => {
    montaVero(controllo());
    await apri();
    expect(opzioni().map((o) => o.textContent)).toEqual([LUNGO_A, LUNGO_B, BREVE]);
  });

  it('antd vero: con campo largo 170 il menu non riceve width dal campo, al piu\' min-width', async () => {
    // Il campo ha una larghezza solo qui: jsdom altrimenti da' 0 a tutti e il
    // ramo stretch='width' sarebbe indistinguibile.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(170);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 170, bottom: 24, width: 170, height: 24, toJSON: () => ({}),
    });
    montaVero(controllo());
    await apri();
    const popup = document.querySelector<HTMLElement>('.ant-select-dropdown');
    expect(popup, 'menu aperto').toBeTruthy();
    expect(popup!.style.width).toBe('');
    expect(popup!.style.maxWidth).toBe('');
  });

  it('antd vero: tanti report lunghi sono tutti nel DOM, nessuna lista virtuale a altezza di riga fissa', async () => {
    const molti = Array.from({ length: 40 }, (_, i) => ({ value: `R${i}`, text: `${LUNGO_A} ${i}` }));
    montaVero(controllo({ reports: molti, selected: 'R0' }));
    await apri();
    expect(opzioni()).toHaveLength(40);
  });
});

describe('SXADV-5951 — numero di report', () => {
  it('un solo report: nessuna tendina, i due bottoni si', () => {
    montaVero(controllo({ reports: [{ value: 'REP_A', text: LUNGO_A }] }));
    expect(box!.querySelector('.ant-select')).toBeNull();
    bottone(STAMPA);
    bottone(EMAIL);
  });

  it('un solo report: i clic mandano quel report', () => {
    const { onAction } = montaVero(controllo({ reports: [{ value: 'REP_A', text: LUNGO_A }] }));
    clic(STAMPA);
    clic(EMAIL);
    expect(onAction.mock.calls).toEqual([
      ['ExecuteBarReport', { $ReportBarItem: 'REP_A', $ReportBarFormat: 'PDF' }],
      ['EmailBarReport', { $ReportBarItem: 'REP_A', $ReportBarFormat: 'PDF' }],
    ]);
  });

  it('due report: la tendina c\'e\' (il confine e\' >1)', () => {
    montaVero(controllo({ reports: TRE.slice(0, 2) }));
    expect(box!.querySelectorAll('.ant-select')).toHaveLength(1);
  });

  it('elenco vuoto: non disegna niente', () => {
    montaVero(controllo({ reports: [], selected: undefined }));
    expect(box!.innerHTML).toBe('');
  });

  it('elenco assente: non disegna niente', () => {
    montaVero(controllo({ reports: undefined, selected: undefined }));
    expect(box!.innerHTML).toBe('');
  });
});

describe('SXADV-5951 — i clic mandano il report scelto', () => {
  it('senza cambiare nulla: il report selezionato dal server', () => {
    const { onAction } = montaVero(controllo({ selected: 'REP_B' }));
    clic(STAMPA);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('ExecuteBarReport', { $ReportBarItem: 'REP_B', $ReportBarFormat: 'PDF' });
  });

  it('email senza cambiare nulla', () => {
    const { onAction } = montaVero(controllo());
    clic(EMAIL);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('EmailBarReport', { $ReportBarItem: 'REP_A', $ReportBarFormat: 'PDF' });
  });

  it('cambiare report non spara azioni da solo', async () => {
    const { onAction } = montaVero(controllo());
    await scegli(LUNGO_B);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('stampa dopo aver cambiato report', async () => {
    const { onAction } = montaVero(controllo());
    await scegli(LUNGO_B);
    clic(STAMPA);
    expect(onAction).toHaveBeenCalledWith('ExecuteBarReport', { $ReportBarItem: 'REP_B', $ReportBarFormat: 'PDF' });
  });

  it('email dopo aver cambiato report', async () => {
    const { onAction } = montaVero(controllo());
    await scegli(BREVE);
    clic(EMAIL);
    expect(onAction).toHaveBeenCalledWith('EmailBarReport', { $ReportBarItem: 'REP_C', $ReportBarFormat: 'PDF' });
  });

  it('due cambi di fila: vale l\'ultimo, e il campo mostra quello', async () => {
    const { onAction } = montaVero(controllo());
    await scegli(LUNGO_B);
    await scegli(BREVE);
    expect(box!.querySelector('.ant-select')!.textContent).toContain(BREVE);
    clic(STAMPA);
    expect(onAction).toHaveBeenCalledWith('ExecuteBarReport', { $ReportBarItem: 'REP_C', $ReportBarFormat: 'PDF' });
  });

  it('tornare al report di partenza', async () => {
    const { onAction } = montaVero(controllo());
    await scegli(LUNGO_B);
    await scegli(LUNGO_A);
    clic(EMAIL);
    expect(onAction).toHaveBeenCalledWith('EmailBarReport', { $ReportBarItem: 'REP_A', $ReportBarFormat: 'PDF' });
  });

  it('si manda il codice del report, non il nome', async () => {
    const { onAction } = montaVero(controllo());
    await scegli(LUNGO_B);
    clic(STAMPA);
    expect(onAction.mock.calls[0][1].$ReportBarItem).not.toContain(' ');
  });

  it('un nuovo disegno con gli stessi report conserva la scelta', async () => {
    const { onAction, C } = montaVero(controllo());
    await scegli(LUNGO_B);
    act(() => { root!.render(<C {...{ control: controllo(), onAction, onChange: vi.fn() }} />); });
    clic(STAMPA);
    expect(onAction).toHaveBeenCalledWith('ExecuteBarReport', { $ReportBarItem: 'REP_B', $ReportBarFormat: 'PDF' });
  });
});

describe('Difetto fuori dal perimetro stretto di SXADV-5951 — stato che sopravvive al cambio di record', () => {
  // useState(selected) legge il valore del server solo al montaggio. ReportBarUIControl
  // ri-emette reports/selected per record (SXADV-5527, avanti/indietro nel dettaglio):
  // se il componente resta montato e il record nuovo ha altri report, il clic manda
  // il codice del record precedente, che nel suo elenco non esiste.
  it('il server manda un altro elenco: il clic non manda un report fuori elenco', () => {
    const { onAction, C } = montaVero(controllo());
    const altro = controllo({
      reports: [{ value: 'REP_X', text: 'Nota di credito' }, { value: 'REP_Y', text: 'Reso' }],
      selected: 'REP_X',
    });
    act(() => { root!.render(<C {...{ control: altro, onAction, onChange: vi.fn() }} />); });
    clic(STAMPA);
    expect(onAction).toHaveBeenCalledWith('ExecuteBarReport', { $ReportBarItem: 'REP_X', $ReportBarFormat: 'PDF' });
  });
});
