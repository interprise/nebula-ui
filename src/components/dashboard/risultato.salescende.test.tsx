import { describe, it, expect } from 'vitest';
import { prerender } from 'react-dom/static';
import { RisultatoVista } from './RisultatoWidget';
import type { Risultato, Trasformazione } from './risultato';

// SXADV-62 F2 pezzo 5 — Sale/scende e gruppi esclusi (docs/sxadv-62-prove/SALESCENDE_contratto.md),
// la resa PURA del risultato: il tono del delta (S1, S2, S4) e la riga «senza: …» (E7).
// Scritta da chi non implementa, dal contratto: del componente si usano solo gli import e il modo
// di montarlo del test di SXADV-6013. Il componente si rende lato server e si legge il markup.

type Opzioni = Parameters<typeof RisultatoVista>[0]['opzioni'];

async function html(
  risultato: Risultato,
  forma: string,
  trasformazione: Trasformazione | null,
  opzioni: Record<string, unknown> | null,
) {
  const { prelude } = await prerender(
    <RisultatoVista
      risultato={risultato}
      forma={forma}
      trasformazione={trasformazione}
      opzioni={opzioni as unknown as Opzioni}
    />,
  );
  return new Response(prelude).text();
}

const classi = (tag: string) => {
  const m = /\sclass="([^"]*)"/.exec(tag);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
};

