// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HeaderContextSelect, type HeaderContextSelectProps } from './HeaderContextSelect';

// SXADV-6236 — la tendina di Azienda / Sede di accesso si apriva solo dalla
// freccetta: sembra rotta. Nel legacy (combo ExtJS) si apriva cliccando in un
// punto qualsiasi della casella. Contratto nuovo:
//  A. clic singolo sul testo (nessuna selezione) = apre, entro 400 ms (puo'
//     aspettare per distinguere il doppio clic); aperta come 6137 §4;
//  B. doppio clic sul testo = non apre, il testo resta;
//  C. clic che finisce con una selezione non vuota = non apre, la selezione resta;
//  D. clic sul testo a tendina aperta = chiude, e non si riapre da sola;
//  E. disabled = il clic non apre mai;
//  F. tastiera e freccia come 6137 (carattere ignorato; Giu'/Invio/Spazio e
//     freccia aprono; Tab/Invio subito dopo l'apertura non cambiano azienda);
//  G. scelta col mouse dopo l'apertura da clic = onChange una volta e chiude;
//  H. smontare con un'apertura in sospeso non lancia e non avvisa;
//  I. blur prima dell'apertura differita = resta chiusa.

const AZIENDE = [
  { value: '44', text: '44 - C.N.A. SERVIZI MODENA SRL' },
  { value: '45', text: '45 - C.N.A. SERVIZI REGGIO EMILIA' },
  { value: '46', text: '46 - SIXTEMA SPA' },
  { value: '47', text: '47 - ALTRA AZIENDA' },
];
const TUTTE = AZIENDE.map((a) => a.text);
const L46 = AZIENDE[2].text;

let root: Root | null = null;
let box: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

const attendi = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function props(extra: Partial<HeaderContextSelectProps> = {}): HeaderContextSelectProps {
  return { value: '46', options: AZIENDE, onChange: vi.fn(), 'aria-label': 'Azienda di accesso', ...extra };
}

function monta(p: HeaderContextSelectProps) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<HeaderContextSelect {...p} />); });
}

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

function opzioniVisibili(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ant-select-item-option')]
    .filter((o) => o.isConnected && !o.closest('.ant-select-dropdown-hidden'));
}

const aperta = () => !!box!.querySelector('.ant-select-open') && opzioniVisibili().length > 0;

const attiva = () => opzioniVisibili().find((o) => o.classList.contains('ant-select-item-option-active'))?.textContent;

const cambi = (fn: ReturnType<typeof vi.fn>, corrente: string) =>
  fn.mock.calls.map(([v]) => v).filter((v) => v !== corrente);

const selezionato = () => input().value.slice(input().selectionStart ?? 0, input().selectionEnd ?? 0);

