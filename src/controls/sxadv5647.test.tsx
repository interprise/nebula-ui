import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIControl } from '../types/ui';
import { withPostDecorations } from './decorations';
import MultiSelectControl from './MultiSelectControl';
import MultiSelectBuiltin from './builtins/MultiSelectBuiltin';
import TextControl from './builtins/TextControl';
import { NumberControl } from './builtins/NumberControl';
import { DateControl } from './builtins/DateControl';
import ComboControl from './builtins/ComboControl';

// SXADV-5647 — mappa di ricerca e controlli:
//  .4 la casella "not" sta dopo il campo, come addNegationCheckBox del legacy
//     (UIControl.addPostDecoration: not, post-prompt, stella);
//  .5 il multiselect non ha catenella, gli altri controlli si';
//  .6 il testo "Clicca per selezionare" non e' grigio se il campo e' editabile,
//     freccia e calendario abilitati in colore scuro; sottotitolo corsivo azzurro.
//
// Niente DOM nel progetto: render lato server e lettura del foglio di stile.
// Cosa NON si prova: il colore davvero applicato dal browser (cascata con antd).

const QUERY = 0;
const LIST = 1;
const DETAIL = 2;

const NAV = { command: 'NavigateView', navpath: 'S1-0', controlName: 'campo' };
const ADD = { command: 'NavigateAdd', navpath: 'S1-0', controlName: 'campo' };
const FIELD = '<input data-testid="campo"/>';

const ctl = (over: Partial<UIControl> = {}): UIControl =>
  ({ type: 'text', name: 'campo.S1-0', id: 'campo', editable: true, ...over }) as UIControl;

const noop = () => {};
const decorate = (control: UIControl, pageType: number | undefined = QUERY) =>
  renderToStaticMarkup(
    <>{withPostDecorations(<input data-testid="campo" />, control, pageType, noop, noop)}</>,
  );

/** Posizioni nel markup: -1 se assente, cosi' i confronti d'ordine non passano per caso. */
const at = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  expect(i, `${needle} assente in ${html}`).toBeGreaterThanOrEqual(0);
  return i;
};

describe('withPostDecorations — posto della casella not (5647.4)', () => {
  const full = () =>
    decorate(
      ctl({
        negation: true,
        postPrompt: 'giorni',
        mandatory: true,
        value: 'x',
        navigateView: NAV,
        lookupViewName: 'lk',
        navigateLookupCommand: 'NavigateLookup',
      } as Partial<UIControl>),
    );

  it('la casella sta dopo il campo', () => {
    const html = full();
    expect(at(html, FIELD)).toBeLessThan(at(html, 'negation-box'));
  });

  it('la casella sta prima del post-prompt', () => {
    const html = full();
    expect(at(html, 'negation-box')).toBeLessThan(at(html, 'post-prompt'));
  });

  it.each(['mandatory-icon', 'nav-icon', 'lookup-icon'])('la casella sta prima di %s', (cls) => {
    const html = full();
    expect(at(html, 'negation-box')).toBeLessThan(at(html, cls));
  });

  it('la casella sta prima del +', () => {
    const html = decorate(ctl({ negation: true, navigateAdd: ADD } as Partial<UIControl>));
    expect(at(html, 'negation-box')).toBeLessThan(at(html, 'add-icon'));
  });

  it('il post-prompt resta prima della stella, come il legacy', () => {
    const html = full();
    expect(at(html, 'post-prompt')).toBeLessThan(at(html, 'mandatory-icon'));
  });

  it('il campo compare una volta sola', () => {
    expect(full().split(FIELD)).toHaveLength(2);
  });
});

