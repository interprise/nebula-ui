// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HeaderContextSelect, type HeaderContextSelectProps } from './HeaderContextSelect';

// SXADV-6137 — i selettori «Azienda di accesso» e «Sede di accesso» della
// testata. Nel legacy (combo ExtJS editable:false) la descrizione stava DENTRO
// un <input> di sola lettura: doppio clic o trascinamento ne selezionavano una
// parte (per esempio il solo codice azienda) e Ctrl+C la copiava. Con la Select
// di antd v6 la descrizione e' un nodo di testo sotto un <input> VUOTO posato
// sopra la casella: non si seleziona niente.
//
// Contratto (rivisto), stesso modello dei lookup dei form (SXADV-5641):
//  1. tendina CHIUSA: l'input contiene la descrizione scelta (a riposo, col
//     fuoco, dopo la chiusura, dopo il blur); fuori elenco = il valore; nessun
//     valore = vuoto;
//  2. mousedown / click / dblclick sul TESTO non aprono la tendina, il testo
//     resta (si deve poterlo selezionare);
//  3. la tendina si apre con la freccia (suffisso), Freccia giu', Invio, Spazio;
//     un carattere battuto non apre, non cambia il testo, non chiama onChange;
//  4. tendina APERTA: input vuoto, tutte le opzioni, voce ATTIVA = valore
//     corrente (non la prima). Tab / Invio subito dopo l'apertura non cambiano
//     azienda; Freccia giu' + Invio sceglie la voce DOPO quella corrente;
//  5. scelta = onChange una volta, tendina chiusa, descrizione di nuovo
//     nell'input (padre che aggiorna value);
//  6. cambio di value / options = l'input segue;
//  7. disabled: input disabilitato, non si apre, si chiude se era aperta;
//     loading tiene la descrizione;
//  8. Ctrl+C / Ctrl+A: niente preventDefault, nessuna apertura.
//
// Il valore corrente dei casi di tendina e' '46', TERZO in elenco: con '44'
// (il primo) una voce attiva rimasta sull'indice 0 coincideva per caso con
// quella corrente, e un Tab dopo il doppio clic cambiava azienda senza che
// nessun test se ne accorgesse.

const AZIENDE = [
  { value: '44', text: '44 - C.N.A. SERVIZI MODENA SRL' },
  { value: '45', text: '45 - C.N.A. SERVIZI REGGIO EMILIA' },
  { value: '46', text: '46 - SIXTEMA SPA' },
  { value: '47', text: '47 - ALTRA AZIENDA' },
];
const TUTTE = AZIENDE.map((a) => a.text);
const L44 = AZIENDE[0].text;
const L46 = AZIENDE[2].text;

let root: Root | null = null;
let box: HTMLElement | null = null;

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
  // le tendine stanno in un portale sul body
  document.body.innerHTML = '';
});

const attendi = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function props(extra: Partial<HeaderContextSelectProps> = {}): HeaderContextSelectProps {
  return { value: '44', options: AZIENDE, onChange: vi.fn(), 'aria-label': 'Azienda di accesso', ...extra };
}

function monta(p: HeaderContextSelectProps) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<HeaderContextSelect {...p} />); });
}

function ridisegna(p: HeaderContextSelectProps) {
  act(() => { root!.render(<HeaderContextSelect {...p} />); });
}

/** Padre che tiene il valore come fa Shell: onChange -> nuovo value. */
function montaControllato(iniziale: string, onChange = vi.fn()) {
  function Padre() {
    const [v, setV] = React.useState<string | undefined>(iniziale);
    return (
      <HeaderContextSelect
        value={v}
        options={AZIENDE}
        onChange={(nv) => { onChange(nv); setV(nv); }}
        aria-label="Azienda di accesso"
      />
    );
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<Padre />); });
  return onChange;
}

function input(): HTMLInputElement {
  const el = box!.querySelector<HTMLInputElement>('.ant-select input');
  expect(el, 'input dentro la select').toBeTruthy();
  return el!;
}

