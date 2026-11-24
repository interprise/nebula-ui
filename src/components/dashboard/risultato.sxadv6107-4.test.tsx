// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { prerender } from 'react-dom/static';
import { RisultatoVista } from './RisultatoWidget';
import * as R from './risultato';
import type { Risultato, Trasformazione } from './risultato';

// SXADV-6107.4: sopra l'elenco dei gruppi (Numero) e sopra le barre, le intestazioni di colonna:
// a sinistra cosa raggruppa («Raggruppa per»), a destra il calcolo per gruppo («Calcola»).
// Caso della tester: Raggruppa per = Totale doc., Calcola = Conteggio -> «Totale doc. | N. righe».
// Chi prova non e' chi implementa: scritti sul contratto, non sul codice.

type Colonne = Array<{ item?: string; etichetta?: string }>;
// Import per namespace: se la funzione manca, i test falliscono uno per uno invece di rompere il file.
const intestazione = (t: unknown, colonne?: Colonne | null) =>
  (R as unknown as {
    intestazioneDeiGruppi: (t: unknown, c?: Colonne | null) => { gruppo: string; valore: string } | null;
  }).intestazioneDeiGruppi(t, colonne);

const tr = (o: Record<string, unknown>) => o as unknown as Trasformazione;
const COLONNE: Colonne = [
  { item: 'totDoc', etichetta: 'Totale doc.' },
  { item: 'sede', etichetta: 'Sede' },
  { item: 'dataDoc', etichetta: 'Data doc.' },
  { item: 'cliente', etichetta: 'Cliente' },
];

async function html(r: Risultato, forma: string, t: Trasformazione | null, colonne: Colonne | null = COLONNE) {
  const { prelude } = await prerender(
    <RisultatoVista risultato={r} forma={forma} trasformazione={t} opzioni={null} colonne={colonne} />,
  );
  return new Response(prelude).text();
}
const testo = (s: string) =>
  s.replace(/<!--.*?-->/g, '').replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** Le <li> dentro <ul class="dash-parziali">, come HTML grezzo; null se l'elenco non c'e'. */
const vociParziali = (h: string): string[] | null => {
  const m = /<ul class="dash-parziali"[^>]*>([\s\S]*?)<\/ul>/.exec(h);
  if (!m) return null;
  return [...m[1].matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)].map((x) => x[0]);
};
/** Testo di uno span di classe esatta dentro un frammento. */
const span = (frammento: string, cls: string) => {
  const m = new RegExp(`<span class="${cls}"[^>]*>([\\s\\S]*?)</span>`).exec(frammento);
  return m ? m[1] : null;
};
/** L'intestazione dei gruppi (forma Numero): il div subito prima di <ul class="dash-parziali">. */
const intestazioneParziali = (h: string) => {
  const m = /<div class="dash-parziali-intestazione"[^>]*>([\s\S]*?)<\/div>/.exec(h);
  return m ? m[1] : null;
};
/** Il div di intestazione e' seguito direttamente dalla <ul class="dash-parziali">. */
const subitoPrimaDellElenco = (h: string) =>
  /<div class="dash-parziali-intestazione"[^>]*>(?:(?!<\/div>)[\s\S])*<\/div>\s*(?:<!--[^>]*-->\s*)*<ul class="dash-parziali"/.test(h);
const intestazioneBarre = (h: string) => {
  const m = /<div class="dash-barre-intestazione"[^>]*>([\s\S]*?)<\/div>/.exec(h);
  return m ? m[1] : null;
};
const spans = (frammento: string) =>
  [...frammento.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/g)].map((x) => testo(x[1]));

const gruppi = [
  { k: '1220', etichetta: '1.220,00 €', valore: 2 },
  { k: '0', etichetta: '0,00 €', valore: 1 },
];