describe('withPostDecorations — quando compare la casella not', () => {
  it('con negation su pageType 0 compare, con la sua etichetta', () => {
    const html = decorate(ctl({ negation: true }), QUERY);
    expect(html).toContain('negation-box');
    expect(html).toMatch(/negation-label[^>]*>not</);
  });

  it.each([
    ['lista', LIST],
    ['dettaglio', DETAIL],
    ['senza pageType', undefined],
  ])('con negation su %s non compare', (_n, pageType) => {
    const html = renderToStaticMarkup(
      <>{withPostDecorations(<input />, ctl({ negation: true }), pageType, noop, noop)}</>,
    );
    expect(html).not.toContain('negation-box');
  });

  it('senza negation su pageType 0 non compare', () => {
    expect(decorate(ctl({ negation: false }), QUERY)).not.toContain('negation-box');
    expect(decorate(ctl(), QUERY)).not.toContain('negation-box');
  });

  it('senza nessuna decorazione il campo resta nudo, senza involucro', () => {
    expect(decorate(ctl({ negation: true }), DETAIL)).toBe(FIELD);
  });

  it('negationValue dal server si vede spuntato', () => {
    const on = decorate(ctl({ negation: true, negationValue: true }));
    const off = decorate(ctl({ negation: true, negationValue: false }));
    expect(on).toContain('ant-checkbox-checked');
    expect(off).not.toContain('ant-checkbox-checked');
  });
});

describe('withPostDecorations — il + (navigateAdd)', () => {
  it.each([
    ['stringa vuota', ''],
    ['null', null],
    ['undefined', undefined],
  ])('con navigateAdd e campo vuoto (%s) compare', (_n, value) => {
    expect(decorate(ctl({ navigateAdd: ADD, value } as Partial<UIControl>), DETAIL)).toContain('add-icon');
  });

  it.each([
    ['testo', 'x'],
    ['zero', 0],
    ['falso', false],
  ])('con campo valorizzato (%s) non compare', (_n, value) => {
    expect(decorate(ctl({ navigateAdd: ADD, value } as Partial<UIControl>), DETAIL)).not.toContain('add-icon');
  });

  it('senza navigateAdd non compare, anche a campo vuoto', () => {
    expect(decorate(ctl({ value: '' }), DETAIL)).not.toContain('add-icon');
  });

  it('compare anche su un campo non modificabile: lo decide il server', () => {
    expect(decorate(ctl({ navigateAdd: ADD, editable: false }), DETAIL)).toContain('add-icon');
  });

  it('il clic chiama il comando del server con navpath e nome nudo', () => {
    const onAction = vi.fn();
    const el = withPostDecorations(
      <input />,
      ctl({ navigateAdd: ADD }),
      DETAIL,
      onAction,
    ) as React.ReactElement<{ children: React.ReactNode }>;
    const plus = React.Children.toArray(el.props.children).find(
      (c) => React.isValidElement<{ className?: string }>(c) && c.props.className === 'add-icon',
    ) as React.ReactElement<{ onClick: () => void }>;
    plus.props.onClick();
    expect(onAction).toHaveBeenCalledWith('NavigateAdd', { navpath: 'S1-0', option1: 'campo' });
  });

  it('catenella e + si escludono: la catenella col valore, il + senza', () => {
    const both = { navigateView: NAV, navigateAdd: ADD };
    const pieno = decorate(ctl({ ...both, value: 'x' }), DETAIL);
    const vuoto = decorate(ctl({ ...both, value: '' }), DETAIL);
    expect(pieno).toContain('nav-icon');
    expect(pieno).not.toContain('add-icon');
    expect(vuoto).toContain('add-icon');
    expect(vuoto).not.toContain('nav-icon');
  });
});

