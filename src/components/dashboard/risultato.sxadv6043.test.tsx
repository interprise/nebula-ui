import { describe, it, expect } from 'vitest';
import { prerender } from 'react-dom/static';
import { RisultatoVista } from './RisultatoWidget';
import { numeroPertinente, type Risultato, type Trasformazione } from './risultato';

// SXADV-6043: forma Numero con un raggruppamento vero e outAgg count o assente. Il numero
// grande conterebbe i gruppi, che si vedono gia': non si disegna mai, qualunque sia agg e
// qualunque filtro sui gruppi. Resta con outAgg sum/avg, senza raggruppamento, o quando
// senza di lui il widget resterebbe vuoto.
//
// Prove indipendenti dall'implementazione: si legge il markup reso, non la struttura.

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

const haClasse = (h: string, cls: string) =>
  [...h.matchAll(/<[a-z]+\b[^>]*>/g)].some((m) => classi(m[0]).includes(cls));

const elementiLi = (h: string) =>
  [...h.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
    classi: classi(m[0].slice(0, m[0].indexOf('>') + 1)),
    interno: m[1],
  }));

const righeGruppo = (h: string) =>
  elementiLi(h).filter(
    (l) =>
      l.classi.includes('dash-parziale') &&
      !l.classi.includes('dash-parziale-altri') &&
      !l.classi.includes('dash-parziale-totale'),
  );
const altriLi = (h: string) => elementiLi(h).filter((l) => l.classi.includes('dash-parziale-altri'));
const totaleLi = (h: string) => elementiLi(h).filter((l) => l.classi.includes('dash-parziale-totale'));

/** Per le forme che il tipo non ammette ma il JSON salvato si': value null, group stringa. */
const tr = (o: Record<string, unknown>) => o as unknown as Trasformazione;
const conFiltro = (having: unknown) => tr({ group: ['sede'], agg: 'count', outAgg: 'count', having });

const tConta: Trasformazione = { group: ['sede'], agg: 'count', outAgg: 'count' };
const gruppi = [
  { k: '001', etichetta: 'Padova', valore: 120 },
  { k: '002', etichetta: 'Verona', valore: 45 },
];
const conGruppi: Risultato = { numero: 33, gruppi, completo: true };
const senzaGruppi: Risultato = { numero: 0, gruppi: [], completo: true };
const soloAltri: Risultato = { numero: 3, gruppi: [], altri: { valore: 40, gruppi: 3 }, completo: true };

const senzaNumero = (h: string) => {
  expect(haClasse(h, 'dash-numero-valore')).toBe(false);
  expect(haClasse(h, 'dash-numero-parziale')).toBe(false);
  expect(haClasse(h, 'dash-numero-delta')).toBe(false);
};

describe('SXADV-6043 numeroPertinente: quando il numero si toglie', () => {
  it.each<[string, Trasformazione]>([
    ['conteggio esplicito', tConta],
    ['agg assente', { group: ['sede'], outAgg: 'count' }],
    ['outAgg assente', { group: ['sede'], agg: 'count' }],
    ['agg e outAgg assenti', { group: ['sede'] }],
    ['having null', { ...tConta, having: null }],
    ['having assente con escludi', { ...tConta, escludi: ['000'] }],
    ['agg vuoto: il server lo legge come conteggio', tr({ group: ['sede'], agg: '', outAgg: 'count' })],
    ['outAgg vuoto: il server lo legge come assente', tr({ group: ['sede'], agg: 'count', outAgg: '' })],
    ['agg sum', { group: ['sede'], agg: 'sum', col: 'importo', outAgg: 'count' }],
    ['agg avg', { group: ['sede'], agg: 'avg', col: 'importo', outAgg: 'count' }],
    ['agg min', { group: ['sede'], agg: 'min', col: 'importo', outAgg: 'count' }],
    ['agg max', { group: ['sede'], agg: 'max', col: 'importo', outAgg: 'count' }],
    ['agg sum senza outAgg', { group: ['sede'], agg: 'sum', col: 'importo' }],
    ['l\'esempio «Gruppi con valore > 0»', {
      group: ['cliente'],
      agg: 'sum',
      col: 'saldo',
      outAgg: 'count',
      having: { op: '>', value: 0 },
    }],
    ['group a piu\' colonne', { group: ['sede', 'anno'], agg: 'count', outAgg: 'count' }],
    ['group come stringa: il server accetta anche questa forma', tr({ group: 'sede', agg: 'count' })],
  ])('%s', (_n, t) => {
    expect(numeroPertinente(t, conGruppi)).toBe(false);
  });

  it('bastano gli «altri» per avere gruppi da mostrare', () => {
    expect(numeroPertinente(tConta, soloAltri)).toBe(false);
  });

  it('«altri» con valore zero sono comunque gruppi da mostrare', () => {
    expect(numeroPertinente(tConta, { gruppi: [], altri: { valore: 0, gruppi: 2 } })).toBe(false);
  });

  it('gruppi presenti e «altri» null', () => {
    expect(numeroPertinente(tConta, { ...conGruppi, altri: null })).toBe(false);
  });
});

