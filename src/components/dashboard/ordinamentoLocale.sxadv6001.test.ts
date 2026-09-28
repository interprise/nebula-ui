import { describe, it, expect, afterEach } from 'vitest';
import {
  ordinamentoVisualizzato,
  ordinaRighe,
  registraOrdinamentoLocale,
  leggiOrdinamentoLocale,
  registraOrdineColonne,
  leggiOrdineColonne,
} from './ordineColonne';

// SXADV-6001.0: lista in una pagina sola → AG Grid ordina nel browser e il server
// non lo sa; il widget deve rifare quell'ordinamento quando mostra le righe.

describe('SXADV-6001 ordinamentoVisualizzato', () => {
  const nomi = ['a', 'b', 'c', 'd'];

  it('nessun ordinamento → null', () => {
    expect(ordinamentoVisualizzato([], nomi)).toBeNull();
    expect(
      ordinamentoVisualizzato(
        [{ colId: 'col_0' }, { colId: 'col_1', sort: null }, { colId: 'col_2', sort: '' }],
        nomi,
      ),
    ).toBeNull();
  });

  it('una colonna ordinata → nome e verso', () => {
    expect(ordinamentoVisualizzato([{ colId: 'col_0' }, { colId: 'col_2', sort: 'desc' }], nomi)).toEqual({
      nome: 'c',
      verso: 'desc',
    });
    expect(ordinamentoVisualizzato([{ colId: 'col_1', sort: 'asc', sortIndex: 0 }], nomi)).toEqual({
      nome: 'b',
      verso: 'asc',
    });
  });

  it('sort diverso da asc/desc ignorato', () => {
    expect(
      ordinamentoVisualizzato([{ colId: 'col_0', sort: 'ASC' }, { colId: 'col_1', sort: 'x' }], nomi),
    ).toBeNull();
  });

  it('piu\' colonne: vince il sortIndex piu\' basso, non la posizione', () => {
    expect(
      ordinamentoVisualizzato(
        [
          { colId: 'col_0', sort: 'asc', sortIndex: 2 },
          { colId: 'col_3', sort: 'desc', sortIndex: 0 },
          { colId: 'col_1', sort: 'asc', sortIndex: 1 },
        ],
        nomi,
      ),
    ).toEqual({ nome: 'd', verso: 'desc' });
  });

  it('sortIndex mancante vale 0; a parita\' resta l\'ordine d\'ingresso', () => {
    expect(
      ordinamentoVisualizzato(
        [
          { colId: 'col_2', sort: 'asc', sortIndex: 1 },
          { colId: 'col_1', sort: 'desc' },
          { colId: 'col_0', sort: 'asc', sortIndex: null },
        ],
        nomi,
      ),
    ).toEqual({ nome: 'b', verso: 'desc' });
  });

  it('colId non col_<n> saltato: si passa al successivo', () => {
    expect(
      ordinamentoVisualizzato(
        [
          { colId: '_selnav', sort: 'asc', sortIndex: 0 },
          { colId: 'col_x', sort: 'asc', sortIndex: 1 },
          { colId: 'col_-1', sort: 'asc', sortIndex: 2 },
          { colId: 'col_1a', sort: 'asc', sortIndex: 3 },
          { colId: 'cont_1_2', sort: 'asc', sortIndex: 4 },
          { colId: 'col_3', sort: 'asc', sortIndex: 5 },
        ],
        nomi,
      ),
    ).toEqual({ nome: 'd', verso: 'asc' });
  });

  it('colonna senza nome saltata', () => {
    const n = ['a', '', null, undefined];
    expect(
      ordinamentoVisualizzato(
        [
          { colId: 'col_1', sort: 'asc', sortIndex: 0 },
          { colId: 'col_2', sort: 'asc', sortIndex: 1 },
          { colId: 'col_3', sort: 'asc', sortIndex: 2 },
          { colId: 'col_9', sort: 'asc', sortIndex: 3 },
          { colId: 'col_0', sort: 'desc', sortIndex: 4 },
        ],
        n,
      ),
    ).toEqual({ nome: 'a', verso: 'desc' });
  });

  it('nessuna colonna ordinata utilizzabile → null', () => {
    expect(ordinamentoVisualizzato([{ colId: '_selnav', sort: 'asc' }, { colId: 'col_9', sort: 'asc' }], nomi)).toBeNull();
  });

  it('non muta lo stato', () => {
    const stato = [
      { colId: 'col_0', sort: 'asc', sortIndex: 1 },
      { colId: 'col_1', sort: 'asc', sortIndex: 0 },
    ];
    const copia = JSON.parse(JSON.stringify(stato));
    ordinamentoVisualizzato(stato, nomi);
    expect(stato).toEqual(copia);
  });
});

