import { describe, it, expect } from 'vitest';
import {
  EMPTY_SEARCH,
  locateParams,
  notFoundMessage,
  pathAtPosition,
  positionOfPath,
  readLocated,
  searchKey,
  showsListSearch,
  stoppedMessage,
  searchColumns,
} from './listSearch';

// SXADV-4569 — «Cerca» di una lista: le regole pure del client.
// Chi prova non e' chi implementa: questi test seguono il contratto
// (testo uguale = trova il successivo, testo nuovo = dall'inizio, una
// continuazione porta from=position e done=scanned, la posizione del rigo e'
// il numero in coda al percorso, il campo compare con almeno due record).

describe('readLocated', () => {
  it('legge located dalla radice della risposta', () => {
    expect(readLocated({ located: { found: true, more: false, position: 57, scanned: 58 } }))
      .toEqual({ found: true, more: false, position: 57, scanned: 58 });
  });

  it('risposta senza located -> null (la ricerca si ferma)', () => {
    expect(readLocated({ ui: {} })).toBeNull();
    expect(readLocated(undefined)).toBeNull();
    expect(readLocated(null)).toBeNull();
    expect(readLocated(false)).toBeNull();
    expect(readLocated({ located: null })).toBeNull();
    expect(readLocated({ located: 'x' })).toBeNull();
  });

  it('non trovato', () => {
    const r = readLocated({ located: { found: false, more: false, position: -1, scanned: 1000 } });
    expect(r).toEqual({ found: false, more: false, position: -1, scanned: 1000 });
  });

  it('continuazione', () => {
    const r = readLocated({ located: { found: false, more: true, position: 199, scanned: 200 } });
    expect(r?.more).toBe(true);
    expect(r?.found).toBe(false);
    expect(r?.position).toBe(199);
    expect(r?.scanned).toBe(200);
  });

  it('campi mancanti o di tipo sbagliato non diventano "trovato"', () => {
    const r = readLocated({ located: {} });
    expect(r).not.toBeNull();
    expect(r?.found).toBe(false);
    expect(r?.more).toBe(false);
    expect(r?.position).toBe(-1);
    const s = readLocated({ located: { found: 'true', more: 'true', position: '5' } });
    expect(s?.found).toBe(false);
    expect(s?.more).toBe(false);
  });
});

describe('searchKey', () => {
  it('spazi agli estremi tolti, serie di spazi ridotte a uno', () => {
    expect(searchKey('  rossi  ')).toBe('rossi');
    expect(searchKey('rossi   mario')).toBe('rossi mario');
    expect(searchKey('\trossi \n mario ')).toBe('rossi mario');
    expect(searchKey('   ')).toBe('');
  });
});

describe('locateParams', () => {
  const LIST = 'S1-0.2,S1-3';

  it('prima ricerca: dall\'inizio, navpath e testo', () => {
    const p = locateParams(LIST, 'rossi', EMPTY_SEARCH);
    expect(p.navpath).toBe(LIST);
    expect(p.option1).toBe('rossi');
    expect(p.from).toBe('-1');
    expect(p.done).toBeUndefined();
  });

  it('stesso testo dell\'ultima ricerca: from = ultimo rigo trovato (trova il successivo)', () => {
    const p = locateParams(LIST, 'rossi', { text: 'rossi', lastFound: 57 });
    expect(p.from).toBe('57');
    expect(p.done).toBeUndefined();
  });

  it('stesso testo a meno di spazi: e\' la stessa ricerca', () => {
    expect(locateParams(LIST, '  rossi ', { text: 'rossi', lastFound: 12 }).from).toBe('12');
    expect(locateParams(LIST, 'rossi   mario', { text: 'rossi mario', lastFound: 3 }).from).toBe('3');
  });

  it('il testo spedito e\' quello ripulito', () => {
    expect(locateParams(LIST, '  rossi   mario ', EMPTY_SEARCH).option1).toBe('rossi mario');
  });

  it('testo diverso: ricomincia dall\'inizio', () => {
    expect(locateParams(LIST, 'bianchi', { text: 'rossi', lastFound: 57 }).from).toBe('-1');
    expect(locateParams(LIST, 'ross', { text: 'rossi', lastFound: 57 }).from).toBe('-1');
  });

  it('stesso testo ma ultima ricerca senza esito: dall\'inizio', () => {
    expect(locateParams(LIST, 'rossi', { text: 'rossi', lastFound: -1 }).from).toBe('-1');
  });

  it('continuazione: from = position, done = scanned', () => {
    const p = locateParams(LIST, 'rossi', EMPTY_SEARCH, { position: 199, scanned: 200 });
    expect(p.from).toBe('199');
    expect(p.done).toBe('200');
    expect(p.option1).toBe('rossi');
    expect(p.navpath).toBe(LIST);
  });

  it('continuazione di un "trova il successivo": vale la continuazione, non lastFound', () => {
    const p = locateParams(LIST, 'rossi', { text: 'rossi', lastFound: 57 }, { position: 457, scanned: 400 });
    expect(p.from).toBe('457');
    expect(p.done).toBe('400');
  });

  it('i valori sono stringhe (parametri di richiesta)', () => {
    const p = locateParams(LIST, 'x', { text: 'x', lastFound: 0 }, { position: 0, scanned: 1 });
    for (const v of Object.values(p)) expect(typeof v).toBe('string');
    expect(p.from).toBe('0');
  });
});

