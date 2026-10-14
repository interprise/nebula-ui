import { describe, it, expect } from 'vitest';
import {
  completaOrdine,
  normalizzaVista,
  colonneMostrate,
  prossimoOrdinamento,
  spostaColonna,
  larghezzaValida,
  type VistaTabella,
} from './vistaTabella';

// SXADV-6001 .1ab .2 .3 .4 .6 — la vista della tabella del widget (COLONNE_contratto.md, V2 e V5).
//
// Chi prova non e' chi implementa: queste prove sono scritte dal CONTRATTO, senza leggere
// vistaTabella.ts. Dove il contratto ammette due letture la prova accetta l'una e l'altra e lo
// dice nel nome del caso («ambiguo: ...»); il resto e' stretto.
//
// Decisioni della prova (dichiarate):
//   - «px interi» (larghezzaValida): un numero non intero si arrotonda al PIU' VICINO, con la
//     meta' verso l'alto (Math.round / Java Math.round): 100,4 -> 100, 100,5 -> 101, 39,6 -> 40.
//   - «intero» vuol dire un numero JS intero (Number.isInteger): "1" (stringa), 1.5, NaN,
//     Infinity, true, null non sono indici.
//   - «input non oggetto» comprende gli array: V3 vuole un «oggetto JSON», e [] non lo e'.
//   - Le funzioni sono «pure»: non cambiano gli argomenti.

/** Ogni indice 0..n-1 una volta sola. */
const permutazioneDi = (r: number[], n: number) =>
  r.length === n && [...r].sort((a, b) => a - b).every((v, i) => v === i);
const insieme = (a: number[] | undefined) => [...new Set(a || [])].sort((x, y) => x - y);

// ═══════════════════════════════════════════════════════════════ completaOrdine

