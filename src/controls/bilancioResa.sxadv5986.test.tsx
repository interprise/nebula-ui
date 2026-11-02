// @vitest-environment jsdom
/// <reference types="node" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import postcss from 'postcss';
import type { UIControl } from '../types/ui';
import { useCommonProps } from './helpers';
import { MoneyControl, NumberControl } from './builtins/NumberControl';
import LIST_RENDERER from '../components/ListRenderer.tsx?raw';
// Con il Theming API AG Grid non usa ag-grid.css: il foglio sta nel bundle e lo
// inietta a runtime, quindi le regole che contano si leggono da li'.
import AG_BUNDLE from '../../node_modules/ag-grid-community/dist/package/main.esm.mjs?raw';

// SXADV-5986 — tre promesse sulla resa dei campi e delle righe:
//   1. inputStyle (stringa CSS del server) diventa stile del campo, style vince;
//   2. il simbolo si mostra sempre, tranne a campo vuoto E non modificabile;
//   3. .ag-row.grayed / .ag-row.nested / .ag-cell.bold esistono e vincono.
//
// Cosa NON si prova qui: la resa a schermo. jsdom non calcola la cascata: per il
// punto 3 la si ricostruisce con specificita' e ordine, sui fogli veri.

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Da disco e non con ?raw: vitest svuota i .css importati, anche con ?raw.
const GLOBAL_CSS = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');

const roots: Root[] = [];

afterEach(() => {
  act(() => { roots.splice(0).forEach((r) => r.unmount()); });
  document.body.innerHTML = '';
});

function mountHost() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  return { host, root };
}

function mount(Comp: typeof MoneyControl, over: Partial<UIControl>) {
  const { host, root } = mountHost();
  const draw = (o: Partial<UIControl>) => {
    const control = { id: 'importo', name: 'importo.S1-0', type: 'money', editable: true, ...o } as UIControl;
    act(() => { root.render(<Comp control={control} pageType={2} onAction={vi.fn()} onChange={vi.fn()} />); });
  };
  draw(over);
  return { host, draw };
}

/** Lo stile che useCommonProps restituisce, letto dentro un vero render. */
function commonStyle(over: Partial<UIControl>) {
  const Probe = () => {
    const props = useCommonProps({ id: 'x', name: 'x', type: 'text', editable: true, ...over } as UIControl);
    return <pre>{JSON.stringify(props.style ?? {})}</pre>;
  };
  const { host, root } = mountHost();
  act(() => { root.render(<Probe />); });
  return JSON.parse(host.textContent ?? 'null');
}

