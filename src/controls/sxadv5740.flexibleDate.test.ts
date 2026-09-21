// SXADV-5740.0 — l'inserimento flessibile che il Tab deve applicare a una data
// digitata in un campo vuoto. Prova scritta da chi non implementa: esprime la
// promessa del ticket ("05072026" -> 05/07/2026), non il codice.
//
// Nell'applicazione il plugin customParseFormat di dayjs lo registra antd
// (il generatore dayjs di rc-picker) appena si importa un DatePicker; qui non
// c'e' antd, quindi lo si registra a mano per avere lo stesso dayjs.
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { parseFlexibleDate } from './helpers';

dayjs.extend(customParseFormat);

const fmt = (d: ReturnType<typeof parseFlexibleDate>, f = 'DD/MM/YYYY') => (d ? d.format(f) : null);

describe('SXADV-5740.0 parseFlexibleDate: la data digitata diventa una data vera', () => {
  it('8 cifre ggmmaaaa -> gg/mm/aaaa', () => {
    expect(fmt(parseFlexibleDate('05072026'))).toBe('05/07/2026');
  });

  it('8 cifre con spazi attorno (il testo del campo non e\' ripulito da chi chiama)', () => {
    expect(fmt(parseFlexibleDate('  05072026 '))).toBe('05/07/2026');
  });

  it('una data gia\' nel formato di visualizzazione resta quella', () => {
    expect(fmt(parseFlexibleDate('05/07/2026'))).toBe('05/07/2026');
  });

  it('6 cifre ggmmaa -> anno a due cifre', () => {
    expect(fmt(parseFlexibleDate('050726'))).toBe('05/07/2026');
  });

  it('4 cifre ggmm -> anno corrente', () => {
    expect(fmt(parseFlexibleDate('0507'))).toBe(`05/07/${dayjs().year()}`);
  });

  it('separatori diversi dalla barra', () => {
    expect(fmt(parseFlexibleDate('5-7-2026'))).toBe('05/07/2026');
    expect(fmt(parseFlexibleDate('5.7.2026'))).toBe('05/07/2026');
  });

  it('una data impossibile non viene inventata', () => {
    expect(parseFlexibleDate('31022026')).toBeNull();
    expect(parseFlexibleDate('0507202')).toBeNull();
  });

  it('il vuoto resta vuoto (nessun commit a una data qualsiasi)', () => {
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate('   ')).toBeNull();
  });
});
