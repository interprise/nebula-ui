import { describe, it, expect } from 'vitest';
import { prerender } from 'react-dom/static';
import { RisultatoVista } from './RisultatoWidget';
import { calcoloDelNumero, type Risultato, type Trasformazione } from './risultato';

// SXADV-6107.3: sopra il numero grande, simbolo e nome del calcolo. Σ somma, M media,
// N. conteggio, Min, Max; «Σ Totale doc.» usa l'etichetta della colonna; con i gruppi conta il
// «Numero finale» (outAgg); conteggio di righe senza gruppi: «N. righe»; a numero non
// pertinente (SXADV-6043, solo gruppi) non compare. Chi prova non e' chi implementa.

const tr = (o: Record<string, unknown>) => o as unknown as Trasformazione;
const COLONNE = [
  { item: 'totDoc', etichetta: 'Totale doc.' },
  { item: 'sede', etichetta: 'Sede' },
];

async function html(r: Risultato, forma: string, t: Trasformazione | null, colonne: typeof COLONNE | null = COLONNE) {
  const { prelude } = await prerender(
    <RisultatoVista risultato={r} forma={forma} trasformazione={t} opzioni={null} colonne={colonne} />,
  );
  return new Response(prelude).text();
}
const testo = (s: string) =>
  s.replace(/<!--.*?-->/g, '').replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
/** Il testo del blocco del calcolo, o null se non c'e'. */
const blocco = (h: string) => {
  const m = /<div class="dash-numero-calcolo">([\s\S]*?)<\/div>/.exec(h);
  return m ? testo(m[1]) : null;
};
const gruppi = [{ k: '1', etichetta: 'Padova', valore: 10 }];

describe('SXADV-6107.3 calcoloDelNumero: senza gruppi conta «Calcola»', () => {
  it.each<[string, string, string]>([
    ['sum', 'Σ', 'Totale doc.'],
    ['avg', 'M', 'Totale doc.'],
    ['min', 'Min', 'Totale doc.'],
    ['max', 'Max', 'Totale doc.'],
  ])('%s -> %s %s', (agg, simbolo, nome) => {
    expect(calcoloDelNumero({ agg, col: 'totDoc' }, COLONNE)).toEqual({ simbolo, nome });
  });

  it.each<[string, Trasformazione]>([
    ['count', { agg: 'count' }],
    ['agg assente', {}],
    ['agg vuoto', tr({ agg: '' })],
    ['group vuoto', { group: [], agg: 'count' }],
    ['count con una col rimasta dal calcolo di prima', { agg: 'count', col: 'totDoc' }],
  ])('conteggio di righe (%s): N. righe', (_n, t) => {
    expect(calcoloDelNumero(t, COLONNE)).toEqual({ simbolo: 'N.', nome: 'righe' });
  });

  it('l\'outAgg senza gruppi non conta', () => {
    expect(calcoloDelNumero({ agg: 'sum', col: 'totDoc', outAgg: 'avg' }, COLONNE)?.simbolo).toBe('Σ');
  });
});

describe('SXADV-6107.3 calcoloDelNumero: con i gruppi conta il «Numero finale»', () => {
  it.each<[string, string, string]>([
    ['sum', 'sum', 'Σ'],
    ['avg', 'sum', 'M'],
    ['count', 'sum', 'N.'],
    ['sum', 'max', 'Σ'],
    ['avg', 'min', 'M'],
  ])('outAgg %s, agg %s -> %s', (outAgg, agg, simbolo) => {
    expect(calcoloDelNumero({ group: ['sede'], agg, col: 'totDoc', outAgg }, COLONNE))
      .toEqual({ simbolo, nome: 'Totale doc.' });
  });

  it('outAgg assente o vuoto vale conteggio', () => {
    expect(calcoloDelNumero({ group: ['sede'], agg: 'sum', col: 'totDoc' }, COLONNE)?.simbolo).toBe('N.');
    expect(calcoloDelNumero(tr({ group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: '' }), COLONNE)?.simbolo).toBe('N.');
  });

  it('somma dei conteggi per gruppo: Σ righe', () => {
    expect(calcoloDelNumero({ group: ['sede'], agg: 'count', outAgg: 'sum' }, COLONNE))
      .toEqual({ simbolo: 'Σ', nome: 'righe' });
  });

  it('group come stringa: raggruppa, come per il server', () => {
    expect(calcoloDelNumero(tr({ group: 'sede', agg: 'sum', col: 'totDoc', outAgg: 'avg' }), COLONNE)?.simbolo).toBe('M');
  });
});