describe('SXADV-6001 completaOrdine (V2 «ordine completato»)', () => {
  it('permutazione completa: resta com\'e\'', () => {
    expect(completaOrdine([2, 0, 1, 3], 4)).toEqual([2, 0, 1, 3]);
    expect(completaOrdine([3, 2, 1, 0], 4)).toEqual([3, 2, 1, 0]);
    expect(completaOrdine([0, 1, 2], 3)).toEqual([0, 1, 2]);
  });

  it('parziale: i mancanti si accodano in ordine crescente', () => {
    expect(completaOrdine([2], 4)).toEqual([2, 0, 1, 3]);
    expect(completaOrdine([3, 1], 5)).toEqual([3, 1, 0, 2, 4]);
    expect(completaOrdine([4, 0], 5)).toEqual([4, 0, 1, 2, 3]);
  });

  it('fuori da [0, n) scartati (anche negativi e uguali a n)', () => {
    expect(completaOrdine([5, 2, -1, 4, 1], 4)).toEqual([2, 1, 0, 3]);
    expect(completaOrdine([4, 3], 4)).toEqual([3, 0, 1, 2]);
    expect(completaOrdine([-0.0 + 1, 99, -99], 3)).toEqual([1, 0, 2]);
  });

  it('doppioni: vale la prima comparsa', () => {
    expect(completaOrdine([2, 2, 0, 2, 0], 4)).toEqual([2, 0, 1, 3]);
    expect(completaOrdine([1, 0, 1], 2)).toEqual([1, 0]);
  });

  it('non interi scartati: decimali, stringhe, NaN, Infinity, booleani, null, oggetti', () => {
    expect(completaOrdine([1.5, '2', NaN, Infinity, -Infinity, true, null, {}, [1], 3, 1], 4)).toEqual([3, 1, 0, 2]);
    expect(completaOrdine(['0', '1', '2'] as unknown, 3)).toEqual([0, 1, 2]);
  });

  it('2.0 e\' un intero (in JS e\' 2)', () => {
    expect(completaOrdine([2.0, 0], 3)).toEqual([2, 0, 1]);
  });

  it('n = 0 → []', () => {
    expect(completaOrdine([0, 1], 0)).toEqual([]);
    expect(completaOrdine(null, 0)).toEqual([]);
    expect(completaOrdine(undefined, 0, [0])).toEqual([]);
  });

  it('n = 1 → [0]', () => {
    expect(completaOrdine([0], 1)).toEqual([0]);
    expect(completaOrdine([3, 0, 0], 1)).toEqual([0]);
    expect(completaOrdine(null, 1)).toEqual([0]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa', '2,0,1'],
    ['stringa JSON', '[2,0,1]'],
    ['numero', 2],
    ['oggetto', { 0: 2, 1: 0 }],
    ['booleano', true],
  ])('ordine %s (non un array) senza riserva → 0..n-1', (_n, ordine) => {
    expect(completaOrdine(ordine, 3)).toEqual([0, 1, 2]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa', '[2,0,1]'],
    ['oggetto', {}],
  ])('ordine %s (non un array) → si parte dalla riserva (6001.0) valida', (_n, ordine) => {
    expect(completaOrdine(ordine, 3, [2, 0, 1])).toEqual([2, 0, 1]);
    expect(completaOrdine(ordine, 4, [3, 2, 1, 0])).toEqual([3, 2, 1, 0]);
  });

  it('ordine valido: la riserva non conta', () => {
    expect(completaOrdine([1, 0, 2], 3, [2, 1, 0])).toEqual([1, 0, 2]);
    expect(completaOrdine([2], 3, [1, 0, 2])).toEqual([2, 0, 1]);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa', '2,0,1'],
    ['oggetto', { a: 1 }],
  ])('niente ordine e riserva %s (non valida) → 0..n-1', (_n, riserva) => {
    expect(completaOrdine(undefined, 3, riserva)).toEqual([0, 1, 2]);
  });

  it('riserva parziale/storta: o completata come l\'ordine o scartata per 0..n-1 (ambiguo: «se valido»)', () => {
    // [1] su n=3: completata -> [1,0,2]; scartata perche' non e' una permutazione -> [0,1,2]
    expect([[1, 0, 2], [0, 1, 2]]).toContainEqual(completaOrdine(null, 3, [1]));
    expect([[2, 0, 1], [0, 1, 2]]).toContainEqual(completaOrdine(null, 3, [2, 2, 9, 0]));
  });

  it('ordine array ma senza nessun indice buono: riserva o 0..n-1 (ambiguo: «senza ordineColonne valido»)', () => {
    expect([[2, 0, 1], [0, 1, 2]]).toContainEqual(completaOrdine([], 3, [2, 0, 1]));
    expect([[2, 0, 1], [0, 1, 2]]).toContainEqual(completaOrdine([7, 'x', -1], 3, [2, 0, 1]));
    // senza riserva le due letture coincidono
    expect(completaOrdine([], 3)).toEqual([0, 1, 2]);
    expect(completaOrdine([7, 'x', -1], 3)).toEqual([0, 1, 2]);
  });

  it('il risultato e\' sempre una permutazione di 0..n-1 (campionatura di ingressi storti)', () => {
    const ingressi: unknown[] = [
      null, undefined, [], [0], [9, 9, 9], [-1, 0.5, '3'], [5, 4, 3, 2, 1, 0], 'x', {}, [NaN, 2, 2],
    ];
    for (const n of [0, 1, 2, 3, 6]) {
      for (const o of ingressi) {
        for (const r of ingressi) {
          const out = completaOrdine(o, n, r);
          expect(permutazioneDi(out, n), `n=${n} ordine=${JSON.stringify(o)} riserva=${JSON.stringify(r)} -> ${JSON.stringify(out)}`).toBe(true);
        }
      }
    }
  });

  it('pura: non cambia gli argomenti, e torna un array nuovo', () => {
    const o = [2, 9, 2];
    const r = [1, 0, 2];
    const out = completaOrdine(o, 3, r);
    expect(o).toEqual([2, 9, 2]);
    expect(r).toEqual([1, 0, 2]);
    expect(out).not.toBe(o);
    const perm = [1, 0, 2];
    expect(completaOrdine(perm, 3)).not.toBe(perm);
  });
});

// ═══════════════════════════════════════════════════════════════ normalizzaVista

describe('SXADV-6001 normalizzaVista (V2 per intero)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['stringa', '{"nascoste":[1]}'],
    ['numero', 3],
    ['booleano', true],
    ['array', [1, 2]],
    ['array vuoto', []],
    ['oggetto vuoto', {}],
  ])('%s → null', (_n, v) => {
    expect(normalizzaVista(v, 4)).toBeNull();
  });

  it('solo chiavi sconosciute → null', () => {
    expect(normalizzaVista({ pippo: 1, colonne: [0] }, 4)).toBeNull();
  });

  it('chiavi sconosciute tolte accanto alle buone', () => {
    const r = normalizzaVista({ pippo: 1, nascoste: [1] }, 4) as Record<string, unknown>;
    expect(r).not.toBeNull();
    expect('pippo' in r).toBe(false);
    expect(insieme(r.nascoste as number[])).toEqual([1]);
  });

  it('chiavi vuote dopo la pulizia non si scrivono (tutto vuoto → null)', () => {
    expect(normalizzaVista({ nascoste: [] }, 4)).toBeNull();
    expect(normalizzaVista({ nascoste: [7, -1, 'a'] }, 4)).toBeNull();
    expect(normalizzaVista({ larghezze: {} }, 4)).toBeNull();
    expect(normalizzaVista({ larghezze: { 9: 100, x: 100, '-1': 100 } }, 4)).toBeNull();
    expect(normalizzaVista({ larghezze: { 1: 'largo', 2: null, 3: true } }, 4)).toBeNull();
    expect(normalizzaVista({ ordinamento: { colonna: 9, verso: 'asc' } }, 4)).toBeNull();
    expect(normalizzaVista({ nascoste: [], larghezze: {}, ordinamento: { colonna: 1, verso: 'su' } }, 4)).toBeNull();
  });

  it('una vista gia\' pulita torna uguale', () => {
    const v = {
      ordineColonne: [2, 0, 1, 3],
      nascoste: [3],
      ordinamento: { colonna: 1, verso: 'desc' as const },
      larghezze: { 0: 180, 2: 64 },
    };
    const r = normalizzaVista(v, 4)!;
    expect(r.ordineColonne).toEqual([2, 0, 1, 3]);
    expect(insieme(r.nascoste)).toEqual([3]);
    expect(r.ordinamento).toEqual({ colonna: 1, verso: 'desc' });
    expect(r.larghezze).toEqual({ '0': 180, '2': 64 });
  });

  it('l\'esempio del contratto (V1) e\' gia\' normalizzato', () => {
    const v = JSON.parse('{"ordineColonne":[2,0,1,3],"nascoste":[3],"ordinamento":{"colonna":1,"verso":"desc"},"larghezze":{"0":180,"2":64}}');
    const r = normalizzaVista(v, 4);
    expect(r).toEqual(v);
  });

  it('idempotente: normalizzare due volte = una', () => {
    const casi: unknown[] = [
      { ordineColonne: [3, 3, 9], nascoste: [0, 0, 9], ordinamento: { colonna: 2, verso: 'asc' }, larghezze: { 1: 20, 2: 999.6, 7: 100 } },
      { ordineColonne: [1] },
      { nascoste: [0, 1, 2, 3] },
      { ordinamento: { colonna: null } },
      { larghezze: { 0: 123.4 } },
    ];
    for (const c of casi) {
      const una = normalizzaVista(c, 4);
      expect(normalizzaVista(una, 4), JSON.stringify(c)).toEqual(una);
    }
  });

  it('pura: non cambia la vista passata', () => {
    const v = { ordineColonne: [3, 3, 9], nascoste: [0, 9], ordinamento: { colonna: 9, verso: 'asc' }, larghezze: { 0: 5, 9: 100 } };
    const copia = JSON.parse(JSON.stringify(v));
    normalizzaVista(v, 4);
    expect(v).toEqual(copia);
  });

  // ─── ordineColonne
  describe('ordineColonne', () => {
    it('parziale → completato (mancanti in coda, crescenti)', () => {
      expect(normalizzaVista({ ordineColonne: [2] }, 4)?.ordineColonne).toEqual([2, 0, 1, 3]);
      expect(normalizzaVista({ ordineColonne: [3, 1] }, 4)?.ordineColonne).toEqual([3, 1, 0, 2]);
    });

    it('doppioni, fuori intervallo, non interi tolti', () => {
      expect(normalizzaVista({ ordineColonne: [1, 1, 7, -2, 0.5, '3', null, 3] }, 4)?.ordineColonne).toEqual([1, 3, 0, 2]);
    });

    it('6001.1c ha allungato le colonne: gli indici nuovi si accodano', () => {
      // vista salvata quando le colonne erano 3; ora sono 5
      expect(normalizzaVista({ ordineColonne: [2, 0, 1] }, 5)?.ordineColonne).toEqual([2, 0, 1, 3, 4]);
    });

    it('le colonne si sono accorciate: gli indici che non ci sono piu\' cadono', () => {
      expect(normalizzaVista({ ordineColonne: [4, 3, 2, 1, 0] }, 3)?.ordineColonne).toEqual([2, 1, 0]);
    });

    it('assente: non compare', () => {
      const r = normalizzaVista({ nascoste: [1] }, 4)!;
      expect(r.ordineColonne).toBeUndefined();
    });

    it('non un array: come assente', () => {
      for (const o of ['2,0,1', 3, { 0: 1 }, null, true]) {
        const r = normalizzaVista({ ordineColonne: o, nascoste: [1] }, 4)!;
        expect(r.ordineColonne, JSON.stringify(o)).toBeUndefined();
      }
    });

    it('array senza indici buoni: assente oppure 0..n-1 (ambiguo)', () => {
      const r = normalizzaVista({ ordineColonne: [9, 'x'], nascoste: [1] }, 3)!;
      expect([undefined, [0, 1, 2]]).toContainEqual(r.ordineColonne);
    });

    it('sempre una permutazione di 0..n-1 quando c\'e\'', () => {
      for (const o of [[0], [5, 5, 1], [2, 1, 0, 3, 3], [-1, 1.2, 2]]) {
        const r = normalizzaVista({ ordineColonne: o }, 4);
        if (r?.ordineColonne) expect(permutazioneDi(r.ordineColonne, 4), JSON.stringify(o)).toBe(true);
      }
    });
  });

  // ─── nascoste
  describe('nascoste', () => {
    it('fuori da [0, n) ignorate', () => {
      expect(insieme(normalizzaVista({ nascoste: [1, 4, -1, 99] }, 4)?.nascoste)).toEqual([1]);
    });

    it('non interi ignorati', () => {
      expect(insieme(normalizzaVista({ nascoste: [0.5, '2', NaN, null, true, 3] }, 4)?.nascoste)).toEqual([3]);
    });

    it('doppioni: l\'insieme e\' quello (doppioni tolti o no, non cambia cosa si nasconde)', () => {
      const r = normalizzaVista({ nascoste: [2, 2, 0] }, 4)!;
      expect(insieme(r.nascoste)).toEqual([0, 2]);
      r.nascoste!.forEach((i) => expect(Number.isInteger(i) && i >= 0 && i < 4).toBe(true));
    });

    it('tutte nascoste → non si nasconde niente (chiave assente)', () => {
      expect(normalizzaVista({ nascoste: [0, 1, 2, 3] }, 4)).toBeNull();
      expect(normalizzaVista({ nascoste: [3, 2, 1, 0, 0] }, 4)).toBeNull();
      const r = normalizzaVista({ nascoste: [0, 1, 2], ordinamento: { colonna: 0, verso: 'asc' } }, 3)!;
      expect(r.nascoste).toBeUndefined();
      expect(r.ordinamento).toEqual({ colonna: 0, verso: 'asc' });
    });

    it('tutte, contando gli scarti fuori intervallo → non si nasconde niente', () => {
      expect(normalizzaVista({ nascoste: [0, 1, 2, 7, -1] }, 3)).toBeNull();
    });

    it('n = 1: nascondere l\'unica colonna non si puo\'', () => {
      expect(normalizzaVista({ nascoste: [0] }, 1)).toBeNull();
    });

    it('tutte meno una: si tengono', () => {
      expect(insieme(normalizzaVista({ nascoste: [0, 1, 3] }, 4)?.nascoste)).toEqual([0, 1, 3]);
    });

    it('non un array: come assente', () => {
      expect(normalizzaVista({ nascoste: 1 }, 4)).toBeNull();
      expect(normalizzaVista({ nascoste: '1' }, 4)).toBeNull();
      expect(normalizzaVista({ nascoste: { 0: 1 } }, 4)).toBeNull();
    });
  });

  // ─── ordinamento
  describe('ordinamento', () => {
    it('asc e desc validi si tengono', () => {
      expect(normalizzaVista({ ordinamento: { colonna: 0, verso: 'asc' } }, 4)?.ordinamento).toEqual({ colonna: 0, verso: 'asc' });
      expect(normalizzaVista({ ordinamento: { colonna: 3, verso: 'desc' } }, 4)?.ordinamento).toEqual({ colonna: 3, verso: 'desc' });
    });

    it('{colonna: null} = nessun ordinamento, ed e\' una scelta: si tiene', () => {
      const r = normalizzaVista({ ordinamento: { colonna: null } }, 4);
      expect(r).not.toBeNull();
      expect(r!.ordinamento).toBeDefined();
      expect(r!.ordinamento!.colonna).toBeNull();
    });

    it('{colonna: null} con n = 0 colonne: tenuto o vista null (ambiguo: il contratto non dice n = 0)', () => {
      const r = normalizzaVista({ ordinamento: { colonna: null } }, 0);
      expect(r === null || r.ordinamento?.colonna === null, JSON.stringify(r)).toBe(true);
    });

    it.each([
      ['colonna = n', { colonna: 4, verso: 'asc' }],
      ['colonna negativa', { colonna: -1, verso: 'asc' }],
      ['colonna decimale', { colonna: 1.5, verso: 'asc' }],
      ['colonna stringa', { colonna: '1', verso: 'asc' }],
      ['colonna NaN', { colonna: NaN, verso: 'asc' }],
      ['colonna assente', { verso: 'asc' }],
      ['colonna booleana', { colonna: true, verso: 'asc' }],
      ['verso maiuscolo', { colonna: 1, verso: 'ASC' }],
      ['verso sconosciuto', { colonna: 1, verso: 'ascending' }],
      ['verso con spazi', { colonna: 1, verso: 'desc ' }],
      ['verso assente', { colonna: 1 }],
      ['verso null', { colonna: 1, verso: null }],
    ])('%s → come assente', (_n, o) => {
      const r = normalizzaVista({ ordinamento: o, nascoste: [2] }, 4)!;
      expect(r).not.toBeNull();
      expect(r.ordinamento).toBeUndefined();
      expect(normalizzaVista({ ordinamento: o }, 4)).toBeNull();
    });

    it('ordinamento non oggetto → come assente', () => {
      for (const o of ['1 asc', 1, null, [1, 'asc'], true]) {
        expect(normalizzaVista({ ordinamento: o }, 4), JSON.stringify(o)).toBeNull();
      }
    });

    it('su una colonna nascosta: resta', () => {
      const r = normalizzaVista({ nascoste: [1], ordinamento: { colonna: 1, verso: 'desc' } }, 4)!;
      expect(r.ordinamento).toEqual({ colonna: 1, verso: 'desc' });
      expect(insieme(r.nascoste)).toEqual([1]);
    });
  });

  // ─── larghezze
  describe('larghezze', () => {
    it('dentro 40..800 si tengono; le chiavi sono stringhe (oggetto JSON)', () => {
      expect(normalizzaVista({ larghezze: { 0: 40, 1: 800, 2: 64 } }, 4)?.larghezze).toEqual({ '0': 40, '1': 800, '2': 64 });
    });

    it('sotto 40 → 40, sopra 800 → 800', () => {
      expect(normalizzaVista({ larghezze: { 0: 39, 1: 801, 2: 0, 3: -100 } }, 4)?.larghezze)
        .toEqual({ '0': 40, '1': 800, '2': 40, '3': 40 });
      expect(normalizzaVista({ larghezze: { 0: 100000 } }, 4)?.larghezze).toEqual({ '0': 800 });
    });

    it('non interi: interi al piu\' vicino (poi i limiti)', () => {
      expect(normalizzaVista({ larghezze: { 0: 123.4, 1: 123.5, 2: 39.6, 3: 800.4 } }, 4)?.larghezze)
        .toEqual({ '0': 123, '1': 124, '2': 40, '3': 800 });
    });

    it('chiavi fuori da [0, n) o non indici ignorate', () => {
      expect(normalizzaVista({ larghezze: { 1: 100, 4: 100, '-1': 100, abc: 100, '1.5': 100 } }, 4)?.larghezze)
        .toEqual({ '1': 100 });
    });

    it('valori non numerici ignorati (la chiave sparisce)', () => {
      expect(normalizzaVista({ larghezze: { 0: 'largo', 1: null, 2: true, 3: 200 } }, 4)?.larghezze).toEqual({ '3': 200 });
      expect(normalizzaVista({ larghezze: { 0: {}, 1: [100], 3: NaN } }, 4)).toBeNull();
    });

    it('valore stringa numerica "120": tenuto (120) o ignorato (ambiguo: «non numerici»)', () => {
      const r = normalizzaVista({ larghezze: { 0: '120' }, nascoste: [1] }, 4)!;
      expect([undefined, { '0': 120 }]).toContainEqual(r.larghezze);
    });

    it('le larghezze valgono anche per colonne nascoste (la chiave e\' un indice in colonne)', () => {
      expect(normalizzaVista({ larghezze: { 1: 150 }, nascoste: [1] }, 4)?.larghezze).toEqual({ '1': 150 });
    });

    it('larghezze non oggetto → come assente', () => {
      for (const l of [100, 'x', [100, 200], null]) {
        expect(normalizzaVista({ larghezze: l }, 4), JSON.stringify(l)).toBeNull();
      }
    });

    it('valori sempre interi in 40..800', () => {
      const r = normalizzaVista({ larghezze: { 0: 40.0001, 1: 799.9999, 2: 1e-9, 3: 555.55 } }, 4)!;
      for (const v of Object.values(r.larghezze!)) {
        expect(Number.isInteger(v) && v >= 40 && v <= 800, String(v)).toBe(true);
      }
    });
  });

  it('tutte le regole insieme', () => {
    const r = normalizzaVista({
      ordineColonne: [3, 3, 'x', 1, 9],
      nascoste: [0, 7, 0],
      ordinamento: { colonna: 0, verso: 'desc' },
      larghezze: { 1: 10, 3: 2000, 5: 100, 2: 'boh' },
      extra: true,
    }, 4)!;
    expect(r.ordineColonne).toEqual([3, 1, 0, 2]);
    expect(insieme(r.nascoste)).toEqual([0]);
    expect(r.ordinamento).toEqual({ colonna: 0, verso: 'desc' });
    expect(r.larghezze).toEqual({ '1': 40, '3': 800 });
    expect(Object.keys(r).sort()).toEqual(['larghezze', 'nascoste', 'ordinamento', 'ordineColonne']);
  });
});

