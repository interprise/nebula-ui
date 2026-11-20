// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import MultiSceltaSelect from './MultiSceltaSelect';

// SXADV-6268 — campi a scelte multiple. Con scelte presenti la X «cancella
// tutto» a destra del campo (premuta per sbaglio toglie tutte le scelte) non
// c'e' piu': al suo posto una lente che riapre la tendina per aggiungere
// altre scelte. Per togliere le scelte restano la X su ogni singola scelta e,
// da tastiera, Backspace a campo vuoto. Le altre props passano invariate.

const OPZIONI = [
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
  { value: 'd', label: 'Delta' },
];

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
});

const attendi = (ms = 50) => new Promise((r) => setTimeout(r, ms));

type Props = React.ComponentProps<typeof MultiSceltaSelect>;

function monta(p: Partial<Props> = {}) {
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<MultiSceltaSelect options={OPZIONI} aria-label="Colonne" {...p} />); });
}

/** Controllato dal padre: onChange aggiorna davvero il valore. */
function montaControllato(iniziale: string[], onChange = vi.fn()) {
  function Padre() {
    const [v, setV] = React.useState<string[]>(iniziale);
    return (
      <MultiSceltaSelect
        options={OPZIONI}
        aria-label="Colonne"
        value={v}
        onChange={(nv: unknown, o: unknown) => { onChange(nv, o); setV(nv as string[]); }}
      />
    );
  }
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  act(() => { root!.render(<Padre />); });
  return onChange;
}

const select = () => {
  const s = box!.querySelector<HTMLElement>('.ant-select');
  expect(s, '.ant-select').toBeTruthy();
  return s!;
};
const input = () => {
  const i = box!.querySelector<HTMLInputElement>('.ant-select input');
  expect(i, 'input della select').toBeTruthy();
  return i!;
};
const chips = () => Array.from(box!.querySelectorAll<HTMLElement>('.ant-select-selection-item'))
  .filter((c) => !c.closest('.ant-select-selection-overflow-item-rest'));
const chipTexts = () => chips().map((c) => (c.textContent ?? '').trim());

/** Le opzioni della tendina, se aperta e non nascosta. */
function opzioniVisibili(): string[] {
  const pops = Array.from(document.querySelectorAll<HTMLElement>('.ant-select-dropdown'))
    .filter((d) => !/-hidden\b/.test(d.className) && d.style.display !== 'none');
  return pops.flatMap((d) => Array.from(d.querySelectorAll<HTMLElement>('.ant-select-item-option'))
    .map((o) => (o.textContent ?? '').trim()));
}

function mouse(el: Element, ...types: string[]) {
  act(() => {
    for (const t of types) el.dispatchEvent(new MouseEvent(t, { bubbles: t !== 'mouseenter' && t !== 'mouseleave', cancelable: true }));
  });
}

function tasto(el: Element, key: string, keyCode: number) {
  act(() => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => keyCode });
    Object.defineProperty(ev, 'which', { get: () => keyCode });
    el.dispatchEvent(ev);
  });
}