describe('positionOfPath / pathAtPosition', () => {
  it('il numero in coda e\' la posizione assoluta', () => {
    expect(positionOfPath('S1-0.2,S1-3.57')).toBe(57);
    expect(positionOfPath('S1-3.0')).toBe(0);
    expect(positionOfPath('S1-3.1234')).toBe(1234);
    expect(positionOfPath('S2-0.1,S2-4.0,S2-7.12')).toBe(12);
  });

  it('non e\' il numero del primo segmento', () => {
    // "S1-0.2,S1-3" e' il percorso della lista: nessuna posizione di riga in coda.
    expect(positionOfPath('S1-0.2,S1-3')).toBeNull();
    expect(positionOfPath('S1-3')).toBeNull();
    expect(positionOfPath('')).toBeNull();
  });

  it('trova il percorso della riga fra quelli della pagina', () => {
    const page = ['S1-0.2,S1-3.100', 'S1-0.2,S1-3.101', 'S1-0.2,S1-3.157', 'S1-0.2,S1-3.199'];
    expect(pathAtPosition(page, 157)).toBe('S1-0.2,S1-3.157');
    expect(pathAtPosition(page, 100)).toBe('S1-0.2,S1-3.100');
  });

  it('niente confusione fra 15 e 157, 1 e 101', () => {
    const page = ['S1-3.101', 'S1-3.157', 'S1-3.15', 'S1-3.1'];
    expect(pathAtPosition(page, 15)).toBe('S1-3.15');
    expect(pathAtPosition(page, 1)).toBe('S1-3.1');
    expect(pathAtPosition(page, 157)).toBe('S1-3.157');
  });

  it('la riga non e\' nella pagina caricata -> undefined', () => {
    expect(pathAtPosition(['S1-3.0', 'S1-3.1'], 57)).toBeUndefined();
    expect(pathAtPosition([], 0)).toBeUndefined();
  });
});

describe('notFoundMessage', () => {
  it('nomina il testo cercato, ripulito', () => {
    const m = notFoundMessage('  rossi   mario ');
    expect(m).toContain('rossi mario');
    expect(m).not.toContain('  ');
  });
});

describe('showsListSearch', () => {
  it('almeno due record', () => {
    expect(showsListSearch(0)).toBe(false);
    expect(showsListSearch(1)).toBe(false);
    expect(showsListSearch(2)).toBe(true);
    expect(showsListSearch(1000)).toBe(true);
  });
});

describe('revisione: stesso testo senza maiuscole e accenti', () => {
  const LIST = 'S1-3';
  it.each([
    ['citta', 'città'],
    ['città', 'citta'],
    ['CITTÀ', 'citta'],
    ['Perché', 'perche'],
    ['ROSSI', 'rossi'],
    ['  Città  di  Castello ', 'citta di castello'],
  ])('«%s» dopo «%s»: from = ultimo trovato', (text, memo) => {
    expect(locateParams(LIST, text, { text: memo, lastFound: 57 }).from).toBe('57');
  });

  it('il testo spedito resta quello battuto (ripulito degli spazi), non quello piegato', () => {
    expect(locateParams(LIST, ' Città ', EMPTY_SEARCH).option1).toBe('Città');
  });

  it('lettere diverse restano testi diversi', () => {
    expect(locateParams(LIST, 'citte', { text: 'citta', lastFound: 57 }).from).toBe('-1');
    expect(locateParams(LIST, 'cita', { text: 'citta', lastFound: 57 }).from).toBe('-1');
  });
});

