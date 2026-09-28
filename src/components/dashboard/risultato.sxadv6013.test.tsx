import { describe, it, expect } from 'vitest';
import { prerender } from 'react-dom/static';
import { RisultatoVista } from './RisultatoWidget';
import { conteggio, scrivi, type Risultato, type Trasformazione } from './risultato';

// SXADV-6013: widget con raggruppamento → il parziale di ogni gruppo, e anche il
// totale generale. La prova rende il componente lato server e legge il markup.

async function html(risultato: Risultato, forma: string, trasformazione: Trasformazione | null) {
  const { prelude } = await prerender(
    <RisultatoVista risultato={risultato} forma={forma} trasformazione={trasformazione} opzioni={null} />,
  );
  return new Response(prelude).text();
}

const classi = (tag: string) => {
  const m = /\sclass="([^"]*)"/.exec(tag);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
};

/** Testo leggibile: via i tag e i commenti di React, entita' sciolte, spazi compattati. */
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

interface Li {
  classi: string[];
  interno: string;
}

/** Gli <li> del markup, con classi e contenuto (niente li annidati qui). */
const elementiLi = (h: string): Li[] =>
  [...h.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
    classi: classi(m[0].slice(0, m[0].indexOf('>') + 1)),
    interno: m[1],
  }));

/** Testo del primo elemento (senza figli) con la classe data, dentro s. */
const testoDiClasse = (s: string, cls: string): string | null => {
  for (const m of s.matchAll(/<([a-z]+)\b[^>]*>/g)) {
    if (!classi(m[0]).includes(cls)) continue;
    const da = m.index! + m[0].length;
    const chiusura = s.indexOf(`</${m[1]}>`, da);
    return testo(s.slice(da, chiusura < 0 ? undefined : chiusura));
  }
  return null;
};

const haClasse = (h: string, cls: string) =>
  [...h.matchAll(/<[a-z]+\b[^>]*>/g)].some((m) => classi(m[0]).includes(cls));

const parziali = (h: string) =>
  elementiLi(h).filter(
    (l) =>
      l.classi.includes('dash-parziale') &&
      !l.classi.includes('dash-parziale-altri') &&
      !l.classi.includes('dash-parziale-totale'),
  );
const totaleLi = (h: string) => elementiLi(h).filter((l) => l.classi.includes('dash-parziale-totale'));
const altriLi = (h: string) => elementiLi(h).filter((l) => l.classi.includes('dash-parziale-altri'));

const tSomma: Trasformazione = { group: ['cliente'], agg: 'sum', col: 'importo', outAgg: 'avg' };
const tConta: Trasformazione = { group: ['cliente'], agg: 'count', outAgg: 'count' };

const gruppi = [
  { k: 'Z', etichetta: 'Zeta', valore: 1234.5 },
  { k: 'A', etichetta: 'Alfa', valore: 10 },
  { k: 'M', valore: -7.25 },
  { k: '', etichetta: '', valore: 3 },
];