describe('SXADV-6043 numeroPertinente: qualunque filtro sui gruppi', () => {
  // Con outAgg count il numero non si mostra mai: il filtro non conta, nemmeno se vero.
  it.each<[string, number | string]>([
    ['>', 0],
    ['>', 5],
    ['>', '5'],
    ['>=', 1],
    ['>=', 2],
    ['<', 200],
    ['<', 0],
    ['<=', 3],
    ['=', 4],
    ['!=', 0],
    ['!=', 1],
  ])('%s %s: numero tolto, a ogni agg', (op, value) => {
    for (const agg of ['count', 'sum', 'avg', 'min', 'max']) {
      const t = tr({ group: ['sede'], agg, col: 'importo', outAgg: 'count', having: { op, value } });
      expect(numeroPertinente(t, conGruppi), agg).toBe(false);
    }
  });

  // Il filtro non si guarda piu': un having malformato non deve riportare il numero
  // (e non deve lanciare). Il server, su questi, risponde comunque con un errore.
  it.each<[string, unknown]>([
    ['having vuoto', {}],
    ['op assente', { value: 5 }],
    ['op vuoto', { op: '', value: 5 }],
    ['op null', { op: null, value: 5 }],
    ['op sconosciuta', { op: 'like', value: 0 }],
    ['valore stringa vuota', { op: '>', value: '' }],
    ['valore di soli spazi', { op: '>', value: '   ' }],
    ['valore null', { op: '>', value: null }],
    ['valore assente', { op: '>' }],
    ['valore non numerico', { op: '>', value: 'abc' }],
  ])('%s: numero tolto', (_n, having) => {
    expect(numeroPertinente(conFiltro(having), conGruppi)).toBe(false);
  });

  it('un filtro non basta a togliere il numero se i gruppi da mostrare non ci sono', () => {
    expect(numeroPertinente(conFiltro({ op: '>', value: 5 }), senzaGruppi)).toBe(true);
  });
});

describe('SXADV-6043 numeroPertinente: tutti gli altri casi, il numero resta', () => {
  it.each<[string, Trasformazione | null | undefined]>([
    ['trasformazione null', null],
    ['trasformazione undefined', undefined],
    ['trasformazione vuota', {}],
    ['senza raggruppamento', { agg: 'count' }],
    ['group vuoto', { group: [], agg: 'count', outAgg: 'count' }],
    ['group null', tr({ group: null, agg: 'count' })],
    ['group stringa vuota: per il server non c\'e\'', tr({ group: '', agg: 'count' })],
    ['group con sole voci vuote: per il server non c\'e\'', tr({ group: ['', '  '], agg: 'count' })],
    ['outAgg sum', { group: ['sede'], agg: 'count', outAgg: 'sum' }],
    ['outAgg avg', { group: ['sede'], agg: 'count', outAgg: 'avg' }],
    ['outAgg avg con somma per gruppo', { group: ['sede'], agg: 'sum', col: 'importo', outAgg: 'avg' }],
    ['outAgg sum con filtro > 0', { group: ['sede'], outAgg: 'sum', having: { op: '>', value: 0 } }],
    ['outAgg sum con filtro > 5', { group: ['sede'], outAgg: 'sum', having: { op: '>', value: 5 } }],
    ['outAgg avg con filtro < 200', { group: ['sede'], outAgg: 'avg', having: { op: '<', value: 200 } }],
  ])('%s', (_n, t) => {
    expect(numeroPertinente(t, conGruppi)).toBe(true);
  });

  // Il widget non deve restare vuoto.
  it.each<[string, Risultato]>([
    ['gruppi vuoti e niente altri', senzaGruppi],
    ['gruppi assenti', { numero: 0, completo: true }],
    ['altri null', { numero: 0, gruppi: [], altri: null }],
    ['altri con valore null', { numero: 0, gruppi: [], altri: { valore: null, gruppi: 2 } }],
    ['altri con valore assente', { numero: 0, gruppi: [], altri: { gruppi: 2 } }],
    ['altri con valore stringa vuota', { numero: 0, gruppi: [], altri: { valore: '', gruppi: 2 } }],
    ['risultato vuoto', {}],
  ])('nessun gruppo da mostrare: %s', (_n, r) => {
    expect(numeroPertinente(tConta, r)).toBe(true);
  });
});