type Cella = { t?: string; v?: unknown };
type Riga = { id: string; c?: Cella[] };
const riga = (id: string, ...c: Cella[]): Riga => ({ id, c });
const ids = (r: Riga[]) => r.map((x) => x.id);

describe('SXADV-6001 ordinaRighe', () => {
  const base = [riga('x', { t: 'b' }), riga('y', { t: 'a' }), riga('z', { t: 'c' })];

  it('sempre un array nuovo, ingresso intatto', () => {
    const copia = JSON.parse(JSON.stringify(base));
    const r = ordinaRighe(base, 0, 'asc');
    expect(r).not.toBe(base);
    expect(ids(r)).toEqual(['y', 'x', 'z']);
    expect(base).toEqual(copia);
    expect(r[0]).toBe(base[1]);
  });

  it.each([
    ['colonna null', null, 'asc'],
    ['colonna undefined', undefined, 'asc'],
    ['colonna negativa', -1, 'asc'],
    ['colonna non intera', 0.5, 'asc'],
    ['colonna NaN', NaN, 'asc'],
    ['verso null', 0, null],
    ['verso undefined', 0, undefined],
    ['verso estraneo', 0, 'ASC'],
  ])('%s → stesso ordine (copia)', (_n, col, verso) => {
    const r = ordinaRighe(base, col as number | null | undefined, verso as 'asc' | 'desc' | null | undefined);
    expect(ids(r)).toEqual(['x', 'y', 'z']);
    expect(r).not.toBe(base);
  });

  it('righe vuote → []', () => {
    expect(ordinaRighe([], 0, 'asc')).toEqual([]);
  });

  it('numeri: confronto numerico su v, non sul testo', () => {
    const r = [
      riga('dieci', { t: '10,00', v: 10 }),
      riga('due', { t: '2,00', v: 2 }),
      riga('mille', { t: '1.000,00', v: 1000 }),
      riga('meno', { t: '−5,00', v: -5 }),
    ];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['meno', 'due', 'dieci', 'mille']);
    expect(ids(ordinaRighe(r, 0, 'desc'))).toEqual(['mille', 'dieci', 'due', 'meno']);
  });

  it('booleani: false prima di true', () => {
    const r = [riga('si', { t: 'Sì', v: true }), riga('no', { t: 'No', v: false }), riga('si2', { t: 'Sì', v: true })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['no', 'si', 'si2']);
    expect(ids(ordinaRighe(r, 0, 'desc'))).toEqual(['si', 'si2', 'no']);
  });

  it('date ISO in v: ordine cronologico anche se il testo e\' dd/MM/yyyy', () => {
    const r = [
      riga('gen25', { t: '15/01/2025', v: '2025-01-15' }),
      riga('dic24', { t: '31/12/2024', v: '2024-12-31' }),
      riga('feb24', { t: '01/02/2024', v: '2024-02-01T10:00:00' }),
    ];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['feb24', 'dic24', 'gen25']);
    expect(ids(ordinaRighe(r, 0, 'desc'))).toEqual(['gen25', 'dic24', 'feb24']);
  });

  it('ore HH:mm:ss in v', () => {
    const r = [riga('b', { t: '9.05', v: '09:05:00' }), riga('a', { t: '10.00', v: '10:00:00' }), riga('c', { t: '8.59', v: '08:59:59' })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['c', 'b', 'a']);
  });

  it('v stringa non data/ora → si usa t', () => {
    const r = [riga('uno', { t: 'Zeta', v: 'aaa' }), riga('due', { t: 'Alfa', v: 'zzz' })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['due', 'uno']);
  });

  it('v non finito → si usa t', () => {
    const r = [riga('uno', { t: 'b', v: NaN }), riga('due', { t: 'a', v: Infinity })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['due', 'uno']);
  });

  it('testo: collatore italiano numerico, senza maiuscole ne\' accenti', () => {
    const r = [riga('a10', { t: 'a10' }), riga('a2', { t: 'a2' }), riga('a1', { t: 'a1' })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['a1', 'a2', 'a10']);
    const m = [riga('Bmaiu', { t: 'B' }), riga('c', { t: 'c' }), riga('bmin', { t: 'b' }), riga('A', { t: 'A' })];
    expect(ids(ordinaRighe(m, 0, 'asc'))).toEqual(['A', 'Bmaiu', 'bmin', 'c']);
    const acc = [riga('f', { t: 'f' }), riga('è', { t: 'è' }), riga('d', { t: 'd' })];
    expect(ids(ordinaRighe(acc, 0, 'asc'))).toEqual(['d', 'è', 'f']);
  });

  it('testo rifilato', () => {
    const r = [riga('b', { t: 'b' }), riga('a', { t: '   a  ' })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['a', 'b']);
  });

  it('stabile: chiavi uguali (anche B/b) tengono l\'ordine d\'ingresso in entrambi i versi', () => {
    const r = [
      riga('B1', { t: 'B' }),
      riga('a', { t: 'a' }),
      riga('b2', { t: 'b' }),
      riga('B3', { t: 'B' }),
    ];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['a', 'B1', 'b2', 'B3']);
    expect(ids(ordinaRighe(r, 0, 'desc'))).toEqual(['B1', 'b2', 'B3', 'a']);
    const n = [riga('p', { v: 5 }), riga('q', { v: 1 }), riga('r', { v: 5 })];
    expect(ids(ordinaRighe(n, 0, 'desc'))).toEqual(['p', 'r', 'q']);
  });

  it('vuoti sempre in fondo, in entrambi i versi', () => {
    const r = [
      riga('vuoto1', { t: '' }),
      riga('b', { t: 'b' }),
      { id: 'senzaC' } as Riga,
      riga('spazi', { t: '   ' }),
      riga('a', { t: 'a' }),
      riga('nullo', { t: '', v: null }),
      riga('senzaCella'),
    ];
    const asc = ids(ordinaRighe(r, 0, 'asc'));
    const desc = ids(ordinaRighe(r, 0, 'desc'));
    const vuoti = ['vuoto1', 'senzaC', 'spazi', 'nullo', 'senzaCella'];
    expect(asc).toEqual(['a', 'b', ...vuoti]);
    expect(desc).toEqual(['b', 'a', ...vuoti]);
  });

  it('vuoti in fondo anche con chiavi numeriche', () => {
    const r = [riga('v', { t: '' }), riga('uno', { v: 1 }), riga('tre', { v: 3 })];
    expect(ids(ordinaRighe(r, 0, 'asc'))).toEqual(['uno', 'tre', 'v']);
    expect(ids(ordinaRighe(r, 0, 'desc'))).toEqual(['tre', 'uno', 'v']);
  });

  it('colonna indicata, non la prima', () => {
    const r = [riga('x', { t: 'a' }, { v: 3 }), riga('y', { t: 'b' }, { v: 1 }), riga('z', { t: 'c' }, { v: 2 })];
    expect(ids(ordinaRighe(r, 1, 'asc'))).toEqual(['y', 'z', 'x']);
  });

  it('colonna fuori intervallo → tutte vuote → ordine d\'ingresso', () => {
    expect(ids(ordinaRighe(base, 7, 'asc'))).toEqual(['x', 'y', 'z']);
    expect(ids(ordinaRighe(base, 7, 'desc'))).toEqual(['x', 'y', 'z']);
  });

  it('conserva gli oggetti riga', () => {
    const r = ordinaRighe(base, 0, 'desc');
    expect(ids(r)).toEqual(['z', 'x', 'y']);
    expect(r[0]).toBe(base[2]);
  });
});