describe('SXADV-6107.4 intestazioneDeiGruppi: quando non raggruppa', () => {
  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['senza group', { agg: 'count' }],
    ['group []', { group: [], agg: 'count' }],
    ['group [""]', { group: [''] }],
    ['group ["  "]', { group: ['  '] }],
    ['group [null]', { group: [null] }],
    ['group [5]', { group: [5] }],
    ['group 5', { group: 5 }],
    ['group true', { group: true }],
    ['group {}', { group: {} }],
    ['group ""', { group: '' }],
    ['group "   "', { group: '   ' }],
    ['group null', { group: null }],
  ])('%s: null, senza lanciare', (_n, t) => {
    expect(() => intestazione(t, COLONNE)).not.toThrow();
    expect(intestazione(t, COLONNE)).toBeNull();
  });
});

describe('SXADV-6107.4 intestazioneDeiGruppi: la colonna «gruppo»', () => {
  it('caso della tester: Totale doc. | N. righe', () => {
    expect(intestazione({ group: ['totDoc'], agg: 'count' }, COLONNE)).toEqual({ gruppo: 'Totale doc.', valore: 'N. righe' });
  });

  it('group stringa sola (JSON salvato) raggruppa', () => {
    expect(intestazione(tr({ group: 'sede', agg: 'count' }), COLONNE)?.gruppo).toBe('Sede');
  });

  it('piu\' colonne: unite da " / " nell\'ordine di group', () => {
    expect(intestazione({ group: ['sede', 'cliente'] }, COLONNE)?.gruppo).toBe('Sede / Cliente');
    expect(intestazione({ group: ['cliente', 'sede'] }, COLONNE)?.gruppo).toBe('Cliente / Sede');
  });

  it('voci non valide in mezzo si saltano', () => {
    const t = tr({ group: [null, 'sede', '', 5, '  ', 'cliente', {}] });
    expect(() => intestazione(t, COLONNE)).not.toThrow();
    expect(intestazione(t, COLONNE)?.gruppo).toBe('Sede / Cliente');
  });

  it('colonna non in elenco: il nome dell\'item', () => {
    expect(intestazione({ group: ['sparita'] }, COLONNE)?.gruppo).toBe('sparita');
    expect(intestazione({ group: ['sede', 'sparita'] }, COLONNE)?.gruppo).toBe('Sede / sparita');
  });

  it.each([[null], [undefined], [[]]])('colonne %s: il nome dell\'item, senza lanciare', (c) => {
    expect(intestazione({ group: ['sede'], agg: 'sum', col: 'totDoc' }, c as Colonne | null | undefined))
      .toEqual({ gruppo: 'sede', valore: 'Σ totDoc' });
  });

  it.each(['anno', 'semestre', 'trimestre', 'mese'])('periodo %s: suffisso sulla prima colonna', (periodo) => {
    expect(intestazione(tr({ group: ['dataDoc'], periodo }), COLONNE)?.gruppo).toBe(`Data doc. (${periodo})`);
  });

  it('periodo solo sulla PRIMA colonna, anche con piu\' colonne', () => {
    expect(intestazione(tr({ group: ['dataDoc', 'sede'], periodo: 'mese' }), COLONNE)?.gruppo)
      .toBe('Data doc. (mese) / Sede');
  });

  it('periodo sulla prima colonna VALIDA (le voci vuote prima non contano)', () => {
    expect(intestazione(tr({ group: ['', 'dataDoc', 'sede'], periodo: 'trimestre' }), COLONNE)?.gruppo)
      .toBe('Data doc. (trimestre) / Sede');
  });

  it('periodo giorno o assente: nessun suffisso', () => {
    expect(intestazione(tr({ group: ['dataDoc'], periodo: 'giorno' }), COLONNE)?.gruppo).toBe('Data doc.');
    expect(intestazione(tr({ group: ['dataDoc'] }), COLONNE)?.gruppo).toBe('Data doc.');
  });

  it('periodo sulla colonna non in elenco: suffisso sul nome dell\'item', () => {
    expect(intestazione(tr({ group: ['dt'], periodo: 'anno' }), COLONNE)?.gruppo).toBe('dt (anno)');
  });

  it('etichette con HTML: restituite grezze', () => {
    const c: Colonne = [{ item: 'totDoc', etichetta: 'Totale<br/>doc.' }];
    expect(intestazione({ group: ['totDoc'], agg: 'sum', col: 'totDoc' }, c))
      .toEqual({ gruppo: 'Totale<br/>doc.', valore: 'Σ Totale<br/>doc.' });
  });
});