function selectEl(): HTMLElement {
  const el = box!.querySelector<HTMLElement>('.ant-select');
  expect(el, '.ant-select').toBeTruthy();
  return el!;
}

function freccia(): HTMLElement {
  const el = box!.querySelector<HTMLElement>('.ant-select-suffix');
  expect(el, 'freccia (.ant-select-suffix)').toBeTruthy();
  return el!;
}

/** Opzioni nella tendina VISIBILE (quelle di tendine nascoste non contano). */
function opzioniVisibili(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
    .filter((o) => o.isConnected && !o.closest('.ant-select-dropdown-hidden'));
}

/** Aperta = la select lo dichiara E si vedono le voci. */
const aperta = () => !!box!.querySelector('.ant-select-open') && opzioniVisibili().length > 0;

const attiva = () => opzioniVisibili().find((o) => o.classList.contains('ant-select-item-option-active'))?.textContent;

// Le chiamate a onChange con un valore DIVERSO dal corrente: la Shell ignora
// un cambio allo stesso valore, quindi solo queste contano.
const cambi = (fn: ReturnType<typeof vi.fn>, corrente: string) =>
  fn.mock.calls.map(([v]) => v).filter((v) => v !== corrente);

// rc-select legge anche keyCode/which, che jsdom non mette dall'init
const KEYCODE: Record<string, number> = {
  Escape: 27, Enter: 13, Tab: 9, ' ': 32, ArrowDown: 40, ArrowUp: 38, a: 65, c: 67, x: 88,
};

async function tasto(key: string, init: KeyboardEventInit = {}) {
  let ev!: KeyboardEvent;
  await act(async () => {
    ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    const kc = KEYCODE[key];
    if (kc) {
      Object.defineProperty(ev, 'keyCode', { get: () => kc });
      Object.defineProperty(ev, 'which', { get: () => kc });
    }
    input().dispatchEvent(ev);
    await attendi();
  });
  return ev;
}

async function mouseSu(el: HTMLElement, tipo: 'mousedown' | 'mouseup' | 'click' | 'dblclick') {
  let ev!: MouseEvent;
  await act(async () => {
    ev = new MouseEvent(tipo, { bubbles: true, cancelable: true, detail: tipo === 'dblclick' ? 2 : 1 });
    el.dispatchEvent(ev);
    await attendi(30);
  });
  return ev;
}

/** Il gesto di apertura col mouse: mousedown (e clic) sulla freccia. */
async function apriFreccia() {
  await mouseSu(freccia(), 'mousedown');
  await mouseSu(freccia(), 'mouseup');
  await mouseSu(freccia(), 'click');
}

async function fuoco() {
  await act(async () => { input().focus(); await attendi(10); });
}

async function blur() {
  await act(async () => { input().blur(); await attendi(10); });
}

/** Chiude con Esc e verifica che la tendina sia davvero chiusa. */
async function chiudi() {
  await tasto('Escape');
  expect(aperta(), 'tendina chiusa dopo Esc').toBe(false);
}

/** Come fireEvent.change: valore nativo + evento input (React ascolta quello). */
async function digita(testo: string) {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    for (const ch of testo) {
      const kd = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true });
      const kc = ch.toUpperCase().charCodeAt(0);
      Object.defineProperty(kd, 'keyCode', { get: () => kc });
      Object.defineProperty(kd, 'which', { get: () => kc });
      el.dispatchEvent(kd);
      setter.call(el, el.value + ch);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    }
    await attendi(30);
  });
}