describe('SXADV-6013 kpi con raggruppamento: parziali', () => {
  it('un li per gruppo, nell\'ordine del server, etichetta e valore formattato (somma: 2 decimali)', async () => {
    const h = await html({ numero: 5, gruppi, completo: true }, 'kpi', tSomma);
    expect(haClasse(h, 'dash-parziali')).toBe(true);
    const li = parziali(h);
    expect(li.map((l) => testoDiClasse(l.interno, 'dash-parziale-etichetta'))).toEqual([
      'Zeta',
      'Alfa',
      'M',
      '(vuoto)',
    ]);
    const intero = conteggio(tSomma, true);
    expect(intero).toBe(false);
    expect(li.map((l) => testoDiClasse(l.interno, 'dash-parziale-valore'))).toEqual(
      gruppi.map((g) => scrivi(g.valore, intero)),
    );
    expect(testoDiClasse(li[0].interno, 'dash-parziale-valore')).toBe('1.234,50');
  });

  it('conteggio: valori interi con migliaia', async () => {
    const h = await html(
      { numero: 2, gruppi: [{ k: 'a', valore: 1234 }, { k: 'b', valore: 5 }], completo: true },
      'kpi',
      tConta,
    );
    const li = parziali(h);
    expect(li.map((l) => testoDiClasse(l.interno, 'dash-parziale-valore'))).toEqual(['1.234', '5']);
  });

  it('gruppo «altri» con N gruppi', async () => {
    const h = await html(
      { numero: 2, gruppi: [{ k: 'a', valore: 1 }], altri: { valore: 40, gruppi: 3 }, completo: true },
      'kpi',
      tConta,
    );
    const a = altriLi(h);
    expect(a).toHaveLength(1);
    expect(a[0].classi).toContain('dash-parziale');
    expect(testo(a[0].interno)).toContain('Altri (3 gruppi)');
    expect(testo(a[0].interno)).toContain('40');
  });

  it('«altri» con un gruppo solo: singolare', async () => {
    const h = await html(
      { numero: 2, gruppi: [{ k: 'a', valore: 1 }], altri: { valore: 4, gruppi: 1 }, completo: true },
      'kpi',
      tConta,
    );
    expect(testo(altriLi(h)[0].interno)).toContain('Altri (1 gruppo)');
  });

  it('«altri» senza valore numerico: nessuna riga altri', async () => {
    const h = await html(
      { numero: 2, gruppi: [{ k: 'a', valore: 1 }], altri: { valore: null, gruppi: 2 }, completo: true },
      'kpi',
      tConta,
    );
    expect(altriLi(h)).toHaveLength(0);
  });
});

describe('SXADV-6013 kpi con raggruppamento: totale', () => {
  it('totale presente e outAgg != sum → riga Totale formattata come i gruppi', async () => {
    const h = await html({ numero: 3, gruppi, totale: 1240.25, completo: true }, 'kpi', tSomma);
    const t = totaleLi(h);
    expect(t).toHaveLength(1);
    expect(testoDiClasse(t[0].interno, 'dash-parziale-etichetta')).toBe('Totale');
    const v = scrivi(1240.25, conteggio(tSomma, true));
    expect(testo(t[0].interno)).toContain(v);
    expect(testo(t[0].interno)).not.toContain('(parziale)');
  });

  it('totale di un conteggio: intero', async () => {
    const h = await html(
      { numero: 2, gruppi: [{ k: 'a', valore: 1000 }, { k: 'b', valore: 234 }], totale: 1234, completo: true },
      'kpi',
      tConta,
    );
    const t = totaleLi(h);
    expect(t).toHaveLength(1);
    expect(testo(t[0].interno)).toContain('1.234');
    expect(testo(t[0].interno)).not.toContain('1.234,00');
  });

  it('completo === false → valore seguito da « (parziale)»', async () => {
    const h = await html({ numero: 3, gruppi, totale: 1240.25, completo: false, righeLette: 10 }, 'kpi', tSomma);
    const t = totaleLi(h);
    expect(t).toHaveLength(1);
    const v = scrivi(1240.25, conteggio(tSomma, true));
    expect(testo(t[0].interno)).toContain(`${v} (parziale)`);
  });

  it('outAgg === sum → nessuna riga Totale (il numero grande e\' gia\' il totale)', async () => {
    const h = await html(
      { numero: 99, gruppi, totale: 99, completo: true },
      'kpi',
      { ...tSomma, outAgg: 'sum' },
    );
    expect(haClasse(h, 'dash-parziali')).toBe(true);
    expect(totaleLi(h)).toHaveLength(0);
    expect(haClasse(h, 'dash-parziale-totale')).toBe(false);
  });

  it.each([
    ['null', null],
    ['assente', undefined],
  ])('totale %s → nessuna riga Totale', async (_n, totale) => {
    const r: Risultato = { numero: 3, gruppi, completo: true };
    if (totale !== undefined) r.totale = totale;
    const h = await html(r, 'kpi', tSomma);
    expect(haClasse(h, 'dash-parziali')).toBe(true);
    expect(haClasse(h, 'dash-parziale-totale')).toBe(false);
  });
});