describe('SXADV-6001 registro ordinamento locale', () => {
  const rimuovi: Array<() => void> = [];
  afterEach(() => {
    while (rimuovi.length) rimuovi.pop()!();
  });
  type Ord = ReturnType<typeof leggiOrdinamentoLocale>;
  const reg = (sid: string, f: () => Ord) => {
    const u = registraOrdinamentoLocale(sid, f);
    rimuovi.push(u);
    return u;
  };
  const o = (nome: string, verso: 'asc' | 'desc' = 'asc') => ({ nome, verso }) as unknown as Ord;

  it('niente registrato → null', () => {
    expect(leggiOrdinamentoLocale('L_mai')).toBeNull();
  });

  it('letto al momento della chiamata', () => {
    let attuale: Ord = o('a');
    reg('L1', () => attuale);
    expect(leggiOrdinamentoLocale('L1')).toEqual(o('a'));
    attuale = o('b', 'desc');
    expect(leggiOrdinamentoLocale('L1')).toEqual(o('b', 'desc'));
    attuale = null;
    expect(leggiOrdinamentoLocale('L1')).toBeNull();
  });

  it('getter che lancia → null', () => {
    reg('L2', () => {
      throw new Error('griglia smontata');
    });
    expect(leggiOrdinamentoLocale('L2')).toBeNull();
  });

  it('la seconda registrazione sostituisce la prima', () => {
    reg('L3', () => o('vecchio'));
    reg('L3', () => o('nuovo'));
    expect(leggiOrdinamentoLocale('L3')).toEqual(o('nuovo'));
  });

  it('deregistrare toglie la voce; il deregistra vecchio non toglie la nuova', () => {
    const u = registraOrdinamentoLocale('L4', () => o('x'));
    u();
    expect(leggiOrdinamentoLocale('L4')).toBeNull();
    const vecchio = registraOrdinamentoLocale('L5', () => o('vecchio'));
    reg('L5', () => o('nuovo'));
    vecchio();
    expect(leggiOrdinamentoLocale('L5')).toEqual(o('nuovo'));
  });

  it('sid indipendenti', () => {
    reg('L6', () => o('sei'));
    const u7 = registraOrdinamentoLocale('L7', () => o('sette'));
    u7();
    expect(leggiOrdinamentoLocale('L7')).toBeNull();
    expect(leggiOrdinamentoLocale('L6')).toEqual(o('sei'));
  });

  it('indipendente dal registro dell\'ordine colonne', () => {
    reg('X1', () => o('ord'));
    expect(leggiOrdineColonne('X1')).toBeNull();
    const uc = registraOrdineColonne('X1', () => ['c1', 'c0']);
    rimuovi.push(uc);
    expect(leggiOrdinamentoLocale('X1')).toEqual(o('ord'));
    expect(leggiOrdineColonne('X1')).toEqual(['c1', 'c0']);
    uc();
    expect(leggiOrdinamentoLocale('X1')).toEqual(o('ord'));
    const ul = registraOrdinamentoLocale('X2', () => o('solo'));
    ul();
    registraOrdineColonne('X2', () => ['z'])();
    expect(leggiOrdinamentoLocale('X2')).toBeNull();
    expect(leggiOrdineColonne('X2')).toBeNull();
  });
});
