// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// SXADV-6244 — «Cerca» di lista/tab con un filtro attivo (SXADV-6242).
//  6244.1: svuotando il campo con la X la lista restava filtrata. Contratto:
//          con un filtro attivo la X del campo (allowClear di antd Input)
//          toglie il filtro — la stessa chiamata del «Togli il filtro» del Tag
//          (filterParams(listPath, '') = { navpath, option1: '' }). Senza
//          filtro la X non chiama applyFilter.
//  6244.2: tolto il testo, l'imbuto attivo non si disattivava (cursore di
//          divieto). Contratto: con un filtro attivo l'imbuto e' abilitato
//          anche a campo vuoto e un clic toglie il filtro; con lo stesso testo
//          del filtro nel campo un clic lo toglie (interruttore). Senza filtro,
//          a campo vuoto l'imbuto resta disabilitato.
//  Cancellare il testo a mano (onChange a '', non la X) NON toglie il filtro.
//
// Qui con il DOM vero (jsdom + antd), non col motore di hook dei test 6242:
// la «X del campo» e' un elemento di antd, e come il componente la distingua
// dalla cancellazione a mano (onClear, tipo dell'evento...) non e' contratto.

const fb = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  failure: vi.fn(),
  confirm: vi.fn(),
  showServerMessages: vi.fn(),
}));
vi.mock('../hooks/feedback', () => ({ useFeedback: () => fb }));

const { default: ListSearchBox } = await import('./ListSearchBox');

const LIST = 'S1-0.2,S1-3';
const TOGLI = { navpath: LIST, option1: '' };

type Filter = { text: string; col?: string } | null;

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

beforeEach(() => {
  for (const f of Object.values(fb)) f.mockReset();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  box?.remove();
  box = null;
  document.body.innerHTML = '';
});

const flush = async () => {
  await act(async () => { for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0)); });
};

function monta(filter: Filter, applyFilter = vi.fn(async () => ({ filtered: { count: 3 } })), locate = vi.fn(async () => ({ located: { found: false, more: false, position: -1, scanned: 0 } }))) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  const render = (f: Filter) => act(() => {
    root!.render(<ListSearchBox listPath={LIST} locate={locate} onFound={vi.fn()} applyFilter={applyFilter} filter={f} />);
  });
  render(filter);
  return { applyFilter, locate, rerender: render };
}

const campo = () => {
  const i = box!.querySelector<HTMLInputElement>('input[aria-label="Cerca nella lista"]');
  expect(i, 'campo «Cerca»').toBeTruthy();
  return i!;
};