describe('SXADV-6013 kpi: quando non ci sono parziali', () => {
  it('kpi senza raggruppamento → niente dash-parziali', async () => {
    const h = await html(
      { numero: 7, gruppi: [{ k: 'a', valore: 7 }], totale: 7, completo: true },
      'kpi',
      { agg: 'count' },
    );
    expect(h).toContain('dash-numero');
    expect(haClasse(h, 'dash-parziali')).toBe(false);
    expect(haClasse(h, 'dash-parziale')).toBe(false);
  });

  it('kpi con group vuoto → niente dash-parziali', async () => {
    const h = await html({ numero: 7, gruppi, completo: true }, 'kpi', { group: [], agg: 'count' });
    expect(haClasse(h, 'dash-parziali')).toBe(false);
  });

  it('kpi con raggruppamento ma gruppi vuoti → niente dash-parziali', async () => {
    const h = await html({ numero: 0, gruppi: [], totale: 0, completo: true }, 'kpi', tSomma);
    expect(haClasse(h, 'dash-parziali')).toBe(false);
  });

  it('il numero grande resta', async () => {
    const h = await html({ numero: 42, gruppi, completo: true }, 'kpi', tConta);
    expect(testoDiClasse(h, 'dash-numero-valore')).toBe('42');
  });
});

describe('SXADV-6013 barre: totale', () => {
  it('totale presente → dash-barre-totale con «Totale» e valore intero (conteggio)', async () => {
    const h = await html(
      { gruppi: [{ k: 'a', valore: 1000 }, { k: 'b', valore: 234 }], totale: 1234, completo: true },
      'bar',
      tConta,
    );
    expect(haClasse(h, 'dash-barre-totale')).toBe(true);
    const t = testoDiClasse(h, 'dash-barre-totale')!;
    expect(t).toContain('Totale');
    expect(t).toContain('1.234');
    expect(t).not.toContain('1.234,00');
    expect(t).not.toContain('(parziale)');
    // barre invariate
    expect(elementiLi(h).filter((l) => l.classi.includes('dash-barra'))).toHaveLength(2);
  });

  it('somma: totale con due decimali', async () => {
    const h = await html(
      { gruppi: [{ k: 'a', valore: 1234.5 }], totale: 1234.5, completo: true },
      'bar',
      tSomma,
    );
    expect(testoDiClasse(h, 'dash-barre-totale')).toContain(scrivi(1234.5, conteggio(tSomma, true)));
    expect(testoDiClasse(h, 'dash-barre-totale')).toContain('1.234,50');
  });

  it('completo === false → « (parziale)» dopo il valore', async () => {
    const h = await html(
      { gruppi: [{ k: 'a', valore: 3 }], totale: 3, completo: false, righeLette: 10 },
      'bar',
      tConta,
    );
    expect(testo(h.slice(h.indexOf('dash-barre-totale')))).toContain('3 (parziale)');
  });

  it.each([
    ['null', null],
    ['assente', undefined],
  ])('totale %s → niente dash-barre-totale', async (_n, totale) => {
    const r: Risultato = { gruppi: [{ k: 'a', valore: 3 }], completo: true };
    if (totale !== undefined) r.totale = totale;
    const h = await html(r, 'bar', tConta);
    expect(haClasse(h, 'dash-barre-totale')).toBe(false);
    expect(elementiLi(h).filter((l) => l.classi.includes('dash-barra'))).toHaveLength(1);
  });
});

describe('SXADV-6013 errore e escape', () => {
  it.each(['kpi', 'bar'])('errore (%s) → niente parziali ne\' totale', async (forma) => {
    const h = await html(
      { errore: 'colonna sparita.', numero: 1, gruppi, totale: 9, completo: true },
      forma,
      tSomma,
    );
    expect(haClasse(h, 'dash-parziali')).toBe(false);
    expect(haClasse(h, 'dash-barre-totale')).toBe(false);
  });

  it('etichetta con markup resa come testo', async () => {
    const h = await html(
      { numero: 1, gruppi: [{ k: 'x', etichetta: '<b>x</b>', valore: 1 }], totale: 1, completo: true },
      'kpi',
      tSomma,
    );
    expect(h).not.toContain('<b>x</b>');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(testoDiClasse(parziali(h)[0].interno, 'dash-parziale-etichetta')).toBe('<b>x</b>');
  });
});
