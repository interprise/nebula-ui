import { describe, it, expect } from 'vitest';
import { canOfferOneLine } from './oneLineOffer';

// SXADV-6012: Clienti / Fornitori / Anagrafica Unica hanno poche colonne che
// entrano nella finestra, niente bande di continuazione: oggi il pulsante
// "un record per riga" non compare. Le righe pero' sono alte perche' gli
// indirizzi portano un `<br/>`. Nuovo ingresso facoltativo `recordsWrap`: la
// pagina ha record che vanno a capo per un a capo del markup.

const base = { gridId: 'g1', hasContinuationBands: false, columnsOverflow: false, oneLineOn: false };

describe('canOfferOneLine: recordsWrap (SXADV-6012)', () => {
  it('Clienti: solo recordsWrap -> offerto', () => {
    expect(canOfferOneLine({ ...base, recordsWrap: true } as never)).toBe(true);
  });

  it('recordsWrap false e nient\'altro -> non offerto', () => {
    expect(canOfferOneLine({ ...base, recordsWrap: false } as never)).toBe(false);
  });

  it('recordsWrap omesso equivale a false (chiamanti esistenti)', () => {
    expect(canOfferOneLine(base)).toBe(false);
    expect(canOfferOneLine({ ...base, recordsWrap: undefined } as never)).toBe(false);
  });

  it('recordsWrap omesso non spegne gli altri motivi', () => {
    expect(canOfferOneLine({ ...base, hasContinuationBands: true })).toBe(true);
    expect(canOfferOneLine({ ...base, columnsOverflow: true })).toBe(true);
    expect(canOfferOneLine({ ...base, oneLineOn: true })).toBe(true);
  });

  it.each([null, undefined, ''])('senza gridId (%s) -> false anche con recordsWrap', (gridId) => {
    expect(canOfferOneLine({ ...base, gridId, recordsWrap: true } as never)).toBe(false);
    expect(canOfferOneLine({
      gridId, hasContinuationBands: true, columnsOverflow: true, oneLineOn: true, recordsWrap: true,
    } as never)).toBe(false);
  });

  // Tabella di verita' completa: con gridId, OR dei quattro motivi.
  const flags = [false, true];
  const cases: [boolean, boolean, boolean, boolean][] = [];
  for (const b of flags) for (const c of flags) for (const r of flags) for (const o of flags) cases.push([b, c, r, o]);
  it.each(cases)('bande=%s sforo=%s recordsWrap=%s attiva=%s', (b, c, r, o) => {
    expect(canOfferOneLine({
      gridId: 'g1', hasContinuationBands: b, columnsOverflow: c, recordsWrap: r, oneLineOn: o,
    } as never)).toBe(b || c || r || o);
  });

  it('modalita\' gia\' attiva resta offerta quando la pagina nuova non va piu\' a capo', () => {
    expect(canOfferOneLine({ ...base, recordsWrap: false, oneLineOn: true } as never)).toBe(true);
  });

  it('restituisce sempre un booleano', () => {
    expect(typeof canOfferOneLine({ ...base, recordsWrap: true } as never)).toBe('boolean');
    expect(typeof canOfferOneLine({ ...base } as never)).toBe('boolean');
  });
});