describe('SXADV-6137 — 1. tendina chiusa: descrizione nell\'input', () => {
  it('1. resa di base: header-select dentro header-select-wrap, style sul contenitore', () => {
    monta(props({ style: { maxWidth: 321 } }));
    expect(selectEl().classList.contains('header-select')).toBe(true);
    const wrap = box!.querySelector<HTMLElement>('.header-select-wrap');
    expect(wrap, 'span.header-select-wrap').toBeTruthy();
    expect(wrap!.contains(selectEl())).toBe(true);
    expect(wrap!.style.maxWidth).toBe('321px');
  });

  it('1. a riposo, senza fuoco, l\'input contiene la descrizione scelta', () => {
    monta(props());
    expect(input().value).toBe(L44);
  });

  it('1. col fuoco l\'input contiene ancora la descrizione', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    expect(input().value).toBe(L46);
  });

  it('1. chiusa la tendina (Esc), l\'input contiene la descrizione', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    await apriFreccia();
    expect(aperta(), 'aperta').toBe(true);
    await chiudi();
    expect(input().value).toBe(L46);
  });

  it('1. dopo il blur l\'input contiene la descrizione', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    await apriFreccia();
    await chiudi();
    await blur();
    expect(input().value).toBe(L46);
  });

  it('1. blur a tendina aperta: si chiude e la descrizione torna', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    await apriFreccia();
    expect(aperta(), 'aperta').toBe(true);
    await blur();
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('1. valore fuori elenco: l\'input mostra il valore stesso', () => {
    monta(props({ value: '99' }));
    expect(input().value).toBe('99');
  });

  it('1. nessun valore: input vuoto', () => {
    monta(props({ value: undefined }));
    expect(input().value).toBe('');
  });
});