// ═══════════════════════════════════════════════════════════════ colonneMostrate

describe('SXADV-6001 colonneMostrate', () => {
  it('nessuna vista, nessun ordine iniziale → 0..n-1', () => {
    expect(colonneMostrate(null, 4)).toEqual([0, 1, 2, 3]);
    expect(colonneMostrate({}, 3)).toEqual([0, 1, 2]);
  });

  it('nessuna vista: l\'ordine iniziale (6001.0)', () => {
    expect(colonneMostrate(null, 4, [3, 1, 0, 2])).toEqual([3, 1, 0, 2]);
    expect(colonneMostrate({}, 4, [3, 1, 0, 2])).toEqual([3, 1, 0, 2]);
  });

  it('ordineColonne della vista vince sull\'ordine iniziale', () => {
    expect(colonneMostrate({ ordineColonne: [2, 0, 1, 3] }, 4, [3, 2, 1, 0])).toEqual([2, 0, 1, 3]);
  });

  it('meno le nascoste, nell\'ordine a schermo', () => {
    expect(colonneMostrate({ ordineColonne: [2, 0, 1, 3], nascoste: [3] }, 4)).toEqual([2, 0, 1]);
    expect(colonneMostrate({ ordineColonne: [2, 0, 1, 3], nascoste: [2, 1] }, 4)).toEqual([0, 3]);
    expect(colonneMostrate({ nascoste: [1] }, 4, [3, 1, 0, 2])).toEqual([3, 0, 2]);
  });

  it('ordine parziale: completato prima di togliere le nascoste', () => {
    expect(colonneMostrate({ ordineColonne: [3], nascoste: [1] }, 4)).toEqual([3, 0, 2]);
  });

  it('nascoste fuori intervallo ignorate', () => {
    expect(colonneMostrate({ nascoste: [9, -1] }, 3)).toEqual([0, 1, 2]);
  });

  it('nascoste tutte → si vedono tutte (almeno una resta)', () => {
    expect(colonneMostrate({ nascoste: [0, 1, 2] }, 3)).toEqual([0, 1, 2]);
    expect(colonneMostrate({ ordineColonne: [2, 1, 0], nascoste: [0, 1, 2] }, 3)).toEqual([2, 1, 0]);
    expect(colonneMostrate({ nascoste: [0] }, 1)).toEqual([0]);
  });

  it('mai vuoto con n >= 1', () => {
    const viste: (VistaTabella | null)[] = [
      null, {}, { nascoste: [0, 1] }, { nascoste: [0, 1, 1, 0] }, { ordineColonne: [1], nascoste: [1, 0] },
    ];
    for (const v of viste) {
      expect(colonneMostrate(v, 2).length, JSON.stringify(v)).toBeGreaterThan(0);
    }
  });

  it('ordinamento e larghezze non cambiano quali colonne si vedono', () => {
    expect(colonneMostrate({ ordinamento: { colonna: 1, verso: 'asc' }, larghezze: { 0: 100 } }, 3)).toEqual([0, 1, 2]);
  });

  it('n = 0 → []', () => {
    expect(colonneMostrate(null, 0)).toEqual([]);
    expect(colonneMostrate({ ordineColonne: [0] }, 0)).toEqual([]);
  });

  it('ordine iniziale storto: le stesse regole di completaOrdine (permutazione valida)', () => {
    const r = colonneMostrate(null, 3, 'boh');
    expect(r).toEqual([0, 1, 2]);
    const r2 = colonneMostrate(null, 3, [2, 2, 9]);
    expect(permutazioneDi(r2, 3)).toBe(true);
  });

  it('pura: non cambia la vista', () => {
    const v = { ordineColonne: [1, 0, 2], nascoste: [2] };
    colonneMostrate(v, 3);
    expect(v).toEqual({ ordineColonne: [1, 0, 2], nascoste: [2] });
  });
});