describe('MultiSelectBuiltin — niente catenella, il resto si (5647.5)', () => {
  const multi = (over: Partial<UIControl>, pageType: number) =>
    renderToStaticMarkup(
      <MultiSelectBuiltin
        control={ctl({ type: 'multiselect', value: 'A,B', navigateView: NAV, ...over })}
        pageType={pageType}
        onAction={noop}
        onChange={noop}
      />,
    );

  it.each([
    ['mappa', QUERY],
    ['dettaglio', DETAIL],
  ])('in %s non disegna .nav-icon anche se il server manda navigateView', (_n, pageType) => {
    expect(multi({}, pageType)).not.toContain('nav-icon');
  });

  it('non editabile: nemmeno li\' la catenella', () => {
    expect(multi({ editable: false }, DETAIL)).not.toContain('nav-icon');
  });

  it('in mappa conserva il not, dopo il controllo', () => {
    const html = multi({ negation: true }, QUERY);
    expect(at(html, 'multiselect-container')).toBeLessThan(at(html, 'negation-box'));
    expect(at(html, 'multiselect-picker-btn')).toBeLessThan(at(html, 'negation-box'));
  });

  it.each([
    ['mappa', QUERY],
    ['dettaglio', DETAIL],
  ])('in %s conserva la stella dell\'obbligatorio', (_n, pageType) => {
    const html = multi({ mandatory: true }, pageType);
    expect(html).toContain('mandatory-icon');
    expect(html).not.toContain('nav-icon');
  });

  it('conserva il post-prompt', () => {
    expect(multi({ postPrompt: 'voci' }, DETAIL)).toContain('post-prompt');
  });

  it('conserva il + a selezione vuota', () => {
    const html = multi({ value: '', navigateAdd: ADD }, DETAIL);
    expect(html).toContain('add-icon');
    expect(html).not.toContain('nav-icon');
  });

  it('il controllo del server non viene toccato', () => {
    const control = ctl({ type: 'multiselect', value: 'A', navigateView: NAV });
    renderToStaticMarkup(
      <MultiSelectBuiltin control={control} pageType={DETAIL} onAction={noop} onChange={noop} />,
    );
    expect(control.navigateView).toBe(NAV);
  });
});

describe('gli altri controlli conservano la catenella', () => {
  it.each([
    ['text', TextControl, 'x'],
    ['number', NumberControl, '12'],
    ['date', DateControl, '01/01/2026'],
    ['combo', ComboControl, 'x'],
  ])('%s con navigateView e valore disegna .nav-icon', (type, Comp, value) => {
    for (const pageType of [QUERY, DETAIL]) {
      const html = renderToStaticMarkup(
        <Comp
          control={ctl({ type, value, navigateView: NAV })}
          pageType={pageType}
          onAction={noop}
          onChange={noop}
        />,
      );
      expect(html).toContain('nav-icon');
    }
  });
});

describe('MultiSelectControl — testo a selezione vuota (5647.6)', () => {
  const empty = (editable: boolean, over: Partial<UIControl> = {}) =>
    renderToStaticMarkup(
      <MultiSelectControl
        control={ctl({ type: 'multiselect', ...over })}
        editable={editable}
        value=""
        onChange={noop}
        onAction={noop}
      />,
    );

  /** Il tag che contiene esattamente quel testo. */
  const tagOf = (html: string, text: string) => {
    const m = new RegExp(`<[^<>]*>${text}<`).exec(html);
    expect(m, `${text} assente in ${html}`).not.toBeNull();
    return m![0];
  };

  it('editabile: "Clicca per selezionare" senza type secondary', () => {
    const tag = tagOf(empty(true), 'Clicca per selezionare');
    expect(tag).toContain('ant-typography');
    expect(tag).not.toContain('ant-typography-secondary');
  });

  it('non editabile: "Nessuna selezione" con type secondary', () => {
    expect(tagOf(empty(false), 'Nessuna selezione')).toContain('ant-typography-secondary');
  });

  it('ognuno il suo testo', () => {
    expect(empty(true)).not.toContain('Nessuna selezione');
    expect(empty(false)).not.toContain('Clicca per selezionare');
  });

  it('entrambi restano in corsivo', () => {
    expect(tagOf(empty(true), 'Clicca per selezionare')).toContain('font-style:italic');
    expect(tagOf(empty(false), 'Nessuna selezione')).toContain('font-style:italic');
  });

  it('con selezione nessuno dei due testi', () => {
    const html = renderToStaticMarkup(
      <MultiSelectControl
        control={ctl({ type: 'multiselect' })}
        editable
        value="A"
        onChange={noop}
        onAction={noop}
      />,
    );
    expect(html).not.toContain('Clicca per selezionare');
    expect(html).not.toContain('Nessuna selezione');
  });
});

