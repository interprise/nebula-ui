import { describe, it, expect } from 'vitest';
import { comboPlaceholder } from './comboPlaceholder';

// SXADV-5749: il ViewItem dichiara emptyMessage="Aggiungi testo..." (nel
// legacy era la prima <option> vuota della combo); CORE ora lo manda nel
// descrittore del controllo e la combo React lo usa come placeholder.

describe('comboPlaceholder', () => {
  it('restituisce l\'emptyMessage dichiarato', () => {
    expect(comboPlaceholder({ emptyMessage: 'Aggiungi testo...' })).toBe('Aggiungi testo...');
  });

  it('senza emptyMessage non c\'è placeholder', () => {
    expect(comboPlaceholder({})).toBeUndefined();
    expect(comboPlaceholder({ emptyMessage: undefined })).toBeUndefined();
    expect(comboPlaceholder({ emptyMessage: null })).toBeUndefined();
  });

  it('stringa vuota o di soli spazi = nessun placeholder', () => {
    expect(comboPlaceholder({ emptyMessage: '' })).toBeUndefined();
    expect(comboPlaceholder({ emptyMessage: '   ' })).toBeUndefined();
    expect(comboPlaceholder({ emptyMessage: '\t\n' })).toBeUndefined();
  });

  it.each([
    ['numero', 42],
    ['booleano', true],
    ['oggetto', { text: 'Aggiungi testo...' }],
    ['array', ['Aggiungi testo...']],
  ])('un valore non stringa (%s) non diventa placeholder', (_label, v) => {
    expect(comboPlaceholder({ emptyMessage: v })).toBeUndefined();
  });

  it('ignora le altre proprietà del controllo', () => {
    const control = { type: 'combo', value: '', emptyMessage: 'Scegli...', options: [] };
    expect(comboPlaceholder(control)).toBe('Scegli...');
  });
});