const KEYCODE: Record<string, number> = {
  Escape: 27, Enter: 13, Tab: 9, ' ': 32, ArrowDown: 40, ArrowUp: 38,
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

/** Un evento del mouse, con attesa breve: un doppio clic deve stare in ~100 ms. */
async function mouse(el: HTMLElement, tipo: 'mousedown' | 'mouseup' | 'click' | 'dblclick', detail = 1, pausa = 5) {
  let ev!: MouseEvent;
  await act(async () => {
    ev = new MouseEvent(tipo, { bubbles: true, cancelable: true, detail, button: 0 });
    el.dispatchEvent(ev);
    // come il browser: il mousedown non annullato porta il fuoco sull'input
    if (tipo === 'mousedown' && !ev.defaultPrevented && el instanceof HTMLInputElement && !el.disabled) el.focus();
    await attendi(pausa);
  });
  return ev;
}

/** Clic singolo sul testo; `durante` gira fra mousedown e mouseup (trascinamento). */
async function clicTesto(durante?: () => void) {
  const el = input();
  await mouse(el, 'mousedown', 1);
  if (durante) act(() => { durante(); });
  await mouse(el, 'mouseup', 1);
  await mouse(el, 'click', 1);
}

async function doppioClicTesto() {
  const el = input();
  await mouse(el, 'mousedown', 1);
  await mouse(el, 'mouseup', 1);
  await mouse(el, 'click', 1);
  await mouse(el, 'mousedown', 2);
  await mouse(el, 'mouseup', 2);
  await mouse(el, 'click', 2);
  await mouse(el, 'dblclick', 2);
}

/** Aspetta (fino a `ms`) che la condizione diventi vera; ritorna l'ultimo esito. */
async function entro(ms: number, cond: () => boolean) {
  const fine = Date.now() + ms;
  let ok = cond();
  while (!ok && Date.now() < fine) {
    await act(async () => { await attendi(20); });
    ok = cond();
  }
  return ok;
}

async function aspetta(ms: number) {
  await act(async () => { await attendi(ms); });
}

async function apriFreccia() {
  await mouse(freccia(), 'mousedown');
  await mouse(freccia(), 'mouseup');
  await mouse(freccia(), 'click');
}

async function fuoco() {
  await act(async () => { input().focus(); await attendi(10); });
}

describe('SXADV-6236 — A. clic singolo sul testo apre', () => {
  it('A. senza fuoco prima: aperta entro 400 ms', async () => {
    monta(props());
    await clicTesto();
    expect(await entro(400, aperta), 'aperta entro 400 ms').toBe(true);
  });

  it('A. col fuoco gia\' dentro: aperta entro 400 ms', async () => {
    monta(props());
    await fuoco();
    await clicTesto();
    expect(await entro(400, aperta), 'aperta entro 400 ms').toBe(true);
  });

  it('A. aperta dal clic: input vuoto, tutte le opzioni, attiva la corrente (46), non la prima', async () => {
    monta(props());
    await clicTesto();
    expect(await entro(400, aperta), 'aperta').toBe(true);
    expect(input().value).toBe('');
    expect(opzioniVisibili().map((o) => o.textContent)).toEqual(TUTTE);
    expect(attiva()).toBe(L46);
  });

  it('A. aperta dal clic resta aperta (non si richiude da sola)', async () => {
    monta(props());
    await clicTesto();
    expect(await entro(400, aperta), 'aperta').toBe(true);
    await aspetta(500);
    expect(aperta()).toBe(true);
  });

  it('A. il clic su un\'altra parte della casella (fuori dall\'input) apre', async () => {
    monta(props());
    await mouse(selectEl(), 'mousedown');
    await mouse(selectEl(), 'mouseup');
    await mouse(selectEl(), 'click');
    expect(await entro(400, aperta), 'aperta entro 400 ms').toBe(true);
  });

  it('A. il mousedown sul testo non chiama preventDefault (la selezione resta possibile)', async () => {
    monta(props());
    const ev = await mouse(input(), 'mousedown');
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('SXADV-6236 — B. doppio clic non apre', () => {
  it('B. doppio clic sul testo: chiusa anche dopo 500 ms, testo intatto', async () => {
    monta(props());
    await doppioClicTesto();
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('B. doppio clic col fuoco gia\' dentro: chiusa, testo intatto', async () => {
    monta(props());
    await fuoco();
    await doppioClicTesto();
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('B. doppio clic LENTO (300 ms fra i clic): al secondo mousedown la descrizione e\' gia\' nell\'input, poi chiusa', async () => {
    const onChange = vi.fn();
    monta(props({ onChange }));
    const el = input();
    await mouse(el, 'mousedown', 1);
    await mouse(el, 'mouseup', 1);
    await mouse(el, 'click', 1);
    await aspetta(300); // oltre qualunque ritardo dell'apertura
    // premessa: il primo clic l'ha aperta (A), altrimenti il caso non prova niente
    expect(aperta(), 'aperta dopo il primo clic').toBe(true);
    let arrivato = false;
    const cattura = () => { arrivato = true; };
    window.addEventListener('mousedown', cattura, true);
    let dopo: string | null = null;
    try {
      act(() => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2, button: 0 }));
      });
      // il browser seleziona la parola come azione predefinita del mousedown:
      // a quel punto (prima del mouseup) il testo deve gia' esserci
      dopo = input().value;
    } finally {
      window.removeEventListener('mousedown', cattura, true);
    }
    expect(arrivato, 'mousedown detail=2 arrivato').toBe(true);
    expect(dopo, 'input subito dopo il mousedown detail=2').toBe(L46);
    await mouse(el, 'mouseup', 2);
    await mouse(el, 'click', 2);
    await mouse(el, 'dblclick', 2);
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('B. click con detail=0 (element.click(), lettori di schermo): a tendina chiusa non apre', async () => {
    monta(props());
    await fuoco();
    await act(async () => {
      input().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
      await attendi(10);
    });
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });

  it('B. click con detail=0 a tendina aperta (dalla freccia): non la chiude', async () => {
    monta(props());
    await fuoco();
    await apriFreccia();
    expect(aperta(), 'aperta prima').toBe(true);
    await act(async () => {
      input().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
      await attendi(10);
    });
    await aspetta(500);
    expect(aperta()).toBe(true);
  });

  it('B. doppio clic, selezione del codice, poi Tab: azienda invariata', async () => {
    const onChange = vi.fn();
    monta(props({ onChange }));
    await doppioClicTesto();
    act(() => { input().setSelectionRange(0, 2); });
    await aspetta(500);
    expect(selezionato()).toBe('46');
    await tasto('Tab');
    expect(cambi(onChange, '46')).toEqual([]);
  });
});

describe('SXADV-6236 — C. clic che seleziona non apre', () => {
  it('C. trascinamento (selezione 0-8): chiusa dopo 500 ms, la selezione resta', async () => {
    monta(props());
    await clicTesto(() => input().setSelectionRange(0, 8));
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
    expect(selezionato()).toBe(L46.slice(0, 8));
  });

  it('C. col fuoco gia\' dentro: stesso esito', async () => {
    monta(props());
    await fuoco();
    await clicTesto(() => input().setSelectionRange(0, 8));
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(selezionato()).toBe(L46.slice(0, 8));
  });
});

describe('SXADV-6236 — D. clic sul testo a tendina aperta chiude', () => {
  it('D. aperta con la freccia, clic sul testo: si chiude e non si riapre', async () => {
    monta(props());
    await fuoco();
    await apriFreccia();
    expect(aperta(), 'aperta prima').toBe(true);
    await clicTesto();
    expect(await entro(400, () => !aperta()), 'chiusa dopo il clic').toBe(true);
    await aspetta(500);
    expect(aperta(), 'non riaperta').toBe(false);
  });

  it('D. aperta dal clic, secondo clic (dopo una pausa): si chiude e non si riapre', async () => {
    monta(props());
    await clicTesto();
    expect(await entro(400, aperta), 'aperta prima').toBe(true);
    await aspetta(500); // oltre la soglia del doppio clic
    await clicTesto();
    expect(await entro(400, () => !aperta()), 'chiusa dopo il clic').toBe(true);
    await aspetta(500);
    expect(aperta(), 'non riaperta').toBe(false);
  });

  it('D. chiusa dal clic: l\'input torna a mostrare la descrizione', async () => {
    monta(props());
    await fuoco();
    await apriFreccia();
    await clicTesto();
    await entro(400, () => !aperta());
    await aspetta(500);
    expect(input().value).toBe(L46);
  });
});

describe('SXADV-6236 — E. disabled', () => {
  it('E. disabled: clic sul testo e sulla casella non aprono', async () => {
    const onChange = vi.fn();
    monta(props({ disabled: true, onChange }));
    await clicTesto();
    await mouse(selectEl(), 'mousedown');
    await mouse(selectEl(), 'mouseup');
    await mouse(selectEl(), 'click');
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('E. clic e poi disabled prima dell\'apertura differita: mai aperta, nemmeno per un attimo', async () => {
    const p = props();
    monta(p);
    const el = input();
    // gesto senza pause, poi disabled subito: l'apertura differita e' ancora in sospeso
    act(() => {
      for (const t of ['mousedown', 'mouseup', 'click'] as const) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, detail: 1, button: 0 }));
        if (t === 'mousedown') el.focus();
      }
    });
    act(() => { root!.render(<HeaderContextSelect {...p} disabled />); });
    const campioni: boolean[] = [aperta()];
    for (let i = 0; i < 25; i++) {
      await act(async () => { await attendi(20); });
      campioni.push(aperta());
    }
    expect(campioni.filter(Boolean).length, 'campioni (ogni 20 ms) con la tendina aperta').toBe(0);
  });
});

describe('SXADV-6236 — F. tastiera e freccia come 6137', () => {
  it('F. un carattere battuto non apre, non cambia il testo, non chiama onChange', async () => {
    const onChange = vi.fn();
    monta(props({ onChange }));
    await fuoco();
    const el = input();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      const kd = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
      Object.defineProperty(kd, 'keyCode', { get: () => 88 });
      Object.defineProperty(kd, 'which', { get: () => 88 });
      el.dispatchEvent(kd);
      setter.call(el, el.value + 'x');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', bubbles: true }));
      await attendi(30);
    });
    await aspetta(400);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
    expect(onChange).not.toHaveBeenCalled();
  });

  for (const [key, nome] of [['ArrowDown', 'Freccia giu\''], ['Enter', 'Invio'], [' ', 'Spazio']] as const) {
    it(`F. ${nome} col fuoco apre senza cambiare azienda`, async () => {
      const onChange = vi.fn();
      monta(props({ onChange }));
      await fuoco();
      await tasto(key);
      expect(aperta(), `aperta dopo ${nome}`).toBe(true);
      expect(cambi(onChange, '46')).toEqual([]);
    });
  }

  it('F. la freccia apre subito, con voce attiva = corrente', async () => {
    monta(props());
    await apriFreccia();
    expect(aperta()).toBe(true);
    expect(attiva()).toBe(L46);
  });

  it('F. la freccia apre e la tendina non si richiude da sola dopo 500 ms', async () => {
    monta(props());
    await fuoco();
    await apriFreccia();
    await aspetta(500);
    expect(aperta()).toBe(true);
  });

  for (const key of ['Tab', 'Enter'] as const) {
    it(`F. ${key} subito dopo l'apertura dalla freccia: azienda invariata`, async () => {
      const onChange = vi.fn();
      monta(props({ onChange }));
      await fuoco();
      await apriFreccia();
      await tasto(key);
      expect(cambi(onChange, '46')).toEqual([]);
    });

    it(`F. ${key} subito dopo l'apertura dal clic sul testo: azienda invariata`, async () => {
      const onChange = vi.fn();
      monta(props({ onChange }));
      await clicTesto();
      expect(await entro(400, aperta), 'aperta').toBe(true);
      await tasto(key);
      expect(cambi(onChange, '46')).toEqual([]);
    });
  }
});

describe('SXADV-6236 — G. scelta dopo l\'apertura dal clic', () => {
  it('G. clic su un\'opzione: onChange una volta col suo value, chiusa', async () => {
    const onChange = vi.fn();
    monta(props({ onChange }));
    await clicTesto();
    expect(await entro(400, aperta), 'aperta').toBe(true);
    const opt = opzioniVisibili().find((o) => o.textContent === AZIENDE[1].text);
    expect(opt, 'opzione 45').toBeTruthy();
    await act(async () => { opt!.click(); await attendi(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('45');
    expect(aperta()).toBe(false);
    await aspetta(500);
    expect(aperta(), 'non riaperta').toBe(false);
  });

  it('G. con padre che aggiorna value: l\'input mostra la nuova descrizione', async () => {
    const onChange = montaControllato('46');
    await clicTesto();
    expect(await entro(400, aperta), 'aperta').toBe(true);
    const opt = opzioniVisibili().find((o) => o.textContent === AZIENDE[1].text);
    expect(opt, 'opzione 45').toBeTruthy();
    await act(async () => { opt!.click(); await attendi(); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe('45');
    expect(aperta()).toBe(false);
    expect(input().value).toBe(AZIENDE[1].text);
    await aspetta(500);
    expect(input().value).toBe(AZIENDE[1].text);
  });
});

describe('SXADV-6236 — H. smontare con un\'apertura in sospeso', () => {
  it('H. clic e smontaggio immediato: niente eccezioni, niente console.error', async () => {
    const errori = vi.spyOn(console, 'error');
    const nonGestiti: unknown[] = [];
    const onErr = (e: ErrorEvent) => { nonGestiti.push(e.error ?? e.message); };
    window.addEventListener('error', onErr);
    try {
      monta(props());
      await clicTesto();
      expect(() => act(() => { root!.unmount(); })).not.toThrow();
      root = null;
      await new Promise((r) => setTimeout(r, 500));
      expect(nonGestiti).toEqual([]);
      expect(errori).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('error', onErr);
    }
  });
});

describe('SXADV-6236 — I. blur prima dell\'apertura differita', () => {
  it('I. clic singolo e subito il fuoco altrove: resta chiusa', async () => {
    const altro = document.createElement('button');
    document.body.appendChild(altro);
    monta(props());
    const el = input();
    // tutto il gesto senza pause: il blur arriva prima di qualunque attesa
    await act(async () => {
      for (const t of ['mousedown', 'mouseup', 'click'] as const) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, detail: 1, button: 0 }));
        if (t === 'mousedown') el.focus();
      }
      altro.focus();
      el.blur();
    });
    await aspetta(500);
    expect(aperta()).toBe(false);
    expect(input().value).toBe(L46);
  });
});