describe('useCommonProps: inputStyle diventa stile del campo', () => {
  it('senza style: arriva inputStyle, con le proprieta\' in camelCase', () => {
    expect(commonStyle({ inputStyle: 'font-weight:bold; text-align: right' }))
      .toEqual({ fontWeight: 'bold', textAlign: 'right' });
  });

  it('senza inputStyle: style funziona come prima', () => {
    expect(commonStyle({ style: 'font-style:italic' })).toEqual({ fontStyle: 'italic' });
  });

  it('sui conflitti vince style, le altre proprieta\' di inputStyle restano', () => {
    expect(commonStyle({ inputStyle: 'color:red;font-weight:bold', style: 'color:blue' }))
      .toEqual({ color: 'blue', fontWeight: 'bold' });
  });

  it.each([
    ['nessuno dei due', {}],
    ['stringhe vuote', { inputStyle: '', style: '' }],
    ['valori null dal server', { inputStyle: null, style: null } as unknown as Partial<UIControl>],
  ])('%s: nessuno stile, niente eccezioni', (_nome, over) => {
    expect(commonStyle(over)).toEqual({});
  });

  it('una regola malformata si scarta e non porta via le altre', () => {
    expect(commonStyle({ inputStyle: 'senzaduepunti;font-weight:bold;;' })).toEqual({ fontWeight: 'bold' });
  });

  it('sul campo importo inputStyle arriva al riquadro, senza perdere la larghezza', () => {
    const { host } = mount(MoneyControl, { value: '1,00', size: 10, inputStyle: 'font-weight:bold' });
    const box = host.querySelector<HTMLElement>('.ant-input-number');
    expect(box?.style.fontWeight).toBe('bold');
    expect(box?.style.width).not.toBe('');
  });

  // Lo scopo dichiarato e' il grassetto degli importi. Lo style di InputNumber
  // cade sul riquadro, ma l'<input> non eredita il peso: il foglio del browser
  // gli da' `font: -webkit-small-control` (in Chrome: riquadro 700, input 400) e
  // ne' antd ne' global.css lo riportano a inherit. Basta una delle due strade:
  // stile sull'<input>, oppure una regola che lo faccia ereditare.
  it('il grassetto arriva alle cifre: sull\'<input>, non solo sul riquadro', () => {
    const { host } = mount(MoneyControl, { value: '1,00', inputStyle: 'font-weight:bold' });
    const input = host.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    const inlineSullInput = input!.style.fontWeight === 'bold';
    const css = postcss.parse(GLOBAL_CSS);
    let eredita = false;
    css.walkRules((rule) => {
      if (!rule.selector.includes('.ant-input-number-input')) return;
      rule.walkDecls((d) => {
        if ((d.prop === 'font-weight' || d.prop === 'font') && d.value.includes('inherit')) eredita = true;
      });
    });
    expect(inlineSullInput || eredita).toBe(true);
  });
});

describe('MoneyControl: quando si vede il simbolo', () => {
  const simbolo = (host: HTMLElement) => host.querySelector('.currency-suffix')?.textContent ?? null;
  const SYM = { currencySymbol: '€' };

  it.each([
    ['pieno, modificabile', { value: '1.234,00', editable: true }, '€'],
    ['pieno, non modificabile', { value: '1.234,00', editable: false }, '€'],
    ['pieno, disabled', { value: '1.234,00', disabled: true }, '€'],
    ['null, modificabile', { value: null, editable: true }, '€'],
    ['stringa vuota, modificabile', { value: '', editable: true }, '€'],
    ['undefined, modificabile', { editable: true }, '€'],
    ['null, non modificabile', { value: null, editable: false }, null],
    ['null, disabled', { value: null, disabled: true }, null],
    ['stringa vuota, non modificabile', { value: '', editable: false }, null],
    ['stringa vuota, disabled', { value: '', disabled: true }, null],
    ['undefined, non modificabile', { editable: false }, null],
    ['solo spazi, non modificabile', { value: '   ', editable: false }, null],
  ] as [string, Partial<UIControl>, string | null][])('%s', (_nome, over, atteso) => {
    const { host } = mount(MoneyControl, { ...SYM, ...over });
    expect(simbolo(host)).toBe(atteso);
  });

  // Zero e' un valore: un controllo "falsy" farebbe sparire la valuta dai saldi a 0.
  it.each([
    ['numero 0', 0],
    ['stringa "0"', '0'],
    ['stringa "0,00"', '0,00'],
    ['negativo', '-5,00'],
  ] as [string, unknown][])('%s, non modificabile: il simbolo resta', (_nome, value) => {
    const { host } = mount(MoneyControl, { ...SYM, value, editable: false } as Partial<UIControl>);
    expect(simbolo(host)).toBe('€');
  });

  it('0 modificabile: il simbolo resta', () => {
    const { host } = mount(MoneyControl, { ...SYM, value: 0 } as Partial<UIControl>);
    expect(simbolo(host)).toBe('€');
  });

  it('segue il valore fra un giro e l\'altro col server', () => {
    const { host, draw } = mount(MoneyControl, { ...SYM, value: null, editable: false });
    expect(simbolo(host)).toBeNull();
    draw({ ...SYM, value: '10,00', editable: false });
    expect(simbolo(host)).toBe('€');
    draw({ ...SYM, value: '', editable: false });
    expect(simbolo(host)).toBeNull();
  });

  it('segue la modificabilita\' a campo vuoto', () => {
    const { host, draw } = mount(MoneyControl, { ...SYM, value: null, editable: true });
    expect(simbolo(host)).toBe('€');
    draw({ ...SYM, value: null, editable: false });
    expect(simbolo(host)).toBeNull();
  });

  it('entita\' HTML dal server e default sull\'euro restano com\'erano', () => {
    expect(simbolo(mount(MoneyControl, { currencySymbol: '&euro;', value: '1,00' }).host)).toBe('€');
    expect(simbolo(mount(MoneyControl, { currencySymbol: '', value: '1,00' }).host)).toBe('€');
  });

  it('NumberControl non ha valuta, nemmeno se il server la manda', () => {
    const { host } = mount(NumberControl, { ...SYM, value: '1,00', type: 'number' });
    expect(simbolo(host)).toBeNull();
  });
});