/** Digita come farebbe l'utente: valore nativo + evento input (React onChange). */
function digita(text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(campo(), text);
    campo().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function clic(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const xDelCampo = () => box!.querySelector<HTMLElement>('.ant-input-clear-icon');
const imbuto = () => {
  const b = box!.querySelector<HTMLButtonElement>('[aria-label="Filtra la lista"]');
  expect(b, 'pulsante a imbuto').toBeTruthy();
  return b!;
};
const disabilitato = (b: HTMLElement) =>
  (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true' || b.classList.contains('ant-btn-disabled');
const togliTag = () => box!.querySelector<HTMLElement>('[aria-label="Togli il filtro"]');
const calls = (fn: { mock: { calls: unknown } }) => (fn.mock.calls as unknown[][]).map((c) => c[0]);

describe('impianto: il «Togli il filtro» del Tag (SXADV-6242) nel DOM', () => {
  it('con un filtro attivo il Tag toglie il filtro con { navpath, option1: \'\' }', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    const t = togliTag();
    expect(t).toBeTruthy();
    clic(t!);
    await flush();
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });
});

describe('SXADV-6244.1 — la X del campo toglie il filtro', () => {
  it('filtro attivo, testo del filtro nel campo: la X chiama applyFilter come «Togli il filtro»', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('rossi');
    const x = xDelCampo();
    expect(x, 'X del campo').toBeTruthy();
    clic(x!);
    await flush();
    expect(campo().value).toBe('');
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });

  it('filtro attivo, nel campo un altro testo: la X toglie comunque il filtro', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('bianchi');
    clic(xDelCampo()!);
    await flush();
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });

  it('filtro attivo in una colonna: la X manda gli stessi parametri del Tag (niente col)', async () => {
    const { applyFilter } = monta({ text: 'rossi', col: 'descrizione' });
    digita('rossi');
    clic(xDelCampo()!);
    await flush();
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });

  it('la X chiama applyFilter una volta sola', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('rossi');
    clic(xDelCampo()!);
    await flush();
    expect(applyFilter).toHaveBeenCalledTimes(1);
  });

  it('senza filtro attivo la X svuota il campo e non chiama applyFilter', async () => {
    const { applyFilter, locate } = monta(null);
    digita('rossi');
    clic(xDelCampo()!);
    await flush();
    expect(campo().value).toBe('');
    expect(applyFilter).not.toHaveBeenCalled();
    expect(locate).not.toHaveBeenCalled();
  });

  it('cancellare a mano fino a campo vuoto NON toglie il filtro', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('rossi');
    digita('ross');
    digita('');
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
    // Il filtro resta toglibile: dal Tag o dall'imbuto.
    expect(togliTag() !== null || !disabilitato(imbuto())).toBe(true);
  });
});

describe('SXADV-6244.2 — l\'imbuto con un filtro attivo e\' un interruttore', () => {
  it('filtro attivo, campo vuoto: l\'imbuto e\' abilitato e premuto', () => {
    monta({ text: 'rossi' });
    expect(campo().value).toBe('');
    expect(disabilitato(imbuto())).toBe(false);
    expect(imbuto().getAttribute('aria-pressed')).toBe('true');
  });

  it('filtro attivo, campo vuoto: un clic sull\'imbuto toglie il filtro come il Tag', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    clic(imbuto());
    await flush();
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });

  it('filtro attivo, svuotato a mano: l\'imbuto e\' abilitato e un clic toglie il filtro', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('rossi');
    digita('');
    expect(disabilitato(imbuto())).toBe(false);
    clic(imbuto());
    await flush();
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });

  it('filtro attivo e lo stesso testo nel campo: un clic sull\'imbuto toglie il filtro', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('rossi');
    clic(imbuto());
    await flush();
    expect(calls(applyFilter)).toEqual([TOGLI]);
  });

  it('filtro attivo e un testo diverso nel campo: l\'imbuto filtra col testo nuovo (come prima)', async () => {
    const { applyFilter } = monta({ text: 'rossi' });
    digita('bianchi');
    clic(imbuto());
    await flush();
    expect(calls(applyFilter)).toEqual([{ navpath: LIST, option1: 'bianchi' }]);
  });

  it('senza filtro, campo vuoto: l\'imbuto resta disabilitato e non chiama nulla', async () => {
    const { applyFilter } = monta(null);
    expect(disabilitato(imbuto())).toBe(true);
    clic(imbuto());
    await flush();
    expect(applyFilter).not.toHaveBeenCalled();
  });

  it('senza filtro, con un testo: l\'imbuto mette il filtro (come prima)', async () => {
    const { applyFilter } = monta(null);
    digita('rossi');
    expect(disabilitato(imbuto())).toBe(false);
    clic(imbuto());
    await flush();
    expect(calls(applyFilter)).toEqual([{ navpath: LIST, option1: 'rossi' }]);
  });

  it('tolto il filtro (il server lo dice), a campo vuoto l\'imbuto torna disabilitato e non premuto', async () => {
    const { rerender } = monta({ text: 'rossi' });
    clic(imbuto());
    await flush();
    rerender(null);
    expect(disabilitato(imbuto())).toBe(true);
    expect(imbuto().getAttribute('aria-pressed')).toBe('false');
  });
});