describe('SXADV-6043 resa: il numero tolto', () => {
  it('niente numero, «(parziale)» e delta, anche se il server li manda', async () => {
    const h = await html(
      { numero: 33, delta: 5, gruppi, completo: false, righeLette: 10 },
      'kpi',
      tConta,
    );
    senzaNumero(h);
    expect(testo(h)).not.toContain('33');
    expect(testo(h)).not.toContain('rispetto all');
  });

  it('delta zero: si toglie anche quello', async () => {
    senzaNumero(await html({ numero: 33, delta: 0, gruppi, completo: true }, 'kpi', tConta));
  });

  it('outAgg assente: numero null, nessun trattino al suo posto', async () => {
    const h = await html({ numero: null, gruppi, completo: true }, 'kpi', {
      group: ['sede'],
      agg: 'count',
    });
    senzaNumero(h);
    expect(testo(h)).not.toContain('—');
  });

  it('il caso dello screenshot: having > 0, anche con valore stringa', async () => {
    for (const value of [0, '0']) {
      const h = await html(
        { numero: 33, gruppi, completo: false, righeLette: 10 },
        'kpi',
        { ...tConta, having: { op: '>', value } },
      );
      senzaNumero(h);
      expect(righeGruppo(h)).toHaveLength(2);
    }
  });

  it.each<[string, string, number]>([
    ['count', '>', 5],
    ['count', '<', 200],
    ['sum', '>', 5],
    ['sum', '<', 200],
    ['avg', '>=', 2],
    ['min', '=', 4],
    ['max', '!=', 1],
  ])('agg %s, filtro %s %s: niente numero ne\' delta, i gruppi restano', async (agg, op, value) => {
    const h = await html(
      { numero: 33, delta: 5, gruppi, completo: false, righeLette: 10 },
      'kpi',
      { group: ['sede'], agg, col: 'importo', outAgg: 'count', having: { op, value } },
    );
    senzaNumero(h);
    expect(righeGruppo(h)).toHaveLength(2);
    expect(haClasse(h, 'dash-risultato-nota')).toBe(true);
  });

  it('valori di una somma: due decimali anche senza numero grande', async () => {
    const h = await html(conGruppi, 'kpi', { group: ['sede'], agg: 'sum', col: 'importo', outAgg: 'count' });
    senzaNumero(h);
    expect(righeGruppo(h).map((l) => testo(l.interno))).toEqual(['Padova120,00', 'Verona45,00']);
  });

  it('restano elenco dei gruppi, Altri e Totale', async () => {
    const h = await html(
      { numero: 33, gruppi, altri: { valore: 40, gruppi: 3 }, totale: 205, completo: true },
      'kpi',
      tConta,
    );
    senzaNumero(h);
    expect(haClasse(h, 'dash-parziali')).toBe(true);
    expect(righeGruppo(h).map((l) => testo(l.interno))).toEqual(['Padova120', 'Verona45']);
    expect(testo(altriLi(h)[0].interno)).toContain('Altri (3 gruppi)');
    expect(testo(totaleLi(h)[0].interno)).toBe('Totale205');
  });

  it('il Totale incompleto dice «(parziale)», anche senza numero grande', async () => {
    const h = await html(
      { numero: 33, gruppi, totale: 165, completo: false, righeLette: 10 },
      'kpi',
      tConta,
    );
    expect(haClasse(h, 'dash-numero-parziale')).toBe(false);
    expect(testo(totaleLi(h)[0].interno)).toContain('165 (parziale)');
  });

  it.each<[string, Partial<Risultato>, string]>([
    ['righe salvate', { completo: false, righeLette: 500 }, 'calcolato sulle 500 righe salvate'],
    ['gruppi troppi', { completo: false, via: 'sql', righeLette: 500 }, 'i gruppi sono troppi'],
    ['niente fotografia', { completo: false, righeLette: 0 }, 'i dati arrivano col primo aggiornamento'],
    ['provvisorio', { completo: true, provvisorio: true }, 'provvisorio'],
  ])('la nota in fondo resta: %s', async (_n, extra, atteso) => {
    const h = await html({ numero: 33, gruppi, ...extra }, 'kpi', tConta);
    senzaNumero(h);
    expect(haClasse(h, 'dash-risultato-nota')).toBe(true);
    expect(testo(h)).toContain(atteso);
  });

  it('solo «altri»: la riga si vede, il widget non resta vuoto', async () => {
    const h = await html(soloAltri, 'kpi', tConta);
    senzaNumero(h);
    expect(altriLi(h)).toHaveLength(1);
    expect(testo(altriLi(h)[0].interno)).toContain('Altri (3 gruppi)');
  });

  it('«Esclusi» ancora dichiarati', async () => {
    const h = await html(
      { ...conGruppi, esclusi: [{ k: '000', etichetta: 'Sede 000' }, { k: '009', etichetta: null }] },
      'kpi',
      { ...tConta, escludi: ['000', '009'] },
    );
    senzaNumero(h);
    expect(haClasse(h, 'dash-esclusi')).toBe(true);
    expect(testo(h)).toContain('senza: Sede 000, 009');
  });
});