// ═══════════════════════════════════════════════════════════════ prossimoOrdinamento

describe('SXADV-6001 prossimoOrdinamento (il giro del clic)', () => {
  it('nessuno (undefined/null) → c asc', () => {
    expect(prossimoOrdinamento(undefined, 2)).toEqual({ colonna: 2, verso: 'asc' });
    expect(prossimoOrdinamento(null, 0)).toEqual({ colonna: 0, verso: 'asc' });
  });

  it('{colonna: null} (nessuno scelto) → c asc', () => {
    expect(prossimoOrdinamento({ colonna: null }, 1)).toEqual({ colonna: 1, verso: 'asc' });
  });

  it('c asc → c desc', () => {
    expect(prossimoOrdinamento({ colonna: 1, verso: 'asc' }, 1)).toEqual({ colonna: 1, verso: 'desc' });
    expect(prossimoOrdinamento({ colonna: 0, verso: 'asc' }, 0)).toEqual({ colonna: 0, verso: 'desc' });
  });

  it('c desc → nessuno {colonna: null}', () => {
    const r = prossimoOrdinamento({ colonna: 1, verso: 'desc' }, 1);
    expect(r.colonna).toBeNull();
    expect(r).toEqual({ colonna: null });
  });

  it('colonna 0 desc → nessuno (0 non e\' «falso»)', () => {
    expect(prossimoOrdinamento({ colonna: 0, verso: 'desc' }, 0).colonna).toBeNull();
  });

  it('un\'altra colonna, asc o desc → c asc', () => {
    expect(prossimoOrdinamento({ colonna: 0, verso: 'asc' }, 2)).toEqual({ colonna: 2, verso: 'asc' });
    expect(prossimoOrdinamento({ colonna: 0, verso: 'desc' }, 2)).toEqual({ colonna: 2, verso: 'asc' });
    expect(prossimoOrdinamento({ colonna: 3, verso: 'desc' }, 0)).toEqual({ colonna: 0, verso: 'asc' });
  });

  it('stessa colonna con verso assente o strano → c asc (il ramo «altrimenti»)', () => {
    expect(prossimoOrdinamento({ colonna: 1 }, 1)).toEqual({ colonna: 1, verso: 'asc' });
    expect(prossimoOrdinamento({ colonna: 1, verso: 'ASC' as unknown as 'asc' }, 1)).toEqual({ colonna: 1, verso: 'asc' });
  });

  it('il giro completo: nessuno → asc → desc → nessuno → asc', () => {
    let o = prossimoOrdinamento(undefined, 2);
    expect(o).toEqual({ colonna: 2, verso: 'asc' });
    o = prossimoOrdinamento(o, 2);
    expect(o).toEqual({ colonna: 2, verso: 'desc' });
    o = prossimoOrdinamento(o, 2);
    expect(o.colonna).toBeNull();
    o = prossimoOrdinamento(o, 2);
    expect(o).toEqual({ colonna: 2, verso: 'asc' });
  });

  it('a meta\' giro si passa a un\'altra colonna: riparte da asc', () => {
    let o = prossimoOrdinamento(undefined, 1);
    o = prossimoOrdinamento(o, 1); // 1 desc
    o = prossimoOrdinamento(o, 3);
    expect(o).toEqual({ colonna: 3, verso: 'asc' });
  });

  it('pura: non cambia l\'ordinamento passato', () => {
    const a = { colonna: 1, verso: 'asc' as const };
    prossimoOrdinamento(a, 1);
    expect(a).toEqual({ colonna: 1, verso: 'asc' });
  });
});