describe('SXADV-6107.4 intestazioneDeiGruppi: la colonna «valore» (calcolo per gruppo)', () => {
  it.each<[string, string]>([
    ['sum', 'Σ Totale doc.'],
    ['avg', 'M Totale doc.'],
    ['min', 'Min Totale doc.'],
    ['max', 'Max Totale doc.'],
  ])('%s -> %s', (agg, valore) => {
    expect(intestazione({ group: ['sede'], agg, col: 'totDoc' }, COLONNE)?.valore).toBe(valore);
  });

  it.each<[string, Record<string, unknown>]>([
    ['agg count', { agg: 'count' }],
    ['agg assente', {}],
    ['agg vuoto', { agg: '' }],
    ['count con una col rimasta', { agg: 'count', col: 'totDoc' }],
  ])('%s: N. righe', (_n, o) => {
    expect(intestazione(tr({ group: ['sede'], ...o }), COLONNE)?.valore).toBe('N. righe');
  });

  it('outAgg non conta: e\' il numero grande', () => {
    expect(intestazione({ group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'avg' }, COLONNE)?.valore).toBe('Σ Totale doc.');
    expect(intestazione({ group: ['sede'], agg: 'count', outAgg: 'sum' }, COLONNE)?.valore).toBe('N. righe');
    expect(intestazione({ group: ['sede'], agg: 'max', col: 'totDoc', outAgg: 'count' }, COLONNE)?.valore).toBe('Max Totale doc.');
  });

  it('col non in elenco: il nome di col', () => {
    expect(intestazione({ group: ['sede'], agg: 'avg', col: 'sparita' }, COLONNE)?.valore).toBe('M sparita');
  });

  it.each<[string, Record<string, unknown>]>([
    ['sum senza col', { agg: 'sum' }],
    ['avg col vuota', { agg: 'avg', col: '' }],
    ['max col null', { agg: 'max', col: null }],
    ['agg sconosciuto', { agg: 'mediana', col: 'totDoc' }],
    // JSON salvato: nomi che stanno nel prototipo di un oggetto normale.
    ['agg «constructor»', { agg: 'constructor', col: 'totDoc' }],
    ['agg «toString»', { agg: 'toString', col: 'totDoc' }],
  ])('%s: valore vuoto, il gruppo resta', (_n, o) => {
    const r = intestazione(tr({ group: ['sede'], ...o }), COLONNE);
    expect(r).toEqual({ gruppo: 'Sede', valore: '' });
  });
});

