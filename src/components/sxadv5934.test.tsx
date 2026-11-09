import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIControl } from '../types/ui';
import { LONG_PROMPT_WIDTH, promptFitWidth, solvePromptBand } from './promptBand';
import { emptyCellTakesEdit } from './listEditSpread';

// SXADV-5934 — tre punti della maschera:
//  .0 un'etichetta lunga non allarga la banda dei prompt di tutta la maschera;
//  .1 una cella senza control su una riga in modifica non diventa modificabile;
//  .2 HtmlControl applica contentStyle/contentClass e continua a filtrare l'HTML.
//
// Niente DOM (DOMParser assente): il filtro vero non gira. Al suo posto un finto
// che toglie <script> e gli on*; si verifica anche che la chiamata usi
// HTML_POLICY.content, che e' la parte di cui HtmlControl risponde.

const calls: Array<{ html: string; policy: unknown }> = [];
vi.mock('../services/serverHtml', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/serverHtml')>();
  const fakeSanitize = (html: string) => html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return {
    ...real,
    serverHtml: (html: string, policy: unknown) => {
      calls.push({ html, policy });
      return real.fixServerHtml(fakeSanitize(html));
    },
  };
});

const { HTML_POLICY } = await import('../services/serverHtml');
const { HtmlControl, HtmlFormatControl } = await import('../controls/builtins/DisplayControls');

const source = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

/** Come measurePromptWidth di ViewRenderer (non esportata): i tag e &nbsp; valgono
 *  uno spazio, gli estremi non contano; 10px a carattere rendono i conti leggibili. */
const measure = (s: string) =>
  s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim().length * 10;
const fit = (s: string) => promptFitWidth(s, measure);
const parola = (n: number, c = 'a') => c.repeat(n);

describe('promptFitWidth — etichetta corta: misurata intera', () => {
  it('la soglia e\' 220', () => {
    expect(LONG_PROMPT_WIDTH).toBe(220);
  });

  it('sotto soglia: la larghezza intera, anche se potrebbe andare a capo', () => {
    expect(fit('Data di scadenza')).toBe(160);
  });

  it('esattamente sulla soglia: ancora intera', () => {
    const testo = `${parola(10)} ${parola(11)}`; // 22 caratteri
    expect(measure(testo)).toBe(220);
    expect(fit(testo)).toBe(220);
  });

  it('un\'etichetta corta non viene nemmeno spezzata: una sola misura', () => {
    const m = vi.fn(measure);
    promptFitWidth('Data di scadenza', m);
    expect(m).toHaveBeenCalledTimes(1);
  });
});

describe('promptFitWidth — etichetta lunga: misurata su due righe', () => {
  it('due parole uguali: meta\' della larghezza intera', () => {
    const testo = `${parola(30)} ${parola(30, 'b')}`; // 610
    expect(fit(testo)).toBe(300);
  });

  it('piu\' parole: la spezzatura piu\' equilibrata, non la prima', () => {
    const testo = Array.from({ length: 6 }, () => parola(10)).join(' '); // 650
    expect(fit(testo)).toBe(320); // 3 parole + 3 parole: 32 caratteri per riga
  });

  it('parole sbilanciate: decide la riga piu\' lunga', () => {
    expect(fit(`${parola(40)} ${parola(3, 'b')} ${parola(3, 'c')}`)).toBe(400);
  });

  it('appena oltre la soglia: non scende sotto la soglia anche se due righe basterebbero', () => {
    const testo = `${parola(11)} ${parola(11, 'b')}`; // 230, su due righe 110
    expect(fit(testo)).toBe(LONG_PROMPT_WIDTH);
  });

  it('la riga piu\' lunga sopra la soglia vince sul pavimento', () => {
    expect(fit(`${parola(25)} b`)).toBe(250);
  });

  it('tiene conto solo delle spezzature: spazi multipli, tab, a capo ed estremi', () => {
    const pulito = fit(`${parola(30)} ${parola(30, 'b')}`);
    expect(fit(`  ${parola(30)}   ${parola(30, 'b')}  `)).toBe(pulito);
    expect(fit(`${parola(30)}\t${parola(30, 'b')}`)).toBe(pulito);
    expect(fit(`${parola(30)}\n${parola(30, 'b')}`)).toBe(pulito);
  });
});