const attributo = (tag: string, nome: string) => {
  const m = new RegExp(`\\s${nome}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

const testo = (s: string) =>
  s
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface Elemento {
  tag: string;
  classi: string[];
  /** Il markup dentro l'elemento (fino alla chiusura dello stesso tag, annidamenti compresi). */
  interno: string;
  /** Posizione nel markup. */
  da: number;
}

/** Il primo elemento con la classe data (con il suo contenuto, annidamenti dello stesso tag compresi). */
function elemento(h: string, cls: string): Elemento | null {
  for (const m of h.matchAll(/<([a-z][a-z0-9]*)\b[^>]*>/g)) {
    if (!classi(m[0]).includes(cls)) continue;
    const nome = m[1];
    const inizio = m.index! + m[0].length;
    if (m[0].endsWith('/>')) return { tag: m[0], classi: classi(m[0]), interno: '', da: m.index! };
    const re = new RegExp(`<${nome}\\b[^>]*>|</${nome}>`, 'g');
    re.lastIndex = inizio;
    let livello = 1;
    let fine = h.length;
    for (let x = re.exec(h); x; x = re.exec(h)) {
      if (x[0].startsWith('</')) livello--;
      else if (!x[0].endsWith('/>')) livello++;
      if (livello === 0) {
        fine = x.index;
        break;
      }
    }
    return { tag: m[0], classi: classi(m[0]), interno: h.slice(inizio, fine), da: m.index! };
  }
  return null;
}

const haClasse = (h: string, cls: string) =>
  [...h.matchAll(/<[a-z][a-z0-9]*\b[^>]*>/g)].some((m) => classi(m[0]).includes(cls));

/** La freccia del delta: un carattere-freccia nel testo, o un'icona/svg, o un nome accessibile. */
const haFreccia = (e: Elemento) =>
  /[↑↓▲▼⬆⬇⇧⇩⏶⏷↗↘→↔=＝]/u.test(testo(e.interno)) ||
  /anticon-(arrow|caret|rise|fall|minus)|<svg\b/.test(e.interno) ||
  /aria-label="[^"]*(sale|scende|uguale|invariat)/i.test(e.tag + e.interno);

/** Il numero col segno: «+3», «−1.234,50» (meno tipografico o trattino). */
const numeroColSegno = (e: Elemento, assoluto: string, segno: '+' | '-') => {
  const t = testo(e.interno).replace(/\s+/g, '');
  const s = segno === '+' ? '\\+' : '[-−–]';
  return new RegExp(`${s}${assoluto.replace(/\./g, '\\.')}`).test(t);
};

type Tono = 'bene' | 'attenzione' | 'neutro';
const CLASSE: Record<Tono, string> = {
  bene: 'dash-tono-bene',
  attenzione: 'dash-tono-male',
  neutro: 'dash-tono-neutro',
};

const tKpi: Trasformazione = { agg: 'count' };
const ris = (over: Partial<Risultato> & Record<string, unknown>): Risultato =>
  ({ numero: 57, gruppi: [{ k: '', etichetta: '', valore: 57 }], completo: true, ...over }) as Risultato;

async function delta(d: number | null, opzioni: Record<string, unknown> | null) {
  const h = await html(ris({ delta: d }), 'kpi', tKpi, opzioni);
  return { h, e: elemento(h, 'dash-numero-delta') };
}

// ─── S1/S2: il valore risolto ─────────────────────────────────────────────
// Oracolo scritto qui dal contratto: «male» vale «attenzione»; sale assente o vuoto = neutro;
// scende assente o vuoto = l'opposto di sale (bene <-> attenzione, neutro resta neutro).
const risolvi = (v: unknown): Tono | null => {
  if (v === 'male') return 'attenzione';
  if (v === 'bene' || v === 'attenzione' || v === 'neutro') return v;
  return null;
};
const opposto = (t: Tono): Tono => (t === 'bene' ? 'attenzione' : t === 'attenzione' ? 'bene' : 'neutro');
const toni = (o: Record<string, unknown> | null) => {
  const sale = risolvi(o?.sale) ?? 'neutro';
  const scende = risolvi(o?.scende) ?? opposto(sale);
  return { sale, scende };
};

const VALORI_SALE: Array<[string, unknown]> = [
  ['assente', undefined],
  ['""', ''],
  ['null', null],
  ['bene', 'bene'],
  ['attenzione', 'attenzione'],
  ['neutro', 'neutro'],
  ['male', 'male'],
];
const VALORI_SCENDE = VALORI_SALE;

const opz = (sale: unknown, scende: unknown): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  if (sale !== undefined) o.sale = sale;
  if (scende !== undefined) o.scende = scende;
  return o;
};

const COMBINAZIONI = VALORI_SALE.flatMap(([ns, sa]) =>
  VALORI_SCENDE.map(([nd, sc]) => [ns, nd, opz(sa, sc)] as [string, string, Record<string, unknown>]),
);

describe('S4: il tono del delta segue sale/scende risolti (S1, S2)', () => {
  it.each(COMBINAZIONI)('sale %s, scende %s: delta > 0 -> tono di sale', async (_s, _d, o) => {
    const { e } = await delta(3, o);
    expect(e, 'manca .dash-numero-delta').not.toBeNull();
    const atteso = toni(o).sale;
    expect(attributo(e!.tag, 'data-tono')).toBe(atteso);
    expect(e!.classi).toContain(CLASSE[atteso]);
    for (const altra of Object.values(CLASSE).filter((c) => c !== CLASSE[atteso]))
      expect(e!.classi).not.toContain(altra);
  });

  it.each(COMBINAZIONI)('sale %s, scende %s: delta < 0 -> tono di scende', async (_s, _d, o) => {
    const { e } = await delta(-1234.5, o);
    expect(e, 'manca .dash-numero-delta').not.toBeNull();
    const atteso = toni(o).scende;
    expect(attributo(e!.tag, 'data-tono')).toBe(atteso);
    expect(e!.classi).toContain(CLASSE[atteso]);
    for (const altra of Object.values(CLASSE).filter((c) => c !== CLASSE[atteso]))
      expect(e!.classi).not.toContain(altra);
  });

  it.each(COMBINAZIONI)('sale %s, scende %s: delta 0 -> neutro', async (_s, _d, o) => {
    const { e } = await delta(0, o);
    expect(e, 'con delta 0 il delta si mostra (freccia «uguale»)').not.toBeNull();
    expect(attributo(e!.tag, 'data-tono')).toBe('neutro');
    expect(e!.classi).toContain('dash-tono-neutro');
    expect(e!.classi).not.toContain('dash-tono-bene');
    expect(e!.classi).not.toContain('dash-tono-male');
  });

  it('opzioni null: salita e discesa neutre (i widget gia salvati senza sale non cambiano aspetto)', async () => {
    for (const d of [5, -5]) {
      const { e } = await delta(d, null);
      expect(attributo(e!.tag, 'data-tono')).toBe('neutro');
      expect(e!.classi).toContain('dash-tono-neutro');
    }
  });

  it('il caso storico: sale «bene» senza scende colora la discesa «attenzione» (dash-tono-male)', async () => {
    const { e } = await delta(-2, { sale: 'bene' });
    expect(attributo(e!.tag, 'data-tono')).toBe('attenzione');
    expect(e!.classi).toContain('dash-tono-male');
  });

  it('il caso storico: sale «male» senza scende colora la salita «attenzione» e la discesa «bene»', async () => {
    const su = (await delta(2, { sale: 'male' })).e!;
    const giu = (await delta(-2, { sale: 'male' })).e!;
    expect([attributo(su.tag, 'data-tono'), attributo(giu.tag, 'data-tono')]).toEqual(['attenzione', 'bene']);
    expect(su.classi).toContain('dash-tono-male');
    expect(giu.classi).toContain('dash-tono-bene');
  });

  it('scende «male» vale «attenzione» anche lui', async () => {
    const { e } = await delta(-2, { sale: 'attenzione', scende: 'male' });
    expect(attributo(e!.tag, 'data-tono')).toBe('attenzione');
  });

  it('sale e scende uguali: due buone notizie restano due buone notizie', async () => {
    const o = { sale: 'bene', scende: 'bene' };
    expect(attributo((await delta(1, o)).e!.tag, 'data-tono')).toBe('bene');
    expect(attributo((await delta(-1, o)).e!.tag, 'data-tono')).toBe('bene');
  });

  it('delta null: nessun delta, quindi nessun tono', async () => {
    const { h, e } = await delta(null, { sale: 'bene', scende: 'attenzione' });
    expect(e).toBeNull();
    expect(h).not.toMatch(/data-tono="(bene|attenzione)"/);
  });
});

describe('S4: freccia e numero col segno ci sono sempre, qualunque tono', () => {
  const casi: Array<[string, number, Record<string, unknown> | null, string, '+' | '-']> = [
    ['salita neutra', 3, null, '3', '+'],
    ['salita bene', 3, { sale: 'bene' }, '3', '+'],
    ['salita attenzione', 3, { sale: 'attenzione' }, '3', '+'],
    ['discesa neutra', -1234, { sale: 'neutro' }, '1.234', '-'],
    ['discesa bene', -1234, { sale: 'attenzione' }, '1.234', '-'],
    ['discesa attenzione', -1234, { sale: 'bene' }, '1.234', '-'],
  ];
  it.each(casi)('%s', async (_n, d, o, assoluto, segno) => {
    const { e } = await delta(d, o);
    expect(e).not.toBeNull();
    expect(haFreccia(e!), `nessuna freccia in ${e!.interno}`).toBe(true);
    expect(numeroColSegno(e!, assoluto, segno), `numero col segno assente in «${testo(e!.interno)}»`).toBe(true);
  });

  it('delta 0: freccia anche col tono neutro', async () => {
    const { e } = await delta(0, { sale: 'bene' });
    expect(haFreccia(e!)).toBe(true);
  });
});

// ─── E7: la riga «senza: …» ─────────────────────────────────────────────
const tGruppi: Trasformazione = { group: ['sede'], agg: 'count', outAgg: 'count' };
const gruppi = [
  { k: '001', etichetta: 'Milano', valore: 4, righe: 4 },
  { k: '002', etichetta: 'Roma', valore: 2, righe: 2 },
];

describe('E7: la riga .dash-esclusi', () => {
  it.each(['kpi', 'bar'])('%s: «senza: » e le etichette separate da «, », nell\'ordine', async (forma) => {
    const h = await html(
      ris({
        numero: 2,
        gruppi,
        esclusi: [
          { k: '000', etichetta: 'Sede centrale', righe: 7 },
          { k: '009', etichetta: 'Torino', righe: 1 },
        ],
      }),
      forma,
      tGruppi,
      null,
    );
    const e = elemento(h, 'dash-esclusi');
    expect(e, 'manca .dash-esclusi').not.toBeNull();
    expect(testo(e!.interno)).toBe('senza: Sede centrale, Torino');
  });

  it('etichetta null -> la chiave; gruppo vuoto -> «(vuoto)»', async () => {
    const h = await html(
      ris({
        numero: 2,
        gruppi,
        esclusi: [
          { k: 'X99', etichetta: null, righe: 0 },
          { k: '', etichetta: '', righe: 3 },
          { k: '', etichetta: null, righe: 0 },
        ],
      }),
      'kpi',
      tGruppi,
      null,
    );
    expect(testo(elemento(h, 'dash-esclusi')!.interno)).toBe('senza: X99, (vuoto), (vuoto)');
  });

  it('sta sopra il numero', async () => {
    const h = await html(
      ris({ numero: 2, gruppi, esclusi: [{ k: '000', etichetta: 'Sede centrale', righe: 7 }] }),
      'kpi',
      tGruppi,
      null,
    );
    const e = elemento(h, 'dash-esclusi');
    const n = elemento(h, 'dash-numero-valore') ?? elemento(h, 'dash-numero');
    expect(e && n).toBeTruthy();
    expect(e!.da).toBeLessThan(n!.da);
  });

  it('sta sopra le barre', async () => {
    const h = await html(
      ris({ numero: null, gruppi, esclusi: [{ k: '000', etichetta: 'Sede centrale', righe: 7 }] }),
      'bar',
      tGruppi,
      null,
    );
    const e = elemento(h, 'dash-esclusi');
    const b = elemento(h, 'dash-barra');
    expect(e && b).toBeTruthy();
    expect(e!.da).toBeLessThan(b!.da);
  });

  it('l\'etichetta con markup resta testo', async () => {
    const h = await html(
      ris({ numero: 2, gruppi, esclusi: [{ k: 'x', etichetta: '<b>x</b>', righe: 1 }] }),
      'kpi',
      tGruppi,
      null,
    );
    expect(h).not.toContain('<b>x</b>');
    expect(testo(elemento(h, 'dash-esclusi')!.interno)).toBe('senza: <b>x</b>');
  });

  it.each([
    ['esclusi assente', undefined],
    ['esclusi []', []],
  ])('%s: niente riga', async (_n, esclusi) => {
    const r = ris({ numero: 2, gruppi });
    if (esclusi !== undefined) (r as Record<string, unknown>).esclusi = esclusi;
    for (const forma of ['kpi', 'bar']) expect(haClasse(await html(r, forma, tGruppi, null), 'dash-esclusi')).toBe(false);
  });

  it.each(['kpi', 'bar'])('%s con un risultato in errore: niente riga', async (forma) => {
    const h = await html(
      ris({ errore: 'colonna sparita.', numero: null, gruppi, esclusi: [{ k: '000', etichetta: 'Sede centrale', righe: 7 }] }),
      forma,
      tGruppi,
      null,
    );
    expect(haClasse(h, 'dash-esclusi')).toBe(false);
  });

  it('forma lista: mai', async () => {
    const h = await html(
      ris({ numero: 2, gruppi, esclusi: [{ k: '000', etichetta: 'Sede centrale', righe: 7 }] }),
      'list',
      tGruppi,
      null,
    );
    expect(haClasse(h, 'dash-esclusi')).toBe(false);
  });
});