describe('SXADV-6107.4 RisultatoWidget forma Numero: intestazione sopra i gruppi', () => {
  it('caso della tester (conteggio dei gruppi, niente numero grande): intestazione subito prima dell\'elenco', async () => {
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi', { group: ['totDoc'], agg: 'count', outAgg: 'count' });
    const i = intestazioneParziali(h);
    expect(i).not.toBeNull();
    expect(subitoPrimaDellElenco(h)).toBe(true);
    expect(testo(span(i!, 'dash-parziale-etichetta') ?? '')).toBe('Totale doc.');
    expect(testo(span(i!, 'dash-parziale-valore') ?? '')).toBe('N. righe');
    expect(i!.indexOf('dash-parziale-etichetta')).toBeLessThan(i!.indexOf('dash-parziale-valore'));
    expect(h).not.toContain('dash-numero-valore');
  });

  it('outAgg assente: idem', async () => {
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi', { group: ['sede'], agg: 'sum', col: 'totDoc' });
    expect(subitoPrimaDellElenco(h)).toBe(true);
    expect(spans(intestazioneParziali(h)!)).toEqual(['Sede', 'Σ Totale doc.']);
  });

  it('con il numero grande sopra: intestazione comunque sopra l\'elenco', async () => {
    const h = await html({ numero: 12, gruppi, completo: true }, 'kpi',
      { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'avg' });
    expect(h).toContain('dash-numero-valore');
    expect(subitoPrimaDellElenco(h)).toBe(true);
    expect(spans(intestazioneParziali(h)!)).toEqual(['Sede', 'Σ Totale doc.']);
  });

  it('una sola intestazione; l\'elenco ha solo i gruppi, nell\'ordine di prima', async () => {
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi', { group: ['totDoc'], agg: 'count' });
    expect(h.match(/dash-parziali-intestazione/g)).toHaveLength(1);
    const voci = vociParziali(h)!;
    expect(voci).toHaveLength(2);
    expect(voci.some((v) => /intestazione/.test(v))).toBe(false);
    const resto = voci.map(testo);
    expect(resto[0]).toContain('1.220,00 €');
    expect(resto[0]).toContain('2');
    expect(resto[1]).toContain('0,00 €');
    expect(resto[1]).toContain('1');
  });

  it('periodo: suffisso nell\'intestazione', async () => {
    const h = await html({ numero: 2, gruppi: [{ k: '2026-01', etichetta: 'gen 2026', valore: 3 }], completo: true }, 'kpi',
      tr({ group: ['dataDoc'], periodo: 'mese', agg: 'count' }));
    expect(spans(intestazioneParziali(h)!)).toEqual(['Data doc. (mese)', 'N. righe']);
  });

  it('solo «altri»: l\'elenco c\'e\' e ha l\'intestazione sopra', async () => {
    const h = await html({ numero: 3, gruppi: [], altri: { valore: 4, gruppi: 3 }, completo: true }, 'kpi',
      { group: ['sede'], agg: 'count', outAgg: 'count' });
    const voci = vociParziali(h);
    expect(voci).not.toBeNull();
    expect(subitoPrimaDellElenco(h)).toBe(true);
    expect(spans(intestazioneParziali(h)!)).toEqual(['Sede', 'N. righe']);
    expect(voci!.map(testo).join(' ')).toMatch(/Altri/);
  });

  it('senza raggruppamento: nessuna intestazione', async () => {
    const h = await html({ numero: 12, completo: true }, 'kpi', { agg: 'sum', col: 'totDoc' });
    expect(h).not.toContain('intestazione');
  });

  it('raggruppa ma nessun gruppo e nessun altri: nessuna intestazione', async () => {
    const h = await html({ numero: 0, gruppi: [], completo: true }, 'kpi', { group: ['sede'], agg: 'count' });
    expect(h).not.toContain('dash-parziali-intestazione');
  });

  it('trasformazione nulla con gruppi nel risultato: nessuna intestazione', async () => {
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi', null);
    expect(h).not.toContain('dash-parziali-intestazione');
  });

  it('errore: solo il messaggio, nessuna intestazione', async () => {
    const h = await html({ errore: 'Qualcosa non va', gruppi }, 'kpi', { group: ['sede'], agg: 'count' });
    expect(testo(h)).toContain('Qualcosa non va');
    expect(h).not.toContain('dash-parziali-intestazione');
    expect(h).not.toContain('dash-barre-intestazione');
  });

  it('il «Σ Totale doc.» sopra il numero grande resta', async () => {
    const h = await html({ numero: 12, gruppi, completo: true }, 'kpi',
      { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'sum' });
    const m = /<div class="dash-numero-calcolo">([\s\S]*?)<\/div>/.exec(h);
    expect(m && testo(m[1])).toBe('Σ Totale doc.');
  });
});

describe('SXADV-6107.4 RisultatoWidget forma Barre: intestazione sopra le barre', () => {
  it('con barre: div di intestazione prima della <ul>, due span', async () => {
    const h = await html({ gruppi, completo: true }, 'bar', { group: ['totDoc'], agg: 'count' });
    const i = intestazioneBarre(h);
    expect(i).not.toBeNull();
    expect(spans(i!)).toEqual(['Totale doc.', 'N. righe']);
    const ul = h.indexOf('<ul', h.indexOf('dash-barre-intestazione'));
    expect(ul).toBeGreaterThan(-1);
    expect(h.indexOf('dash-barre-intestazione')).toBeLessThan(h.lastIndexOf('<ul'));
  });

  it('somma per gruppo con periodo', async () => {
    const h = await html({ gruppi, completo: true }, 'bar', tr({ group: ['dataDoc', 'sede'], periodo: 'anno', agg: 'max', col: 'totDoc' }));
    expect(spans(intestazioneBarre(h)!)).toEqual(['Data doc. (anno) / Sede', 'Max Totale doc.']);
  });

  it('«Nessun gruppo da mostrare.»: nessuna intestazione', async () => {
    const h = await html({ gruppi: [], completo: true }, 'bar', { group: ['sede'], agg: 'count' });
    expect(testo(h)).toContain('Nessun gruppo da mostrare.');
    expect(h).not.toContain('dash-barre-intestazione');
  });

  it('errore: nessuna intestazione', async () => {
    const h = await html({ errore: 'boom', gruppi }, 'bar', { group: ['sede'], agg: 'count' });
    expect(h).not.toContain('dash-barre-intestazione');
  });
});