describe('promptFitWidth — non spezzabile, vuoto', () => {
  it('una parola sola lunghissima resta intera: non ha dove andare a capo', () => {
    expect(fit(parola(80))).toBe(800);
  });

  it('una parola lunghissima con parole brevi: su due righe una delle brevi le sta accanto', () => {
    expect(fit(`da ${parola(80)} a`)).toBe(820); // "da" | "aaa... a"
  });

  it('&nbsp; non e\' un punto di spezzatura', () => {
    expect(fit(`${parola(30)}&nbsp;${parola(30, 'b')}`)).toBe(610);
  });

  // DIFETTO: /\s/ di JavaScript comprende U+00A0, il browser li' non va a capo.
  it('U+00A0 letterale non e\' un punto di spezzatura', () => {
    expect(promptFitWidth(`${parola(30)} ${parola(30, 'b')}`, (s) => s.length * 10)).toBe(610);
  });

  it('testo vuoto, di soli spazi, di soli tag: zero', () => {
    expect(fit('')).toBe(0);
    expect(fit('     ')).toBe(0);
    expect(fit('<img src="images/icons/x.png" alt="due parole">')).toBe(0);
  });
});

describe('promptFitWidth — HTML nell\'etichetta (first.prompt e\' HTML del server)', () => {
  it('tag con attributi: stessa misura del testo nudo', () => {
    const nudo = `${parola(30)} ${parola(30, 'b')}`;
    expect(fit(`<font color="red" size="2">${nudo}</font>`)).toBe(fit(nudo));
    expect(fit(`<span class="a b" title="c d e">${nudo}</span>`)).toBe(fit(nudo));
  });

  it('un tag non sposta la misura sotto la parola piu\' lunga visibile', () => {
    expect(fit(`da <b class="x y">${parola(50)}</b>`)).toBeGreaterThanOrEqual(500);
  });

  it('icona in testa: conta il testo, non gli attributi', () => {
    const nudo = `${parola(30)} ${parola(30, 'b')}`;
    expect(fit(`<img src="images/icons/a.png" alt="una icona"> ${nudo}`)).toBe(300);
  });

  // DIFETTO: <br> vale uno spazio per la misura, ma non e' un punto di spezzatura:
  // l'etichetta che il browser dispone gia' su due righe da 300px pretende 610.
  it('<br> esplicito: la banda basta alla riga piu\' lunga', () => {
    expect(fit(`${parola(30)}<br>${parola(30, 'b')}`)).toBe(300);
  });
});

describe('promptFitWidth — monotonia e limiti', () => {
  const campioni = [
    '', 'a', 'Data', parola(22), parola(23), `${parola(11)} ${parola(11)}`,
    `${parola(25)} b`, `a ${parola(25)}`, parola(200),
    Array.from({ length: 12 }, (_, i) => parola(i + 1)).join(' '),
    'Importo totale delle ritenute di acconto versate nel periodo di riferimento',
  ];

  it.each(campioni)('mai oltre la larghezza intera, mai sotto la parola piu\' lunga: %j', (t) => {
    const f = fit(t);
    const parolaMax = Math.max(0, ...t.trim().split(/\s+/).map(measure));
    expect(f).toBeLessThanOrEqual(measure(t));
    expect(f).toBeGreaterThanOrEqual(parolaMax);
    expect(f).toBeGreaterThanOrEqual(Math.min(measure(t), LONG_PROMPT_WIDTH));
  });

  it('allungare il testo a parole non restringe mai la banda', () => {
    const parole = 'Importo totale delle ritenute di acconto versate nel periodo di riferimento dell esercizio contabile'.split(' ');
    let prec = 0;
    for (let n = 1; n <= parole.length; n++) {
      const f = fit(parole.slice(0, n).join(' '));
      expect(f).toBeGreaterThanOrEqual(prec);
      prec = f;
    }
  });

  it('attraversare la soglia non fa salti indietro', () => {
    let prec = 0;
    for (let n = 15; n <= 60; n++) {
      const f = fit(`${parola(Math.floor(n / 2))} ${parola(Math.ceil(n / 2), 'b')}`);
      expect(f).toBeGreaterThanOrEqual(prec);
      prec = f;
    }
  });

  it('un corpo piu\' grande non restringe mai la banda', () => {
    const testo = 'Importo totale delle ritenute di acconto versate nel periodo';
    let prec = 0;
    for (const k of [4, 5, 6, 7, 8, 10, 12, 14]) {
      const f = promptFitWidth(testo, (s) => s.trim().length * k);
      expect(f).toBeGreaterThanOrEqual(prec);
      prec = f;
    }
  });
});