// La sigla (%, kg...) esce da UMNumberUIControl come `unitSuffix`, non come
// currencySymbol, e passa da un ramo a parte di MoneyInput.
describe('NumberControl: la sigla (%, unita\' di misura)', () => {
  const sigla = (host: HTMLElement) => host.querySelector('.unit-suffix')?.textContent ?? null;
  const base = { type: 'number', unitSuffix: '%' } as Partial<UIControl>;

  it.each([
    ['pieno, modificabile', { value: '5,00' }, '%'],
    ['pieno, non modificabile', { value: '5,00', editable: false }, '%'],
    ['vuoto, modificabile', { value: null }, '%'],
    ['0, non modificabile', { value: 0, editable: false }, '%'],
    // La sigla non segue la regola della valuta: il ticket chiede di togliere
    // solo l'euro, e il legacy (UMNumberUIControl) scrive la sigla anche a campo vuoto.
    ['null, non modificabile', { value: null, editable: false }, '%'],
    ['stringa vuota, non modificabile', { value: '', editable: false }, '%'],
  ] as [string, Partial<UIControl>, string | null][])('%s', (_nome, over, atteso) => {
    const { host } = mount(NumberControl, { ...base, ...over });
    expect(sigla(host)).toBe(atteso);
  });
});

// --- Punto 3: la cascata ricostruita sui fogli veri -------------------------

function agRowRules(): string {
  const found = [...AG_BUNDLE.matchAll(/\}(\.ag-row(?:-odd)?)\{background-color:([^;}]+)/g)];
  return found.map((m) => `${m[1]}{background-color:${m[2]}}`).join('\n');
}

function specificity(sel: string): [number, number, number] {
  const s = sel.replace(/:(?:not|is)\(([^)]*)\)/g, ' $1 ').replace(/:where\([^)]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (s.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*|::[\w-]+/g) ?? []).length;
  return [ids, cls, tags];
}

/** Il valore che la cascata assegna a `prop` su un elemento con quelle classi.
 *  Solo regole di primo livello: @media e affini non si valutano. */
function vincitore(classi: string, prop: string, css: string): string | undefined {
  const el = document.createElement('div');
  el.className = classi;
  let best: { imp: boolean; spec: [number, number, number]; value: string } | undefined;
  for (const node of postcss.parse(css).nodes) {
    if (node.type !== 'rule') continue;
    for (const sel of node.selectors) {
      let ok = false;
      try { ok = el.matches(sel); } catch { ok = false; }
      if (!ok) continue;
      node.walkDecls(prop, (d) => {
        const cand = { imp: !!d.important, spec: specificity(sel), value: d.value };
        const cmp = !best ? 1
          : cand.imp !== best.imp ? (cand.imp ? 1 : -1)
          : cand.spec[0] - best.spec[0] || cand.spec[1] - best.spec[1] || cand.spec[2] - best.spec[2] || 1;
        if (cmp > 0) best = cand;
      });
    }
  }
  return best?.value;
}