describe('SXADV-6107.4 etichette con HTML: filtrate come le intestazioni di lista', () => {
  const HTML_COL: Colonne = [
    { item: 'totDoc', etichetta: 'Totale<br/>doc.' },
    { item: 'sede', etichetta: 'Sede' },
  ];
  // Correzione di chi implementa, dopo la revisione: prima l'atteso era
  // listHeaderLabel(raw).text, cioe' «Totaledoc.» (tautologico). Il <br/> vale uno spazio.
  const atteso = 'Totale doc.';

  const nienteBrGrezzo = (frammento: string) => {
    expect(frammento).not.toMatch(/<br/i);
    expect(frammento).not.toMatch(/&lt;br/i);
  };

  it('Numero: l\'etichetta del gruppo non e\' markup ne\' testo <br/>', async () => {
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi', { group: ['totDoc'], agg: 'count' }, HTML_COL);
    const s = span(intestazioneParziali(h)!, 'dash-parziale-etichetta')!;
    nienteBrGrezzo(s);
    expect(testo(s)).toBe(atteso);
  });

  it('Numero: l\'etichetta del calcolo non e\' markup ne\' testo <br/>', async () => {
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi',
      { group: ['sede'], agg: 'sum', col: 'totDoc' }, HTML_COL);
    const s = span(intestazioneParziali(h)!, 'dash-parziale-valore')!;
    nienteBrGrezzo(s);
    expect(testo(s)).toBe(`Σ ${atteso}`);
  });

  it('Barre: idem', async () => {
    const h = await html({ gruppi, completo: true }, 'bar', { group: ['totDoc'], agg: 'sum', col: 'totDoc' }, HTML_COL);
    const i = intestazioneBarre(h)!;
    nienteBrGrezzo(i);
    expect(spans(i)).toEqual([atteso, `Σ ${atteso}`]);
  });

  it('markup pericoloso non passa', async () => {
    const c: Colonne = [{ item: 'sede', etichetta: 'Sede<script>alert(1)</script><img src=x onerror="alert(2)">' }];
    const h = await html({ numero: 2, gruppi, completo: true }, 'kpi', { group: ['sede'], agg: 'count' }, c);
    const v = intestazioneParziali(h)!;
    expect(v).not.toMatch(/<script/i);
    expect(v).not.toMatch(/onerror/i);
  });
});

// Aggiunti da chi implementa dopo la revisione indipendente (rilievi minori 3 e 4).
describe('SXADV-6107.4 dopo la revisione', () => {
  it('spazi attorno al nome della colonna: si trova lo stesso, come sul server', () => {
    expect(R.intestazioneDeiGruppi({ group: [' totDoc '], agg: 'sum', col: ' totDoc ' }, [{ item: 'totDoc', etichetta: 'Totale doc.' }]))
      .toEqual({ gruppo: 'Totale doc.', valore: 'Σ Totale doc.' });
  });

  it('il <br/> sopra il numero grande vale uno spazio anche in «Σ Totale doc.» (6107.3)', async () => {
    const h = await html({ numero: 5, completo: true }, 'kpi', { agg: 'sum', col: 'totDoc' },
      [{ item: 'totDoc', etichetta: 'Totale<br/>doc.' }]);
    const m = /<div class="dash-numero-calcolo">([\s\S]*?)<\/div>/.exec(h);
    expect(testo(m![1])).toBe('Σ Totale doc.');
  });
});