describe('promptFitWidth — nella banda della maschera', () => {
  const lunga = `${parola(30)} ${parola(30, 'b')}`;
  const padding = 10;
  const banda = (labels: string[]) => solvePromptBand(
    labels.map((l) => ({ span: 2, width: fit(l) + padding })),
    () => 40,
    20,
  );

  it('una sola etichetta lunga non porta la banda alla sua larghezza intera', () => {
    const { width } = banda(['Data', 'Numero', lunga]);
    expect(width).toBe(310);
    expect(width).toBeLessThan(measure(lunga));
  });

  it('senza etichette lunghe la banda e\' quella di prima', () => {
    expect(banda(['Data', 'Numero documento']).width).toBe(170);
  });

  it('ViewRenderer misura le etichette della banda con promptFitWidth', () => {
    const src = source('./ViewRenderer.tsx');
    expect(src).toMatch(/import\s*\{[^}]*\bpromptFitWidth\b[^}]*\}\s*from\s*'\.\/promptBand'/);
    expect(src).toMatch(/width:\s*first\.prompt\s*\?\s*promptFitWidth\(first\.prompt,\s*\(\w+\)\s*=>\s*measurePromptWidth\(\w+,\s*font\)\)\s*\+\s*PROMPT_CELL_PADDING/);
    // nessun'altra strada: l'unica misura resta quella dentro promptFitWidth
    expect(src.match(/measurePromptWidth\(/g)).toHaveLength(1);
  });

  it('la cella dell\'etichetta puo\' davvero andare a capo', () => {
    const css = source('../styles/global.css');
    const regola = /\.prompt-cell\s*\{([^}]*)\}/.exec(css);
    expect(regola).not.toBeNull();
    expect(regola![1]).not.toMatch(/white-space\s*:\s*(nowrap|pre)\b/);
  });
});