describe('SXADV-6043 resa: il numero resta', () => {
  const conNumero = (h: string, valore: string) => {
    expect(haClasse(h, 'dash-numero-valore')).toBe(true);
    expect(testo(h)).toContain(valore);
  };

  it.each<[string, string, number]>([
    ['sum', '>', 5],
    ['sum', '<', 200],
    ['avg', '>', 5],
    ['avg', '<', 200],
  ])('outAgg %s con filtro %s %s: numero, delta e «(parziale)» insieme ai gruppi', async (outAgg, op, value) => {
    const h = await html(
      { numero: 33, delta: 5, gruppi, completo: false, righeLette: 10 },
      'kpi',
      { group: ['sede'], agg: 'sum', col: 'importo', outAgg, having: { op, value } },
    );
    expect(haClasse(h, 'dash-numero-valore')).toBe(true);
    expect(haClasse(h, 'dash-numero-delta')).toBe(true);
    expect(haClasse(h, 'dash-numero-parziale')).toBe(true);
    expect(righeGruppo(h)).toHaveLength(2);
  });

  it.each<[string, Trasformazione | null]>([
    ['senza raggruppamento', { agg: 'count' }],
    ['group vuoto', { group: [], agg: 'count' }],
    ['outAgg sum', { group: ['sede'], agg: 'count', outAgg: 'sum' }],
    ['outAgg avg', { group: ['sede'], agg: 'count', outAgg: 'avg' }],
    ['trasformazione null', null],
  ])('%s', async (_n, t) => {
    const h = await html({ numero: 33, delta: 2, gruppi, completo: true }, 'kpi', t);
    conNumero(h, '33');
    expect(haClasse(h, 'dash-numero-delta')).toBe(true);
  });

  it('gruppi vuoti e niente altri: il numero resta e il widget non e\' vuoto', async () => {
    const h = await html(senzaGruppi, 'kpi', tConta);
    expect(haClasse(h, 'dash-numero-valore')).toBe(true);
    expect(testo(h)).toContain('0');
  });

  it('un filtro che ha tolto tutti i gruppi: il numero resta, anche con la somma', async () => {
    const h = await html({ numero: 0, gruppi: [], completo: true }, 'kpi', {
      group: ['sede'],
      agg: 'sum',
      col: 'importo',
      outAgg: 'count',
      having: { op: '>', value: 1000 },
    });
    conNumero(h, '0');
  });

  it('gruppi vuoti e altri con valore null: il numero resta, niente righe', async () => {
    const h = await html(
      { numero: 7, gruppi: [], altri: { valore: null, gruppi: 2 }, completo: true },
      'kpi',
      tConta,
    );
    conNumero(h, '7');
    expect(altriLi(h)).toHaveLength(0);
  });
});