describe('SXADV-6137 — 2. il clic sul testo non apre, il testo si seleziona', () => {
  it('2. mousedown / mouseup / click / dblclick sull\'input: niente tendina, testo intatto', async () => {
    monta(props({ value: '46' }));
    for (const t of ['mousedown', 'mouseup', 'click', 'dblclick'] as const) {
      await mouseSu(input(), t);
      expect(aperta(), `aperta dopo ${t}`).toBe(false);
      expect(input().value, `testo dopo ${t}`).toBe(L46);
    }
  });

  it('2. con il fuoco dentro, piu\' clic e un doppio clic sul testo non aprono e non svuotano', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    for (const t of ['mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'click', 'dblclick'] as const) {
      await mouseSu(input(), t);
    }
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('2. il mousedown sul testo non chiama preventDefault (il browser deve poter selezionare)', async () => {
    monta(props({ value: '46' }));
    const ev = await mouseSu(input(), 'mousedown');
    expect(ev.defaultPrevented).toBe(false);
  });

  it('2. una selezione parziale (il solo codice) sopravvive a un ridisegno', async () => {
    const p = props({ value: '46' });
    monta(p);
    await fuoco();
    await mouseSu(input(), 'dblclick');
    act(() => { input().setSelectionRange(0, 8); });
    ridisegna({ ...p });
    expect(input().value).toBe(L46);
    expect(input().value.slice(input().selectionStart ?? 0, input().selectionEnd ?? 0)).toBe(L46.slice(0, 8));
  });
});

describe('SXADV-6137 — 3. gesti di apertura, digitazione ignorata', () => {
  it('3. mousedown sulla freccia apre la tendina', async () => {
    monta(props({ value: '46' }));
    await apriFreccia();
    expect(aperta()).toBe(true);
  });

  for (const [key, nome] of [['ArrowDown', 'Freccia giu\''], ['Enter', 'Invio'], [' ', 'Spazio']] as const) {
    it(`3. ${nome} col fuoco nel campo apre la tendina senza cambiare azienda`, async () => {
      const onChange = vi.fn();
      monta(props({ value: '46', onChange }));
      await fuoco();
      await tasto(key);
      expect(aperta(), `aperta dopo ${nome}`).toBe(true);
      expect(cambi(onChange, '46')).toEqual([]);
    });
  }

  it('3. un carattere battuto non apre, non cambia il testo, non chiama onChange', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await digita('x');
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('3. battere il codice di un\'altra azienda non apre e non la sceglie', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await digita('45');
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('3. battere a tendina aperta non filtra la lista e non chiama onChange', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await apriFreccia();
    await digita('SIXTEMA');
    expect(opzioniVisibili().map((o) => o.textContent)).toEqual(TUTTE);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SXADV-6137 — 4. tendina aperta: input vuoto, voce attiva = corrente', () => {
  it('4. aperta con la freccia: input vuoto e TUTTE le opzioni', async () => {
    monta(props({ value: '46' }));
    await apriFreccia();
    expect(input().value).toBe('');
    expect(opzioniVisibili().map((o) => o.textContent)).toEqual(TUTTE);
  });

  it('4. aperta con la freccia: la voce attiva e\' quella corrente (46), non la prima', async () => {
    monta(props({ value: '46' }));
    await apriFreccia();
    expect(attiva()).toBe(L46);
  });

  it('4. aperta con Freccia giu\': input vuoto, voce attiva = corrente', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    await tasto('ArrowDown');
    expect(aperta()).toBe(true);
    expect(input().value).toBe('');
    expect(attiva()).toBe(L46);
  });

  it('4. riaperta dopo una chiusura: ancora tutte le opzioni, attiva la corrente', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    await apriFreccia();
    await chiudi();
    await apriFreccia();
    expect(opzioniVisibili().map((o) => o.textContent)).toEqual(TUTTE);
    expect(attiva()).toBe(L46);
  });

  it('4. Tab subito dopo l\'apertura (freccia) non cambia azienda', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await apriFreccia();
    await tasto('Tab');
    expect(cambi(onChange, '46')).toEqual([]);
  });

  it('4. Invio subito dopo l\'apertura (freccia) non cambia azienda', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await apriFreccia();
    await tasto('Enter');
    expect(cambi(onChange, '46')).toEqual([]);
  });

  it('4. Invio per aprire, poi Invio: non cambia azienda', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await tasto('Enter');
    await tasto('Enter');
    expect(cambi(onChange, '46')).toEqual([]);
  });

  it('4. Freccia giu\' per aprire, poi Tab: non cambia azienda', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await tasto('ArrowDown');
    await tasto('Tab');
    expect(cambi(onChange, '46')).toEqual([]);
  });

  it('4. doppio clic sul testo, poi Tab: non cambia azienda (lo scenario della revisione)', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    for (const t of ['mousedown', 'mouseup', 'click', 'mousedown', 'mouseup', 'click', 'dblclick'] as const) {
      await mouseSu(input(), t);
    }
    await tasto('Tab');
    expect(cambi(onChange, '46')).toEqual([]);
  });

  it('4. aperta con la freccia, Freccia giu\' + Invio: sceglie la voce DOPO la corrente (47)', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await apriFreccia();
    await tasto('ArrowDown');
    expect(attiva()).toBe(AZIENDE[3].text);
    await tasto('Enter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('47');
  });

  it('4. aperta con Freccia giu\', ancora Freccia giu\' + Invio: sceglie la voce DOPO la corrente (47)', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await tasto('ArrowDown');
    await tasto('ArrowDown');
    await tasto('Enter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('47');
  });
});