describe('SXADV-6268 — niente X «cancella tutto», una lente al suo posto', () => {
  it('con scelte presenti, a riposo, non c\'e\' la X «cancella tutto» (.ant-select-clear)', () => {
    monta({ value: ['a', 'b'] });
    expect(box!.querySelector('.ant-select-clear')).toBeNull();
  });

  it('con scelte presenti, al passaggio del mouse, non compare la X «cancella tutto»', async () => {
    monta({ value: ['a', 'b'] });
    mouse(select(), 'mouseover', 'mouseenter', 'mousemove');
    await act(async () => { await attendi(50); });
    expect(document.querySelector('.ant-select-clear')).toBeNull();
  });

  it('allowClear passato comunque (cast) non fa ricomparire la X', () => {
    monta({ value: ['a'], ...({ allowClear: true } as object) } as Partial<Props>);
    expect(box!.querySelector('.ant-select-clear')).toBeNull();
  });

  it('con scelte presenti, a destra c\'e\' l\'icona lente', () => {
    monta({ value: ['a', 'b'] });
    expect(box!.querySelector('.anticon-search')).toBeTruthy();
  });

  it('senza scelte, a destra c\'e\' l\'icona lente', () => {
    monta({ value: [] });
    expect(box!.querySelector('.anticon-search')).toBeTruthy();
  });

  it('un clic sulla lente apre la tendina (le opzioni diventano visibili)', async () => {
    monta({ value: ['a'] });
    expect(opzioniVisibili()).toEqual([]);
    const lente = box!.querySelector<HTMLElement>('.anticon-search')!;
    expect(lente).toBeTruthy();
    mouse(lente, 'mousedown', 'mouseup', 'click');
    await act(async () => { await attendi(100); });
    expect(opzioniVisibili().length).toBeGreaterThan(0);
  });

  it('il clic sulla lente non toglie le scelte', async () => {
    const onChange = montaControllato(['a', 'b']);
    const lente = box!.querySelector<HTMLElement>('.anticon-search')!;
    mouse(lente, 'mousedown', 'mouseup', 'click');
    await act(async () => { await attendi(100); });
    expect(onChange).not.toHaveBeenCalled();
    expect(chipTexts()).toEqual(['Alfa', 'Beta']);
  });

  it('e\' sempre a scelte multiple: dalla tendina si aggiunge una scelta alle altre', async () => {
    const onChange = montaControllato(['a']);
    mouse(box!.querySelector<HTMLElement>('.anticon-search')!, 'mousedown', 'mouseup', 'click');
    await act(async () => { await attendi(100); });
    const opt = Array.from(document.querySelectorAll<HTMLElement>('.ant-select-item-option'))
      .find((o) => (o.textContent ?? '').trim() === 'Gamma');
    expect(opt, 'opzione Gamma').toBeTruthy();
    mouse(opt!, 'mousedown', 'mouseup', 'click');
    await act(async () => { await attendi(50); });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toEqual(['a', 'c']);
  });
});

describe('SXADV-6268 — togliere le scelte una per volta', () => {
  it('ogni scelta ha la sua X', () => {
    monta({ value: ['a', 'b', 'c'] });
    expect(chips().length).toBe(3);
    for (const c of chips()) expect(c.querySelector('.ant-select-selection-item-remove'), `X di ${c.textContent}`).toBeTruthy();
  });

  it('la X di una scelta toglie solo quella: onChange con le altre', async () => {
    const onChange = montaControllato(['a', 'b', 'c']);
    const beta = chips().find((c) => (c.textContent ?? '').includes('Beta'))!;
    const x = beta.querySelector<HTMLElement>('.ant-select-selection-item-remove')!;
    mouse(x, 'mousedown', 'mouseup', 'click');
    await act(async () => { await attendi(50); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['a', 'c']);
    expect(chipTexts()).toEqual(['Alfa', 'Gamma']);
  });

  it('Backspace a campo vuoto toglie l\'ultima scelta', async () => {
    const onChange = montaControllato(['a', 'b', 'c']);
    act(() => { input().focus(); });
    tasto(input(), 'Backspace', 8);
    await act(async () => { await attendi(50); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['a', 'b']);
  });

  it('Backspace ripetuto toglie tutte le scelte, una alla volta', async () => {
    const onChange = montaControllato(['a', 'b']);
    act(() => { input().focus(); });
    tasto(input(), 'Backspace', 8);
    await act(async () => { await attendi(20); });
    tasto(input(), 'Backspace', 8);
    await act(async () => { await attendi(20); });
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([['a'], []]);
  });
});

describe('SXADV-6268 — le altre props passano invariate', () => {
  it('aria-label arriva all\'input', () => {
    monta({ value: [], 'aria-label': 'Aziende scelte' });
    expect(input().getAttribute('aria-label')).toBe('Aziende scelte');
  });

  it('placeholder mostrato a campo vuoto', () => {
    monta({ value: [], placeholder: 'Tutte le aziende' });
    expect(box!.textContent).toContain('Tutte le aziende');
  });

  it('value: le scelte mostrate sono quelle passate, con le etichette delle opzioni', () => {
    monta({ value: ['b', 'd'] });
    expect(chipTexts()).toEqual(['Beta', 'Delta']);
  });

  it('size="small" arriva alla select', () => {
    monta({ value: [], size: 'small' });
    expect(select().className).toMatch(/ant-select-sm\b/);
  });

  it('style arriva alla radice della select', () => {
    monta({ value: [], style: { width: 321 } });
    expect(select().style.width).toBe('321px');
  });

  it('maxTagCount: oltre il limite compare il «+ N»', () => {
    monta({ value: ['a', 'b', 'c', 'd'], maxTagCount: 2 });
    expect(box!.textContent).toMatch(/\+\s*2/);
  });

  it('optionFilterProp: la ricerca filtra sul campo indicato', async () => {
    monta({
      value: [],
      options: [{ value: 'x1', label: 'Uno', cerca: 'zebra' }, { value: 'x2', label: 'Due', cerca: 'gatto' }] as never,
      optionFilterProp: 'cerca',
      showSearch: true,
    });
    act(() => { input().focus(); });
    mouse(select(), 'mousedown', 'mouseup', 'click');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input(), 'zeb');
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await attendi(100); });
    expect(opzioniVisibili()).toEqual(['Uno']);
  });

  it('onChange riceve i valori come da antd', async () => {
    const onChange = vi.fn();
    monta({ value: ['a', 'b'], onChange });
    const x = chips()[0].querySelector<HTMLElement>('.ant-select-selection-item-remove')!;
    mouse(x, 'mousedown', 'mouseup', 'click');
    await act(async () => { await attendi(50); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(['b']);
  });
});

// ------------------------------------------------- usi da convertire (sorgenti)

const SRC = resolve(__dirname, '..');

function sorgenti(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'node_modules') sorgenti(p, out); continue; }
    if (!/\.(tsx|jsx)$/.test(n)) continue;
    if (/\.test\.(tsx|jsx)$/.test(n)) continue;
    out.push(p);
  }
  return out;
}

