import { describe, it, expect } from 'vitest';
import { applyRowEcho, echoText } from './rowEcho';
import type { EchoEntry } from './rowEcho';
import type { ListColumn } from '../types/ui';

// SXADV-6262: spuntare una casella nel pannello si vede subito nel rigo della
// griglia, come il legacy che mostra Si'/No. Questa promessa sostituisce quella di
// SXADV-6048 ("i booleani non si riflettono"): i test booleani di
// rowEcho.sxadv6048.test.ts la contraddicono.

const VS = 'S1-9';
const BOOL_TYPES = ['boolean', 'checkbox', 'bool'];

function entry(name: string, text: string): EchoEntry {
  return { wire: `${name}.${VS}`, text };
}

describe('echoText: booleani', () => {
  for (const type of BOOL_TYPES) {
    describe(`tipo ${type}`, () => {
      it('true -> Sì', () => expect(echoText({ type }, true)).toBe('Sì'));
      it('false -> No', () => expect(echoText({ type }, false)).toBe('No'));
      it('null -> vuoto', () => expect(echoText({ type }, null)).toBe(''));
      it('undefined -> vuoto', () => expect(echoText({ type }, undefined)).toBe(''));
    });
  }
});

const COLS = [
  { elementType: 1, control: { name: 'descrizione', type: 'text' } },
  { elementType: 1, control: { name: 'attivo', type: 'boolean' } },
  { elementType: 1, control: { name: 'spunta', type: 'checkbox' } },
  { elementType: 1, control: { name: 'flag', type: 'bool' } },
] as unknown as ListColumn[];

describe('applyRowEcho: colonne booleane', () => {
  const cases: Array<[string, number]> = [['attivo', 1], ['spunta', 2], ['flag', 3]];
  for (const [name, i] of cases) {
    describe(`colonna ${name} (col_${i})`, () => {
      it('Sì -> col true', () => {
        const out = applyRowEcho({ [`col_${i}`]: false }, { [name]: entry(name, 'Sì') }, COLS);
        expect(out[`col_${i}`]).toBe(true);
      });
      it('No -> col false', () => {
        const out = applyRowEcho({ [`col_${i}`]: true }, { [name]: entry(name, 'No') }, COLS);
        expect(out[`col_${i}`]).toBe(false);
      });
      it('vuoto -> col null', () => {
        const out = applyRowEcho({ [`col_${i}`]: true }, { [name]: entry(name, '') }, COLS);
        expect(out[`col_${i}`]).toBeNull();
      });
      it('_display presente: riceve il testo', () => {
        const out = applyRowEcho(
          { [`col_${i}`]: false, [`_display_${i}`]: 'No' },
          { [name]: entry(name, 'Sì') },
          COLS,
        );
        expect(out[`col_${i}`]).toBe(true);
        expect(out[`_display_${i}`]).toBe('Sì');
      });
      it('_display assente: non aggiunto', () => {
        const out = applyRowEcho({ [`col_${i}`]: false }, { [name]: entry(name, 'Sì') }, COLS);
        expect(Object.prototype.hasOwnProperty.call(out, `_display_${i}`)).toBe(false);
      });
    });
  }

  it('valore gia\' booleano uguale: stesso oggetto', () => {
    const data = { col_1: true };
    expect(applyRowEcho(data, { attivo: entry('attivo', 'Sì') }, COLS)).toBe(data);
  });

  it('valore e display gia\' uguali: stesso oggetto', () => {
    const data = { col_1: false, _display_1: 'No' };
    expect(applyRowEcho(data, { attivo: entry('attivo', 'No') }, COLS)).toBe(data);
  });

  it('il dato in ingresso non viene modificato', () => {
    const data = { col_1: false, _display_1: 'No', col_0: 'x' };
    const before = { ...data };
    applyRowEcho(data, { attivo: entry('attivo', 'Sì'), descrizione: entry('descrizione', 'y') }, COLS);
    expect(data).toEqual(before);
  });

  it('colonna non booleana nella stessa eco: testo come prima', () => {
    const out = applyRowEcho(
      { col_0: 'a', _display_0: 'a', col_1: false },
      { descrizione: entry('descrizione', 'Sì'), attivo: entry('attivo', 'Sì') },
      COLS,
    );
    expect(out.col_0).toBe('Sì');
    expect(out._display_0).toBe('Sì');
    expect(out.col_1).toBe(true);
  });

  it('dalla casella al rigo: echoText + applyRowEcho danno true', () => {
    const text = echoText({ type: 'checkbox' }, true);
    expect(text).toBe('Sì');
    const out = applyRowEcho({ col_2: false }, { spunta: entry('spunta', text ?? '') }, COLS);
    expect(out.col_2).toBe(true);
  });
});