describe('stoppedMessage', () => {
  it('nomina il testo ripulito e dice che Invio continua', () => {
    const m = stoppedMessage('  rossi   mario ');
    expect(m).toContain('rossi mario');
    expect(m).not.toContain('  ');
    expect(m).toMatch(/Invio/);
  });

  it('e\' diverso dal messaggio di non trovato', () => {
    expect(stoppedMessage('x')).not.toBe(notFoundMessage('x'));
  });
});

describe('locateParams all\'indietro', () => {
  const LIST = 'S1-0.2,S1-3';
  it('backward aggiunge dir=-1', () => {
    expect(locateParams(LIST, 'rossi', EMPTY_SEARCH, undefined, true).dir).toBe('-1');
  });

  it('senza backward (o false) nessun dir negativo', () => {
    for (const p of [locateParams(LIST, 'rossi', EMPTY_SEARCH), locateParams(LIST, 'rossi', EMPTY_SEARCH, undefined, false)]) {
      expect(p.dir === undefined || Number(p.dir) > 0).toBe(true);
    }
  });

  it('la logica di from e\' la stessa: testo nuovo -1, stesso testo lastFound, continuazione position/done', () => {
    expect(locateParams(LIST, 'rossi', EMPTY_SEARCH, undefined, true).from).toBe('-1');
    expect(locateParams(LIST, 'bianchi', { text: 'rossi', lastFound: 57 }, undefined, true).from).toBe('-1');
    expect(locateParams(LIST, 'Rossi', { text: 'rossi', lastFound: 57 }, undefined, true).from).toBe('57');
    const c = locateParams(LIST, 'rossi', { text: 'rossi', lastFound: 57 }, { position: 800, scanned: 200 }, true);
    expect(c).toEqual({ navpath: LIST, option1: 'rossi', from: '800', done: '200', dir: '-1' });
  });

  it('a parte dir, i parametri sono identici a quelli in avanti', () => {
    const mem = { text: 'rossi', lastFound: 9 };
    const fwd = locateParams(LIST, ' rossi ', mem, { position: 3, scanned: 4 });
    const bwd = locateParams(LIST, ' rossi ', mem, { position: 3, scanned: 4 }, true);
    const { dir, ...rest } = bwd;
    expect(dir).toBe('-1');
    expect(rest).toEqual(fwd);
  });
});

describe('locateParams: col', () => {
  const LIST = 'S1-3';
  it('column vuota (o assente): niente col', () => {
    expect(locateParams(LIST, 'x', EMPTY_SEARCH).col).toBeUndefined();
    expect(locateParams(LIST, 'x', EMPTY_SEARCH, undefined, false, '').col).toBeUndefined();
    expect('col' in locateParams(LIST, 'x', EMPTY_SEARCH, undefined, true, '')).toBe(false);
  });

  it('column data: col=<column>, in avanti e all\'indietro', () => {
    expect(locateParams(LIST, 'x', EMPTY_SEARCH, undefined, false, 'descrizione').col).toBe('descrizione');
    expect(locateParams(LIST, 'x', EMPTY_SEARCH, undefined, true, 'descrizione')).toMatchObject({ col: 'descrizione', dir: '-1' });
  });

  it('anche nelle continuazioni', () => {
    expect(locateParams(LIST, 'x', EMPTY_SEARCH, { position: 199, scanned: 200 }, false, 'citta'))
      .toEqual({ navpath: LIST, option1: 'x', from: '199', done: '200', col: 'citta' });
  });

  it('la logica di from non cambia con col', () => {
    expect(locateParams(LIST, 'x', { text: 'x', lastFound: 7 }, undefined, false, 'citta').from).toBe('7');
    expect(locateParams(LIST, 'y', { text: 'x', lastFound: 7 }, undefined, false, 'citta').from).toBe('-1');
  });
});