describe('SXADV-6137 — 5. scelta', () => {
  it('5. scegliere un\'opzione col mouse chiama onChange una volta col suo value e chiude', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await apriFreccia();
    const opt = opzioniVisibili().find((o) => o.textContent === AZIENDE[1].text);
    expect(opt, 'opzione 45').toBeTruthy();
    await act(async () => { opt!.click(); await attendi(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('45');
    expect(aperta()).toBe(false);
  });

  it('5. con padre che aggiorna value: chiusa, l\'input mostra la nuova descrizione, anche dopo il blur', async () => {
    const onChange = montaControllato('46');
    await fuoco();
    await apriFreccia();
    const opt = opzioniVisibili().find((o) => o.textContent === AZIENDE[1].text);
    expect(opt, 'opzione 45').toBeTruthy();
    await act(async () => { opt!.click(); await attendi(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('45');
    expect(aperta()).toBe(false);
    expect(input().value).toBe(AZIENDE[1].text);
    await blur();
    expect(input().value).toBe(AZIENDE[1].text);
  });

  it('5. scelta da tastiera (Freccia giu\' + Invio) con padre: chiusa, descrizione nuova nell\'input', async () => {
    const onChange = montaControllato('46');
    await fuoco();
    await apriFreccia();
    await tasto('ArrowDown');
    await tasto('Enter');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('47');
    expect(aperta()).toBe(false);
    expect(input().value).toBe(AZIENDE[3].text);
  });
});

describe('SXADV-6137 — 6. l\'input segue le props', () => {
  it('6. cambia value: l\'input mostra la descrizione nuova', () => {
    const p = props();
    monta(p);
    ridisegna({ ...p, value: '47' });
    expect(input().value).toBe(AZIENDE[3].text);
  });

  it('6. cambia value col fuoco dentro: l\'input mostra la descrizione nuova', async () => {
    const p = props();
    monta(p);
    await fuoco();
    ridisegna({ ...p, value: '46' });
    expect(input().value).toBe(L46);
  });

  it('6. cambiano le options (stesso value, altra descrizione): l\'input segue', () => {
    const p = props();
    monta(p);
    const nuove = AZIENDE.map((a) => (a.value === '44' ? { ...a, text: '44 - NUOVA RAGIONE SOCIALE' } : a));
    ridisegna({ ...p, options: nuove });
    expect(input().value).toBe('44 - NUOVA RAGIONE SOCIALE');
  });

  it('6. le options arrivano dopo (prima fuori elenco): l\'input passa dal valore alla descrizione', () => {
    const p = props({ options: [] });
    monta(p);
    expect(input().value).toBe('44');
    ridisegna({ ...p, options: AZIENDE });
    expect(input().value).toBe(L44);
  });

  it('6. value tolto: input vuoto', () => {
    const p = props();
    monta(p);
    ridisegna({ ...p, value: undefined });
    expect(input().value).toBe('');
  });
});

describe('SXADV-6137 — 7. disabled e loading', () => {
  it('7. disabled: input disabilitato, descrizione presente, freccia e casella non aprono', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', disabled: true, onChange }));
    expect(input().disabled).toBe(true);
    expect(input().value).toBe(L46);
    await apriFreccia();
    expect(aperta()).toBe(false);
    await mouseSu(selectEl(), 'mousedown');
    expect(aperta()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('7. disabled mentre e\' aperta: la tendina si chiude', async () => {
    const p = props({ value: '46' });
    monta(p);
    await apriFreccia();
    expect(aperta(), 'aperta prima').toBe(true);
    ridisegna({ ...p, disabled: true });
    await act(async () => { await attendi(); });
    expect(aperta()).toBe(false);
    expect(input().disabled).toBe(true);
  });

  it('7. loading non toglie la descrizione', () => {
    monta(props({ value: '46', loading: true }));
    expect(input().value).toBe(L46);
  });
});

describe('SXADV-6137 — 8. copia lasciata al browser', () => {
  it('8. Ctrl+C sull\'input: niente preventDefault, niente apertura, testo intatto', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    act(() => { input().setSelectionRange(0, 2); });
    const ev = await tasto('c', { ctrlKey: true, code: 'KeyC' });
    expect(ev.defaultPrevented).toBe(false);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('8. Ctrl+A sull\'input: niente preventDefault, niente apertura, testo intatto', async () => {
    monta(props({ value: '46' }));
    await fuoco();
    const ev = await tasto('a', { ctrlKey: true, code: 'KeyA' });
    expect(ev.defaultPrevented).toBe(false);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('8. doppio clic, Ctrl+C, Tab: azienda invariata', async () => {
    const onChange = vi.fn();
    monta(props({ value: '46', onChange }));
    await fuoco();
    await mouseSu(input(), 'dblclick');
    await tasto('c', { ctrlKey: true, code: 'KeyC' });
    await tasto('Tab');
    expect(cambi(onChange, '46')).toEqual([]);
  });
});