/** Il testo dei tag JSX `<Select ...>` (fino al `>` di chiusura dell'apertura, graffe bilanciate). */
function tagSelect(text: string): string[] {
  const out: string[] = [];
  const re = /<Select\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let quote: string | null = null;
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) { if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    out.push(text.slice(m.index, i + 1));
  }
  return out;
}

const MULTI = /\bmode\s*=\s*(\{\s*)?["'`](multiple|tags)["'`]/;
const CLEAR = /\ballowClear\b(?!\s*=\s*\{\s*false\s*\})/;

describe('SXADV-6268 — nessun Select multiplo con allowClear fuori da MultiSceltaSelect', () => {
  it('in src/ nessun <Select mode="multiple|tags"> con allowClear', () => {
    const colpevoli: string[] = [];
    for (const f of sorgenti(SRC)) {
      if (f.endsWith('MultiSceltaSelect.tsx')) continue;
      const text = readFileSync(f, 'utf8');
      for (const tag of tagSelect(text)) {
        if (MULTI.test(tag) && CLEAR.test(tag)) colpevoli.push(`${relative(SRC, f)}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    expect(colpevoli).toEqual([]);
  });

  it.each([
    'components/dashboard/ModificaWidget.tsx',
    'components/olap/OlapCubeRenderer.tsx',
  ])('%s usa MultiSceltaSelect', (rel) => {
    const text = readFileSync(join(SRC, rel), 'utf8');
    expect(text).toMatch(/import\s+MultiSceltaSelect\s+from\s+['"][./]+(components\/)?MultiSceltaSelect['"]/);
    expect(text).toContain('<MultiSceltaSelect');
  });

  it('il controllo dello scanner: riconosce un Select multiplo con allowClear', () => {
    const t = `<Select\n mode="multiple"\n value={x.filter((v) => v > 1)}\n allowClear\n/>`;
    const tags = tagSelect(t);
    expect(tags.length).toBe(1);
    expect(MULTI.test(tags[0]) && CLEAR.test(tags[0])).toBe(true);
    expect(CLEAR.test('<Select mode="multiple" allowClear={false} />')).toBe(false);
  });
});