describe('searchColumns', () => {
  const id = (raw: string) => raw;
  const never = () => false;

  it('nome ed etichetta nell\'ordine delle intestazioni', () => {
    expect(searchColumns([
      { name: 'codice', text: 'Codice' },
      { name: 'descrizione', text: 'Descrizione' },
    ], id, never)).toEqual([
      { name: 'codice', label: 'Codice' },
      { name: 'descrizione', label: 'Descrizione' },
    ]);
  });

  it('headers assenti o vuoti: nessuna colonna', () => {
    expect(searchColumns(undefined, id, never)).toEqual([]);
    expect(searchColumns([], id, never)).toEqual([]);
  });

  it('toglie il selettore e le intestazioni senza name', () => {
    expect(searchColumns([
      { type: 'selector', name: 'sel', text: 'Sel' },
      { text: 'Senza nome' },
      { name: '', text: 'Nome vuoto' },
      { name: 'codice', text: 'Codice' },
    ], id, never)).toEqual([{ name: 'codice', label: 'Codice' }]);
  });

  it('nomi ripetuti: tiene il primo', () => {
    expect(searchColumns([
      { name: 'codice', text: 'Codice' },
      { name: 'descrizione', text: 'Descrizione' },
      { name: 'codice', text: 'Codice bis' },
    ], id, never)).toEqual([
      { name: 'codice', label: 'Codice' },
      { name: 'descrizione', label: 'Descrizione' },
    ]);
  });

  it('isBoolean riceve l\'indice delle intestazioni ORIGINALI, selettore compreso', () => {
    const seen: number[] = [];
    const out = searchColumns([
      { type: 'selector', name: 'sel', text: '' },
      { name: 'codice', text: 'Codice' },
      { name: 'attivo', text: 'Attivo' },
      { name: 'descrizione', text: 'Descrizione' },
    ], id, (idx) => { seen.push(idx); return idx === 2; });
    expect(out).toEqual([
      { name: 'codice', label: 'Codice' },
      { name: 'descrizione', label: 'Descrizione' },
    ]);
    expect(seen).toContain(1);
    expect(seen).toContain(2);
    expect(seen).toContain(3);
  });

  it('etichetta vuota dopo label(text).trim(): via', () => {
    const label = (raw: string) => raw.replace(/<[^>]*>/g, '');
    expect(searchColumns([
      { name: 'icona', text: '<img src="x.png">' },
      { name: 'spazi', text: '   ' },
      { name: 'manca' },
      { name: 'codice', text: '<b>Codice</b> ' },
    ], label, never)).toEqual([{ name: 'codice', label: 'Codice' }]);
  });

  it('l\'etichetta e\' quella di label(), ripulita agli estremi', () => {
    expect(searchColumns([{ name: 'tel', text: 'Telefono: <img src="t.png">' }],
      (raw) => raw.replace(/<[^>]*>/g, ''), never)).toEqual([{ name: 'tel', label: 'Telefono:' }]);
  });
});

describe('searchColumns: colonne non cercabili (searchable: false)', () => {
  const id = (raw: string) => raw;
  it('scarta le intestazioni con searchable === false, tiene quelle senza il campo o true', () => {
    expect(searchColumns([
      { name: 'codice', text: 'Codice' },
      { name: 'note', text: 'Note', searchable: false },
      { name: 'descrizione', text: 'Descrizione', searchable: true },
    ] as { name?: string; text?: string; type?: string; searchable?: boolean }[], id, () => false)).toEqual([
      { name: 'codice', label: 'Codice' },
      { name: 'descrizione', label: 'Descrizione' },
    ]);
  });

  it('una non cercabile in mezzo: le altre restano, nell\'ordine', () => {
    const out = searchColumns([
      { name: 'codice', text: 'Codice' },
      { name: 'stato', text: 'Stato', searchable: false },
      { name: 'descrizione', text: 'Descrizione' },
    ] as { name?: string; text?: string; type?: string; searchable?: boolean }[], id, () => false);
    expect(out.map((c) => c.name)).toEqual(['codice', 'descrizione']);
  });
});