describe('SXADV-6043 group con voci che non sono testo', () => {
  // La trasformazione e' JSON salvato e si legge durante il disegno: un'eccezione qui
  // porterebbe giu' tutta la Home.
  const conGroup = (group: unknown) => tr({ group, agg: 'count', outAgg: 'count' });

  it.each<[string, unknown]>([
    ['[null]', [null]],
    ['[sede, null]', ['sede', null]],
    ['[5]', [5]],
    ['5', 5],
    ['true', true],
    ['{}', {}],
  ])('%s: non lancia, ne\' la funzione ne\' la resa', async (_n, group) => {
    expect(() => numeroPertinente(conGroup(group), conGruppi)).not.toThrow();
    await expect(html(conGruppi, 'kpi', conGroup(group))).resolves.toEqual(expect.any(String));
  });

  it('[null]: il server scarta la voce, niente raggruppamento, il numero resta', async () => {
    expect(numeroPertinente(conGroup([null]), conGruppi)).toBe(true);
    const h = await html(conGruppi, 'kpi', conGroup([null]));
    expect(haClasse(h, 'dash-numero-valore')).toBe(true);
    expect(testo(h)).toContain('33');
  });

  it('[sede, null]: resta una colonna vera, il numero si toglie', async () => {
    expect(numeroPertinente(conGroup(['sede', null]), conGruppi)).toBe(false);
    const h = await html(conGruppi, 'kpi', conGroup(['sede', null]));
    senzaNumero(h);
    expect(righeGruppo(h)).toHaveLength(2);
  });
});

describe('SXADV-6043 resa: il resto invariato', () => {
  it.each<[string, Trasformazione]>([
    ['conteggio', tConta],
    ['con filtro', { ...tConta, having: { op: '>', value: 0 } }],
  ])('forma bar: barre e totale come prima (%s)', async (_n, t) => {
    const h = await html({ numero: 33, gruppi, totale: 165, completo: true }, 'bar', t);
    expect(elementiLi(h).filter((l) => l.classi.includes('dash-barra'))).toHaveLength(2);
    expect(haClasse(h, 'dash-barre-totale')).toBe(true);
    expect(testo(h)).toContain('165');
  });

  it('forma bar senza gruppi: dice che non ce ne sono', async () => {
    expect(testo(await html(senzaGruppi, 'bar', tConta))).toContain('Nessun gruppo da mostrare.');
  });

  it('forma che non e\' ne\' kpi ne\' bar: niente', async () => {
    expect(testo(await html(conGruppi, 'lista', tConta))).toBe('');
  });

  it('errore: il messaggio, ne\' numero ne\' elenco', async () => {
    const h = await html({ ...conGruppi, errore: 'colonna sparita.' }, 'kpi', tConta);
    expect(haClasse(h, 'dash-risultato-errore')).toBe(true);
    expect(testo(h)).toContain('colonna sparita.');
    senzaNumero(h);
    expect(haClasse(h, 'dash-parziali')).toBe(false);
  });

  // Quello che il server fa davvero (Trasformazione.leggi): un having non vuoto senza op
  // valida, o senza valore, non e' «assente» ma un errore, e group a due colonne pure.
  it.each<[string, Trasformazione, string]>([
    ['having senza op', conFiltro({ value: 5 }), 'Il filtro sui gruppi non ha un confronto valido.'],
    ['having senza valore', conFiltro({ op: '>', value: '' }), 'Il filtro sui gruppi non ha un valore da confrontare.'],
    ['due colonne', { group: ['sede', 'anno'], agg: 'count' }, 'Per ora si raggruppa su una colonna sola.'],
  ])('errore del server: %s', async (_n, t, errore) => {
    const h = await html({ errore }, 'kpi', t);
    expect(testo(h)).toContain(errore);
    expect(haClasse(h, 'dash-numero')).toBe(false);
  });
});
