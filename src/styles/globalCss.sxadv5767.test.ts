import { describe, it, expect } from 'vitest';

// SXADV-5767 - l'etichetta della sessione corrente si deve riconoscere a colpo
// d'occhio per sfondo, bordo e rilievo. Le schede sono le Tabs "editable-card" di
// Shell.tsx con className "session-tabs": lo stile di partenza viene da antd, che
// colpisce la scheda attiva con `.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab-active`
// (specificita' 0,3,0, a parita' decide l'ordine). Questi test leggono il foglio:
// dicono cosa dichiara, non come appare a schermo.

// Non `./global.css?raw`: vitest svuota ogni .css, query comprese (`css` non attivo),
// e i test passerebbero o cadrebbero su una stringa vuota. Si legge dal disco; il nome
// del modulo sta in una variabile perche' il tsconfig dell'app non ha i tipi di Node.
const fsModule = 'node:fs';
const { readFileSync } = await import(/* @vite-ignore */ fsModule);
const globalCss: string = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

function parseRules(css: string): Rule[] {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  for (const m of noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim());
    }
    for (const selector of m[1].split(',')) {
      rules.push({ selector: selector.trim().replace(/\s+/g, ' '), decls });
    }
  }
  return rules;
}

/** Classi e pseudo-classi contano uguale; ai fogli di queste schede non serve altro. */
function classCount(selector: string): number {
  return (selector.match(/\.[\w-]+|:(?!:)[\w-]+/g) ?? []).length;
}

const rules = parseRules(globalCss);
const sessionRules = rules.filter((r) => r.selector.includes('.session-tabs'));
// La scheda stessa, non i suoi figli (.ant-tabs-tab-btn, la X, ...).
const activeTabRules = sessionRules.filter((r) => /\.ant-tabs-tab-active$/.test(r.selector));
const allActiveRules = sessionRules.filter((r) => r.selector.includes('.ant-tabs-tab-active'));

function activeDecl(...props: string[]): string[] {
  return activeTabRules.flatMap((r) =>
    props.flatMap((p) => (r.decls.has(p) ? [r.decls.get(p) as string] : [])),
  );
}

describe('SXADV-5767: la scheda della sessione corrente', () => {
  it('ha una regola propria', () => {
    expect(activeTabRules.length).toBeGreaterThan(0);
  });

  it('dichiara uno sfondo', () => {
    expect(activeDecl('background', 'background-color').length).toBeGreaterThan(0);
  });

  it('dichiara un bordo del colore primario', () => {
    const borders = activeDecl(
      'border',
      'border-color',
      'border-top',
      'border-top-color',
    );
    expect(borders.some((v) => v.includes('var(--app-primary)'))).toBe(true);
  });

  it('dichiara un rilievo con box-shadow', () => {
    const shadows = activeDecl('box-shadow');
    expect(shadows.length).toBeGreaterThan(0);
    expect(shadows.every((v) => v !== 'none')).toBe(true);
  });

  it('ha selettori che non perdono contro lo stile card di antd', () => {
    expect(activeTabRules.length).toBeGreaterThan(0);
    for (const r of activeTabRules) {
      expect(r.selector).toContain('.session-tabs');
      expect(r.selector).toContain('.ant-tabs-card');
      expect(classCount(r.selector)).toBeGreaterThanOrEqual(3);
    }
  });

  it('non tocca font-weight, che cambierebbe la larghezza passando da una scheda all\'altra', () => {
    expect(allActiveRules.length).toBeGreaterThan(0);
    for (const r of allActiveRules) {
      expect(r.decls.has('font-weight'), r.selector).toBe(false);
    }
  });
});

// Difetti trovati in revisione. Misurati in Chrome su Tabs editable-card con global.css:
// con 3px sopra e 1px sugli altri lati la striscia passa da 24 a 26px, durante i 0,3s
// della transizione di antd scende a 25 (l'area sotto si muove di 1px a ogni cambio
// scheda) e il testo della scheda attiva sta 1px piu' in basso delle altre.
describe('SXADV-5767: difetti della regola', () => {
  it('lo spessore del bordo non cambia fra scheda attiva e inattive', () => {
    const widths = activeDecl('border', 'border-top', 'border-width', 'border-top-width')
      .flatMap((v) => v.match(/\d+(?:\.\d+)?px/g) ?? []);
    expect(widths.filter((w) => w !== '1px')).toEqual([]);
  });

  it('lo sfondo usa un token, non un colore scritto a mano (regola di tokens.css)', () => {
    for (const v of activeDecl('background', 'background-color')) {
      expect(v).toMatch(/var\(--app-/);
    }
  });
});

describe('SXADV-5767: il file global.css', () => {
  it('resta interamente CRLF', () => {
    expect(globalCss).toContain('.session-tabs');
    // Un LF senza CR davanti: anche uno solo sporca il diff del file.
    const bareLf = globalCss.split('\n').slice(0, -1).filter((l) => !l.endsWith('\r'));
    expect(bareLf).toEqual([]);
    expect(globalCss.includes('\r\n')).toBe(true);
  });
});