describe('emptyCellTakesEdit', () => {
  const control = { name: 'importo' };

  it.each([undefined, ''])('cella con control e valore assente/vuoto (%j): si', (value) => {
    expect(emptyCellTakesEdit({ control }, value)).toBe(true);
  });

  it.each([
    0, false, 'x', ' ', '0', true, 1, [], {},
  ])('cella con control e valore presente (%j): no', (value) => {
    expect(emptyCellTakesEdit({ control }, value)).toBe(false);
  });

  it.each([
    undefined, '', 0, false, 'x',
  ])('cella senza control (campo invisibile sul record), valore %j: mai', (value) => {
    expect(emptyCellTakesEdit({}, value)).toBe(false);
    expect(emptyCellTakesEdit({ control: undefined }, value)).toBe(false);
    expect(emptyCellTakesEdit({ control: null }, value)).toBe(false);
  });

  it('cella inesistente nella riga: mai', () => {
    expect(emptyCellTakesEdit(undefined, undefined)).toBe(false);
    expect(emptyCellTakesEdit(undefined, '')).toBe(false);
  });

  it('un control anche minimo basta', () => {
    expect(emptyCellTakesEdit({ control: {} }, undefined)).toBe(true);
  });

  it('torna sempre un booleano vero', () => {
    expect(emptyCellTakesEdit({}, undefined)).toBe(false);
    expect(emptyCellTakesEdit(undefined, undefined)).toBe(false);
  });

  it('ListRenderer decide con la funzione, sulla cella e sul valore della stessa colonna', () => {
    const src = source('./ListRenderer.tsx');
    expect(src).toMatch(/import\s*\{\s*emptyCellTakesEdit\s*\}\s*from\s*'\.\/listEditSpread'/);
    expect(src).toMatch(/if\s*\(emptyCellTakesEdit\(row\.cells\[ci\],\s*rowObj\[`col_\$\{ci\}`\]\)\)\s*\{\s*rowObj\[`_editable_\$\{ci\}`\]\s*=\s*true;/);
    expect(src).not.toMatch(/cellVal\s*===\s*undefined/);
  });
});

describe('HtmlControl', () => {
  beforeEach(() => { calls.length = 0; });

  const render = (Comp: typeof HtmlControl, control: Partial<UIControl>): string =>
    renderToStaticMarkup(
      <Comp control={{ name: 'saldo.S1-0', id: 'saldo', ...control } as UIControl} onAction={() => {}} onChange={() => {}} />,
    );
  /** Gli attributi del <span> esterno. */
  const spanAttrs = (html: string) => /^<span([^>]*)>/.exec(html)?.[1] ?? '';

  it('applica contentStyle come stile, a blocco: l\'allineamento ha su cosa agire', () => {
    const attrs = spanAttrs(render(HtmlControl, { value: '1.234,56', style: 'text-align:right;' }));
    expect(attrs).toMatch(/text-align:\s*right/);
    expect(attrs).toMatch(/display:\s*block/);
    expect(attrs).toMatch(/width:\s*100%/);
  });

  it('applica contentClass, a blocco anche senza stile', () => {
    const attrs = spanAttrs(render(HtmlControl, { value: 'x', cls: 'section_header' }));
    expect(attrs).toMatch(/class="section_header"/);
    expect(attrs).toMatch(/display:\s*block/);
  });

  it('classe e stile insieme', () => {
    const attrs = spanAttrs(render(HtmlControl, { value: 'x', cls: 'c1 c2', style: 'color:red;text-align:right' }));
    expect(attrs).toMatch(/class="c1 c2"/);
    expect(attrs).toMatch(/color:\s*red/);
    expect(attrs).toMatch(/text-align:\s*right/);
  });

  it('senza stile ne\' classe resta in linea', () => {
    const html = render(HtmlControl, { value: 'testo' });
    expect(html).toMatch(/^<span/);
    expect(spanAttrs(html)).not.toMatch(/display|width/);
    expect(html).toContain('>testo</span>');
  });

  it('come HtmlFormatControl: stesso markup a parita\' di control', () => {
    for (const c of [
      { value: 'a' },
      { value: 'a', style: 'text-align:right;' },
      { value: '<b>a</b>', cls: 'x', style: 'color:red' },
    ] as Partial<UIControl>[]) {
      expect(render(HtmlControl, c)).toBe(render(HtmlFormatControl, c));
    }
  });

  it('passa dal filtro con la politica content', () => {
    render(HtmlControl, { value: '<b>x</b>', style: 'text-align:right;' });
    expect(calls).toHaveLength(1);
    expect(calls[0].html).toBe('<b>x</b>');
    expect(calls[0].policy).toBe(HTML_POLICY.content);
  });

  it('niente script, con o senza stile', () => {
    for (const style of [undefined, 'text-align:right;']) {
      const html = render(HtmlControl, {
        value: '<script>alert(1)</script><img src="x.png" onerror="alert(2)"><b>saldo</b>',
        style,
      });
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/onerror/i);
      expect(html).toContain('<b>saldo</b>');
    }
  });

  it('l\'HTML ammesso resta markup e i percorsi images/ tornano alla base del legacy', () => {
    const html = render(HtmlControl, { value: '<img src="images/icons/a.png"><table><tr><td>1</td></tr></table>' });
    expect(html).toContain('src="/entrasp/images/icons/a.png"');
    expect(html).toContain('<td>1</td>');
  });

  it('valore assente: span vuoto, nessun "undefined"', () => {
    const html = render(HtmlControl, { value: undefined, style: 'text-align:right;' });
    expect(html).not.toContain('undefined');
    expect(html).toMatch(/<\/span>$/);
  });

  it('il tipo html del registro e\' HtmlControl', () => {
    expect(source('../controls/builtins/index.ts')).toMatch(/\bhtml:\s*HtmlControl\b/);
  });
});