describe('SXADV-6107.3 calcoloDelNumero: i casi di bordo', () => {
  it.each([[null], [undefined]])('trasformazione %s: niente', (t) => {
    expect(calcoloDelNumero(t, COLONNE)).toBeNull();
  });

  it('colonna non piu\' in elenco: non lancia, il nome c\'e\' (il nome tecnico)', () => {
    expect(calcoloDelNumero({ agg: 'sum', col: 'sparita' }, COLONNE)).toEqual({ simbolo: 'Σ', nome: 'sparita' });
  });

  it('elenco colonne assente: non lancia', () => {
    for (const c of [null, undefined, []]) {
      expect(calcoloDelNumero({ agg: 'sum', col: 'totDoc' }, c)).toEqual({ simbolo: 'Σ', nome: 'totDoc' });
    }
  });

  it('etichetta vuota: ripiega sul nome della colonna', () => {
    expect(calcoloDelNumero({ agg: 'sum', col: 'x' }, [{ item: 'x', etichetta: '' }])?.nome).toBe('x');
  });

  it.each<[string, Trasformazione]>([
    ['outAgg sconosciuto', { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'mediana' }],
    ['agg sconosciuto senza gruppi', { agg: 'mediana', col: 'totDoc' }],
    // JSON salvato: SIMBOLI e' un oggetto normale e questi nomi stanno nel suo prototipo.
    ['outAgg «constructor»', { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'constructor' }],
    ['agg «toString» senza gruppi', { agg: 'toString', col: 'totDoc' }],
  ])('%s: niente, non un simbolo inventato', (_n, t) => {
    expect(calcoloDelNumero(t, COLONNE)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['[null]', [null]],
    ['[5]', [5]],
    ['5', 5],
    ['true', true],
    ['{}', {}],
    ['[" "]', [' ']],
  ])('group %s non raggruppa: non lancia, vale «Calcola»', (_n, group) => {
    const t = tr({ group, agg: 'avg', col: 'totDoc', outAgg: 'sum' });
    expect(calcoloDelNumero(t, COLONNE)).toEqual({ simbolo: 'M', nome: 'Totale doc.' });
  });

  it('[sede, null]: resta una colonna vera, conta il Numero finale', () => {
    const t = tr({ group: ['sede', null], agg: 'avg', col: 'totDoc', outAgg: 'sum' });
    expect(calcoloDelNumero(t, COLONNE)?.simbolo).toBe('Σ');
  });
});

describe('SXADV-6107.3 RisultatoWidget: il blocco sopra il numero', () => {
  it('«Σ Totale doc.» sopra il valore', async () => {
    const h = await html({ numero: 12, completo: true }, 'kpi', { agg: 'sum', col: 'totDoc' });
    expect(blocco(h)).toBe('Σ Totale doc.');
    expect(h.indexOf('dash-numero-calcolo')).toBeLessThan(h.indexOf('dash-numero-valore'));
    expect(h).toContain('dash-numero-simbolo');
  });

  it('«N. righe»', async () => {
    expect(blocco(await html({ numero: 12, completo: true }, 'kpi', { agg: 'count' }))).toBe('N. righe');
  });

  it('con i gruppi e outAgg avg: «M» insieme ai gruppi', async () => {
    const h = await html({ numero: 12, gruppi, completo: true }, 'kpi',
      { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'avg' });
    expect(blocco(h)).toBe('M Totale doc.');
  });

  it('senza prop colonne non si rompe', async () => {
    const h = await html({ numero: 1, completo: true }, 'kpi', { agg: 'sum', col: 'totDoc' }, null);
    expect(blocco(h)).toBe('Σ totDoc');
  });

  it.each<[string, Trasformazione]>([
    ['conteggio', { group: ['sede'], agg: 'count', outAgg: 'count' }],
    ['somma per gruppo, outAgg assente', { group: ['sede'], agg: 'sum', col: 'totDoc' }],
    ['filtro sui gruppi', { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'count', having: { op: '>', value: 0 } }],
  ])('SXADV-6043, solo gruppi (%s): il numero non c\'e\', nemmeno il suo nome', async (_n, t) => {
    const h = await html({ numero: 33, gruppi, completo: true }, 'kpi', t);
    expect(h).not.toContain('dash-numero-valore');
    expect(blocco(h)).toBeNull();
  });

  it('solo «altri»: stesso caso', async () => {
    const h = await html({ numero: 3, gruppi: [], altri: { valore: 4, gruppi: 3 }, completo: true }, 'kpi',
      { group: ['sede'], agg: 'count', outAgg: 'count' });
    expect(blocco(h)).toBeNull();
  });

  it('trasformazione nulla: numero si\', nome no', async () => {
    const h = await html({ numero: 33, completo: true }, 'kpi', null);
    expect(h).toContain('dash-numero-valore');
    expect(blocco(h)).toBeNull();
  });

  it('outAgg sconosciuto: il numero resta, senza nome', async () => {
    const h = await html({ numero: 33, gruppi, completo: true }, 'kpi',
      { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'mediana' });
    expect(h).toContain('dash-numero-valore');
    expect(blocco(h)).toBeNull();
  });

  it('errore e forma a barre: niente blocco', async () => {
    expect(blocco(await html({ errore: 'x' }, 'kpi', { agg: 'sum', col: 'totDoc' }))).toBeNull();
    expect(blocco(await html({ gruppi, completo: true }, 'bar', { group: ['sede'], agg: 'sum', col: 'totDoc', outAgg: 'sum' }))).toBeNull();
  });

  it('una somma senza colonna (salvata prima di 6110.1): non resta un simbolo senza nome', async () => {
    const h = await html({ numero: 0, completo: true }, 'kpi', { agg: 'sum' });
    expect(blocco(h)).not.toBe('Σ');
  });
});