// ═══════════════════════════════════════════════════════════════ spostaColonna

describe('SXADV-6001 spostaColonna', () => {
  it('gli esempi del contratto', () => {
    expect(spostaColonna([0, 1, 2, 3], 0, 2)).toEqual([1, 2, 0, 3]);
    expect(spostaColonna([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
  });

  it('da === su → invariato', () => {
    expect(spostaColonna([0, 1, 2, 3], 2, 2)).toEqual([0, 1, 2, 3]);
    expect(spostaColonna([3, 1, 0, 2], 0, 0)).toEqual([3, 1, 0, 2]);
  });

  it('indici che non stanno in ordine → invariato', () => {
    expect(spostaColonna([0, 1, 2, 3], 7, 1)).toEqual([0, 1, 2, 3]);
    expect(spostaColonna([0, 1, 2, 3], 1, 7)).toEqual([0, 1, 2, 3]);
    expect(spostaColonna([0, 1, 2, 3], -1, 0)).toEqual([0, 1, 2, 3]);
    // ordine senza la colonna 2 (per esempio la si e' tolta): 2 non c'e'
    expect(spostaColonna([0, 1, 3], 2, 0)).toEqual([0, 1, 3]);
    expect(spostaColonna([0, 1, 3], 0, 2)).toEqual([0, 1, 3]);
  });

  it('vicini: si scambiano, in tutti e due i versi', () => {
    expect(spostaColonna([0, 1, 2, 3], 1, 2)).toEqual([0, 2, 1, 3]);
    expect(spostaColonna([0, 1, 2, 3], 2, 1)).toEqual([0, 2, 1, 3]);
  });

  it('primo in fondo, ultimo in testa', () => {
    expect(spostaColonna([0, 1, 2, 3], 0, 3)).toEqual([1, 2, 3, 0]);
    expect(spostaColonna([0, 1, 2, 3], 3, 0)).toEqual([3, 0, 1, 2]);
  });

  it('gli argomenti sono indici in colonne, non posizioni a schermo', () => {
    // a schermo [2,0,3,1]: la colonna 2 (posizione 0) sul posto della colonna 3 (posizione 2)
    expect(spostaColonna([2, 0, 3, 1], 2, 3)).toEqual([0, 3, 2, 1]);
    // la colonna 1 (posizione 3) sul posto della colonna 0 (posizione 1)
    expect(spostaColonna([2, 0, 3, 1], 1, 0)).toEqual([2, 1, 0, 3]);
    // se fossero posizioni: [2,0,3,1] da 0 su 2 darebbe [0,3,2,1] lo stesso; questa no:
    expect(spostaColonna([3, 2, 1, 0], 0, 3)).toEqual([0, 3, 2, 1]);
  });

  it('su un ordine con le nascoste fuori (solo quelle a schermo)', () => {
    expect(spostaColonna([4, 0, 2], 2, 4)).toEqual([2, 4, 0]);
  });

  it('il risultato e\' una permutazione dello stesso ordine', () => {
    const o = [3, 0, 4, 1, 2];
    for (const da of o) for (const su of o) {
      const r = spostaColonna(o, da, su);
      expect([...r].sort(), `${da}->${su}`).toEqual([...o].sort());
      // la colonna spostata sta dove stava «su»
      expect(r.indexOf(da), `${da}->${su}`).toBe(o.indexOf(su));
    }
  });

  it('pura: non cambia l\'ordine passato', () => {
    const o = [0, 1, 2, 3];
    spostaColonna(o, 0, 2);
    expect(o).toEqual([0, 1, 2, 3]);
  });

  it('due colonne', () => {
    expect(spostaColonna([0, 1], 0, 1)).toEqual([1, 0]);
    expect(spostaColonna([1, 0], 0, 1)).toEqual([0, 1]);
  });
});

// ═══════════════════════════════════════════════════════════════ larghezzaValida

describe('SXADV-6001 larghezzaValida', () => {
  it('interi dentro 40..800: invariati', () => {
    for (const v of [40, 41, 64, 180, 799, 800]) expect(larghezzaValida(v)).toBe(v);
  });

  it('sotto 40 → 40', () => {
    for (const v of [39, 0, -1, -500, 1]) expect(larghezzaValida(v), String(v)).toBe(40);
  });

  it('sopra 800 → 800', () => {
    for (const v of [801, 1000, 1e9]) expect(larghezzaValida(v), String(v)).toBe(800);
  });

  // Decisione della prova: arrotondamento al piu' vicino, meta' in su (Math.round).
  it('non interi: arrotondati al piu\' vicino', () => {
    expect(larghezzaValida(100.4)).toBe(100);
    expect(larghezzaValida(100.5)).toBe(101);
    expect(larghezzaValida(100.6)).toBe(101);
    expect(larghezzaValida(212.999)).toBe(213);
  });

  it('non interi ai bordi: arrotondati e poi riportati in 40..800', () => {
    expect(larghezzaValida(39.6)).toBe(40);
    expect(larghezzaValida(39.4)).toBe(40);
    expect(larghezzaValida(800.4)).toBe(800);
    expect(larghezzaValida(800.6)).toBe(800);
    expect(larghezzaValida(40.4)).toBe(40);
    expect(larghezzaValida(799.6)).toBe(800);
  });

  it('il risultato e\' sempre un intero in 40..800 (o null)', () => {
    for (const v of [-3.3, 0.1, 40.5, 77.77, 400.5, 799.5, 12345.6]) {
      const r = larghezzaValida(v);
      expect(r !== null && Number.isInteger(r) && r >= 40 && r <= 800, `${v} -> ${r}`).toBe(true);
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['stringa non numerica', 'largo'],
    ['stringa vuota', ''],
    ['booleano true', true],
    ['booleano false', false],
    ['oggetto', {}],
    ['array', [100]],
  ])('%s → null', (_n, v) => {
    expect(larghezzaValida(v)).toBeNull();
  });

  it('stringa numerica "120": null o 120 (ambiguo: «se non e\' un numero»)', () => {
    expect([null, 120]).toContainEqual(larghezzaValida('120'));
  });

  it('Infinity: 800 (al limite) o null (non finito) — ambiguo; -Infinity: 40 o null', () => {
    expect([800, null]).toContainEqual(larghezzaValida(Infinity));
    expect([40, null]).toContainEqual(larghezzaValida(-Infinity));
  });
});
