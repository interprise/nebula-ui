// Campi ORA (TimeControl): l'inserimento flessibile che il blur deve applicare
// a un'ora digitata, come `checkTime` del legacy (entrasp/WebContent/script/
// JSLib.js). Prova scritta da chi non implementa: esprime il contratto
// ("1030" -> 10:30), non il codice.
//
// Nell'applicazione il plugin customParseFormat di dayjs lo registra antd
// appena si importa un picker; qui non c'e' antd, quindi lo si registra a mano
// per avere lo stesso dayjs (vedi sxadv5740.flexibleDate.test.ts).
//
// Del Dayjs restituito contano solo ora e minuti: si confronta sempre 'HH:mm'.
import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { parseFlexibleTime } from './helpers';

dayjs.extend(customParseFormat);

const hm = (raw: string) => {
  const d = parseFlexibleTime(raw);
  return d ? d.format('HH:mm') : null;
};

describe('parseFlexibleTime: solo cifre', () => {
  it('1 cifra = ora intera', () => {
    expect(hm('9')).toBe('09:00');
    expect(hm('0')).toBe('00:00');
  });

  it('2 cifre = ora intera', () => {
    expect(hm('10')).toBe('10:00');
    expect(hm('09')).toBe('09:00');
    expect(hm('00')).toBe('00:00');
    expect(hm('23')).toBe('23:00');
  });

  it('3 cifre = H mm', () => {
    expect(hm('930')).toBe('09:30');
    expect(hm('905')).toBe('09:05');
    expect(hm('000')).toBe('00:00');
  });

  it('4 cifre = HH mm', () => {
    expect(hm('1030')).toBe('10:30');
    expect(hm('0000')).toBe('00:00');
    expect(hm('2359')).toBe('23:59');
    expect(hm('0930')).toBe('09:30');
  });

  it('5 o piu\' cifre non sono un\'ora', () => {
    expect(parseFlexibleTime('10300')).toBeNull();
    expect(parseFlexibleTime('103000')).toBeNull();
  });
});

describe('parseFlexibleTime: ora e minuti separati', () => {
  it('i due punti, anche con 1 cifra per parte', () => {
    expect(hm('10:30')).toBe('10:30');
    expect(hm('9:5')).toBe('09:05');
    expect(hm('9:30')).toBe('09:30');
    expect(hm('1:2')).toBe('01:02');
    expect(hm('00:00')).toBe('00:00');
    expect(hm('23:59')).toBe('23:59');
  });

  it('separatori diversi dai due punti', () => {
    expect(hm('9.30')).toBe('09:30');
    expect(hm('10,30')).toBe('10:30');
    expect(hm('10 30')).toBe('10:30');
    expect(hm('10-30')).toBe('10:30');
  });

  it('un\'ora gia\' nel formato del campo resta quella', () => {
    expect(hm('11:45')).toBe('11:45');
  });

  it('gruppi con piu\' di due cifre non sono ora/minuti', () => {
    expect(parseFlexibleTime('100:30')).toBeNull();
    expect(parseFlexibleTime('10:300')).toBeNull();
  });
});

describe('parseFlexibleTime: spazi attorno', () => {
  it('sono ignorati (il testo del campo non e\' ripulito da chi chiama)', () => {
    expect(hm('  1030 ')).toBe('10:30');
    expect(hm(' 9:30  ')).toBe('09:30');
    expect(hm('\t9 ')).toBe('09:00');
  });
});

describe('parseFlexibleTime: un\'ora impossibile non viene inventata', () => {
  it('ora oltre 23', () => {
    expect(parseFlexibleTime('2400')).toBeNull();
    expect(parseFlexibleTime('24')).toBeNull();
    expect(parseFlexibleTime('25')).toBeNull();
    expect(parseFlexibleTime('24:00')).toBeNull();
    expect(parseFlexibleTime('2599')).toBeNull();
  });

  it('minuti oltre 59', () => {
    expect(parseFlexibleTime('1060')).toBeNull();
    expect(parseFlexibleTime('960')).toBeNull();
    expect(parseFlexibleTime('9:75')).toBeNull();
    expect(parseFlexibleTime('10:60')).toBeNull();
  });

  it('lettere', () => {
    expect(parseFlexibleTime('abc')).toBeNull();
    expect(parseFlexibleTime('10a')).toBeNull();
    expect(parseFlexibleTime('ore 10')).toBeNull();
  });

  it('piu\' di due gruppi di cifre', () => {
    expect(parseFlexibleTime('10:30:15')).toBeNull();
    expect(parseFlexibleTime('1.2.3')).toBeNull();
  });

  it('minuti senza ora', () => {
    expect(parseFlexibleTime(':30')).toBeNull();
    expect(parseFlexibleTime(':')).toBeNull();
  });

  it('tre gruppi anche con una cifra ciascuno', () => {
    expect(parseFlexibleTime('1:2:3')).toBeNull();
  });
});

describe('parseFlexibleTime: ora seguita solo dal separatore = ora intera (contratto rivisto)', () => {
  it("':' '.' ',' in coda", () => {
    expect(hm('9:')).toBe('09:00');
    expect(hm('10.')).toBe('10:00');
    expect(hm('10,')).toBe('10:00');
    expect(hm('0:')).toBe('00:00');
    expect(hm(' 23: ')).toBe('23:00');
  });

  it('ma l\'ora resta nei limiti', () => {
    expect(parseFlexibleTime('24:')).toBeNull();
    expect(parseFlexibleTime('25.')).toBeNull();
  });

  it('e 3+ cifre prima del separatore non sono un\'ora', () => {
    expect(parseFlexibleTime('930:')).toBeNull();
  });
});

describe('parseFlexibleTime: il vuoto resta vuoto', () => {
  it('stringa vuota o solo spazi -> null (nessun commit a un\'ora qualsiasi)', () => {
    expect(parseFlexibleTime('')).toBeNull();
    expect(parseFlexibleTime('   ')).toBeNull();
  });
});

describe('parseFlexibleTime: il risultato e\' un Dayjs valido', () => {
  it('ora e minuti leggibili direttamente', () => {
    const d = parseFlexibleTime('1030');
    expect(d).not.toBeNull();
    expect(d!.isValid()).toBe(true);
    expect(d!.hour()).toBe(10);
    expect(d!.minute()).toBe(30);
  });
});