describe('global.css (5647.6)', () => {
  // Non ?raw: sotto vitest un .css importato arriva vuoto.
  const css = readFileSync(resolve(__dirname, '../styles/global.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  /** Regole di primo livello, e dentro le @media: selettori separati, corpo intero. */
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1].split(',').map((s: string) => s.trim().replace(/\s+/g, ' ')),
    body: m[2],
  }));
  const prop = (body: string, name: string) =>
    new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();
  const rulesFor = (selector: string) => rules.filter((r) => r.selectors.includes(selector));
  const mentioning = (cls: string) =>
    rules.filter((r) => r.selectors.some((s: string) => s.includes(cls)) && prop(r.body, 'color'));

  const rgb = (color: string): [number, number, number, number] => {
    const hex = /^#([0-9a-f]{6})$/i.exec(color);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
    if (!fn) throw new Error(`colore non riconosciuto: ${color}`);
    return [+fn[1], +fn[2], +fn[3], fn[4] === undefined ? 1 : +fn[4]];
  };

  describe('.view-subtitle', () => {
    const body = () => {
      const found = rulesFor('.view-subtitle');
      expect(found).toHaveLength(1);
      return found[0].body;
    };

    it('e\' corsivo', () => {
      expect(prop(body(), 'font-style')).toBe('italic');
    });

    it('e\' azzurro scuro: il blu domina e non e\' chiaro', () => {
      const [r, g, b] = rgb(prop(body(), 'color')!);
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThan(110);
    });

    it('non e\' piu\' il grigio di prima', () => {
      expect(prop(body(), 'color')).not.toBe('#8c8c8c');
    });
  });

  describe('freccia e calendario', () => {
    const ARROW = '.ant-select:not(.ant-select-disabled) .ant-select-suffix';
    const CAL = '.ant-picker:not(.ant-picker-disabled) .ant-picker-suffix';

    it.each([
      ['freccia', ARROW],
      ['calendario', CAL],
    ])('%s abilitata in colore scuro e opaco', (_n, selector) => {
      const found = rulesFor(selector);
      expect(found).toHaveLength(1);
      const [r, g, b, a] = rgb(prop(found[0].body, 'color')!);
      expect(Math.max(r, g, b)).toBeLessThan(80);
      expect(a).toBeGreaterThanOrEqual(0.8);
    });

    it.each([
      ['.ant-select-suffix', ':not(.ant-select-disabled)'],
      ['.ant-picker-suffix', ':not(.ant-picker-disabled)'],
    ])('ogni regola di colore su %s esclude i disabilitati', (cls, guard) => {
      const found = mentioning(cls);
      expect(found.length).toBeGreaterThan(0);
      for (const r of found) {
        for (const s of r.selectors.filter((x: string) => x.includes(cls))) {
          expect(s).toContain(guard);
        }
      }
    });

    it('la regola non usa !important: i disabilitati restano ad antd', () => {
      for (const selector of [ARROW, CAL]) {
        expect(rulesFor(selector)[0].body).not.toContain('!important');
      }
    });
  });

  it('la casella not si stacca dal campo a sinistra, non a destra', () => {
    const found = rulesFor('.negation-box');
    expect(found).toHaveLength(1);
    expect(prop(found[0].body, 'margin-left')).toBe('4px');
    expect(prop(found[0].body, 'margin-right')).toBeUndefined();
  });
});