describe('global.css: classi legacy di riga e di cella', () => {
  const css = () => `${agRowRules()}\n${GLOBAL_CSS}`;

  it.each([
    ['.ag-row.grayed', 'background-color', /^#ffffcc$/i],
    ['.ag-row.nested', 'background-color', /^#bbbbbb$/i],
    ['.ag-cell.bold', 'font-weight', /^(bold|700)$/],
  ] as [string, string, RegExp][])('la regola %s esiste, a primo livello', (sel, prop, atteso) => {
    const regole = postcss.parse(GLOBAL_CSS).nodes.filter(
      (n) => n.type === 'rule' && n.selectors.includes(sel),
    );
    expect(regole.length).toBe(1);
    const decl = regole[0].type === 'rule' ? regole[0].nodes.find((d) => d.type === 'decl' && d.prop === prop) : undefined;
    expect(decl && decl.type === 'decl' ? decl.value : '').toMatch(atteso);
  });

  it('il foglio di AG Grid colora le righe con .ag-row e .ag-row-odd, come qui si assume', () => {
    const regole = agRowRules();
    expect(regole).toContain('.ag-row{');
    expect(regole).toContain('.ag-row-odd{');
  });

  it('AG Grid non e\' messo in un @layer che cambierebbe i conti', () => {
    expect(LIST_RENDERER).not.toMatch(/themeCssLayer|themeStyleContainer/);
    expect(GLOBAL_CSS).not.toMatch(/@layer/);
  });

  it.each([
    ['riga pari di AG', 'ag-row ag-row-even grayed', '#ffffcc'],
    ['riga dispari di AG', 'ag-row ag-row-odd grayed', '#ffffcc'],
    ['zebra del server oddRow', 'ag-row ag-row-odd oddRow grayed', '#ffffcc'],
    ['zebra del server evenRow', 'ag-row ag-row-even evenRow grayed', '#ffffcc'],
    ['zebra scritta dopo', 'ag-row grayed oddRow', '#ffffcc'],
    ['banda di continuazione', 'ag-row ag-row-odd continuation-row continuation-row-last grayed', '#ffffcc'],
    ['prima riga di un record a piu\' bande', 'ag-row record-first-row grayed', '#ffffcc'],
    ['nested su AG dispari', 'ag-row ag-row-odd nested', '#BBBBBB'],
    ['nested con zebra del server', 'ag-row ag-row-odd oddRow nested', '#BBBBBB'],
    ['nested su banda di continuazione', 'ag-row continuation-row nested', '#BBBBBB'],
  ])('sfondo: %s', (_nome, classi, atteso) => {
    expect(vincitore(classi, 'background-color', css())?.toLowerCase()).toBe(atteso.toLowerCase());
  });

  // Il colore di stato non deve nascondere dove si trova l'utente.
  it.each([
    ['record-group-hover'],
    ['record-group-selected'],
    ['record-row-editing'],
  ])('%s continua a vincere su grayed e nested', (stato) => {
    for (const c of ['grayed', 'nested']) {
      const v = vincitore(`ag-row ${stato} ${c}`, 'background-color', css());
      expect(v).toMatch(/^var\(/);
    }
  });

  it('una riga senza classi di stato non prende i colori nuovi', () => {
    const v = vincitore('ag-row ag-row-even', 'background-color', css());
    expect(v?.toLowerCase()).not.toBe('#ffffcc');
    expect(v?.toLowerCase()).not.toBe('#bbbbbb');
  });

  it('grassetto: .ag-cell.bold non e\' annullato da global.css', () => {
    expect(vincitore('ag-cell bold', 'font-weight', GLOBAL_CSS)).toBe('bold');
    expect(vincitore('ag-cell ag-right-aligned-cell bold', 'font-weight', GLOBAL_CSS)).toBe('bold');
    expect(vincitore('ag-cell', 'font-weight', GLOBAL_CSS)).toBeUndefined();
  });

  it('grassetto: AG Grid non fissa il peso su cella e valore di cella', () => {
    expect(AG_BUNDLE).not.toMatch(/\.ag-cell(?:-value|-wrapper)?\{[^{}]*font-weight/);
  });
});
