import { describe, it, expect, afterEach, vi } from 'vitest';
import { headerColor, DEFAULT_HEADER_COLOR } from './headerColor';

// SXADV-5639 (punto 5454.4): "Colore Testata" di Config > Aziende e' testo
// libero sul DB. Valori reali: '#6666CC', '#00898C', '#db70b8', '00BFFF',
// '808080', 'DB7093', '0099CC', '#ff3333'. Un esadecimale senza '#' e' CSS non
// valido: il browser ignora style.background e la testata resta del colore
// dell'azienda precedente. headerColor() deve sempre dare un colore valido.

/** Simula CSS.supports('color', v) di un browser, in modo plausibile. */
const NAMED = new Set(['red', 'teal', 'blue', 'white', 'black', 'transparent', 'deepskyblue']);
function fakeSupports(prop: string, value?: string): boolean {
  if (prop !== 'color' || typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v)) return true;
  if (NAMED.has(v)) return true;
  if (/^(rgb|rgba|hsl|hsla)\(\s*[0-9.%\s,/]+\)$/.test(v)) return true;
  return false;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DEFAULT_HEADER_COLOR', () => {
  it('e\' il blu della testata', () => {
    expect(DEFAULT_HEADER_COLOR).toBe('#1E4176');
  });
});

describe('headerColor: valore assente', () => {
  it('null e undefined danno il colore predefinito', () => {
    expect(headerColor(null)).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor(undefined)).toBe(DEFAULT_HEADER_COLOR);
  });

  it('stringa vuota da\' il colore predefinito', () => {
    expect(headerColor('')).toBe(DEFAULT_HEADER_COLOR);
  });

  it('soli spazi (CHAR del DB) danno il colore predefinito', () => {
    expect(headerColor('   ')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('\t')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor(' \n\r\t ')).toBe(DEFAULT_HEADER_COLOR);
  });
});

describe('headerColor: valori reali del DB (node, senza CSS.supports)', () => {
  it.each([
    ['#6666CC', '#6666CC'],
    ['#00898C', '#00898C'],
    ['#db70b8', '#db70b8'],
    ['#ff3333', '#ff3333'],
    ['00BFFF', '#00BFFF'],
    ['808080', '#808080'],
    ['DB7093', '#DB7093'],
    ['0099CC', '#0099CC'],
  ])('%s -> %s', (raw, expected) => {
    expect(headerColor(raw)).toBe(expected);
  });
});

describe('headerColor: esadecimale nudo', () => {
  it('3 cifre prende il #', () => {
    expect(headerColor('abc')).toBe('#abc');
    expect(headerColor('F0A')).toBe('#F0A');
  });

  it('4 cifre prende il #', () => {
    expect(headerColor('abcd')).toBe('#abcd');
    expect(headerColor('F0A8')).toBe('#F0A8');
  });

  it('6 cifre prende il #', () => {
    expect(headerColor('00bfff')).toBe('#00bfff');
    expect(headerColor('00BFFF')).toBe('#00BFFF');
  });

  it('8 cifre prende il #', () => {
    expect(headerColor('00BFFF80')).toBe('#00BFFF80');
    expect(headerColor('00bfff80')).toBe('#00bfff80');
  });

  it('conserva maiuscole e minuscole miste', () => {
    expect(headerColor('Db7093')).toBe('#Db7093');
    expect(headerColor('aBcDeF')).toBe('#aBcDeF');
  });

  it('solo cifre decimali vale comunque come esadecimale', () => {
    expect(headerColor('808080')).toBe('#808080');
    expect(headerColor('123')).toBe('#123');
  });

  it('5 o 7 cifre non prendono il #', () => {
    // senza CSS.supports (node) il valore normalizzato passa com'e'
    expect(headerColor('12345')).toBe('12345');
    expect(headerColor('1234567')).toBe('1234567');
  });

  it('1, 2 o 9 cifre non prendono il #', () => {
    expect(headerColor('a')).not.toMatch(/^#/);
    expect(headerColor('ab')).not.toMatch(/^#/);
    expect(headerColor('123456789')).not.toMatch(/^#/);
  });

  it('parole con lettere oltre la f non sono esadecimali', () => {
    // 'bad' e' esadecimale, 'red' no: resta un nome
    expect(headerColor('red')).toBe('red');
    expect(headerColor('bad')).toBe('#bad');
  });
});

describe('headerColor: spazi ai bordi', () => {
  it('toglie gli spazi intorno a un valore con #', () => {
    expect(headerColor('  #6666CC  ')).toBe('#6666CC');
    expect(headerColor('#6666CC\n')).toBe('#6666CC');
  });

  it('toglie gli spazi intorno a un esadecimale nudo e poi mette il #', () => {
    expect(headerColor(' 00BFFF ')).toBe('#00BFFF');
    expect(headerColor('\t808080\r\n')).toBe('#808080');
  });

  it('toglie gli spazi intorno a un nome CSS', () => {
    expect(headerColor('  teal ')).toBe('teal');
  });
});

describe('headerColor: valori gia\' CSS passano invariati', () => {
  it('# valido resta com\'e\'', () => {
    expect(headerColor('#abc')).toBe('#abc');
    expect(headerColor('#ABCD')).toBe('#ABCD');
    expect(headerColor('#1E4176')).toBe('#1E4176');
    expect(headerColor('#1E417680')).toBe('#1E417680');
  });

  it('non aggiunge un secondo #', () => {
    expect(headerColor('#00BFFF')).not.toMatch(/^##/);
  });

  it('nomi CSS passano invariati', () => {
    expect(headerColor('red')).toBe('red');
    expect(headerColor('teal')).toBe('teal');
    expect(headerColor('DeepSkyBlue')).toBe('DeepSkyBlue');
  });

  it('notazioni funzionali passano invariate', () => {
    expect(headerColor('rgb(0, 191, 255)')).toBe('rgb(0, 191, 255)');
    expect(headerColor('rgba(0, 191, 255, 0.5)')).toBe('rgba(0, 191, 255, 0.5)');
    expect(headerColor('hsl(195, 100%, 50%)')).toBe('hsl(195, 100%, 50%)');
  });
});

describe('headerColor: con CSS.supports (browser)', () => {
  it('valore non-colore torna al predefinito, cosi\' la testata viene ridipinta', () => {
    vi.stubGlobal('CSS', { supports: fakeSupports });
    expect(headerColor('nonsense')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('colore aziendale')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('#ggg')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('#')).toBe(DEFAULT_HEADER_COLOR);
  });

  it('5 o 7 cifre esadecimali non sono un colore: predefinito', () => {
    vi.stubGlobal('CSS', { supports: fakeSupports });
    expect(headerColor('12345')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('1234567')).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('#12345')).toBe(DEFAULT_HEADER_COLOR);
  });

  it('i valori reali del DB restano validi', () => {
    vi.stubGlobal('CSS', { supports: fakeSupports });
    expect(headerColor('#6666CC')).toBe('#6666CC');
    expect(headerColor('#db70b8')).toBe('#db70b8');
    expect(headerColor('00BFFF')).toBe('#00BFFF');
    expect(headerColor('DB7093')).toBe('#DB7093');
    expect(headerColor(' 0099CC ')).toBe('#0099CC');
  });

  it('nomi e notazioni funzionali supportati passano', () => {
    vi.stubGlobal('CSS', { supports: fakeSupports });
    expect(headerColor('teal')).toBe('teal');
    expect(headerColor('rgb(0, 191, 255)')).toBe('rgb(0, 191, 255)');
  });

  it('chiede a CSS.supports il valore GIA\' normalizzato (con #, senza spazi)', () => {
    const supports = vi.fn(fakeSupports);
    vi.stubGlobal('CSS', { supports });
    expect(headerColor(' 00BFFF ')).toBe('#00BFFF');
    expect(supports).toHaveBeenCalled();
    const values = supports.mock.calls.map((c) => c[c.length - 1]);
    expect(values).toContain('#00BFFF');
    expect(values).not.toContain('00BFFF');
    expect(values).not.toContain(' 00BFFF ');
  });

  it('chiede come proprieta\' un colore', () => {
    const supports = vi.fn(fakeSupports);
    vi.stubGlobal('CSS', { supports });
    headerColor('#6666CC');
    // forma a due argomenti ('color', v) o a uno ('color: v')
    const ok = supports.mock.calls.some((c) =>
      c.length >= 2 ? /color/i.test(String(c[0])) : /color\s*:/i.test(String(c[0])),
    );
    expect(ok).toBe(true);
  });

  it('se CSS.supports dice che e\' un colore si fida anche di un valore che node lascerebbe passare', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    expect(headerColor('qualunquecosa')).toBe('qualunquecosa');
  });

  it('se CSS.supports dice sempre no, anche un # valido torna al predefinito', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    expect(headerColor('#6666CC')).toBe(DEFAULT_HEADER_COLOR);
  });

  it('il valore assente da\' il predefinito anche con CSS.supports', () => {
    vi.stubGlobal('CSS', { supports: fakeSupports });
    expect(headerColor(null)).toBe(DEFAULT_HEADER_COLOR);
    expect(headerColor('   ')).toBe(DEFAULT_HEADER_COLOR);
  });

  it('CSS presente ma senza supports: il valore normalizzato passa', () => {
    vi.stubGlobal('CSS', {});
    expect(headerColor('00BFFF')).toBe('#00BFFF');
    expect(headerColor('nonsense')).toBe('nonsense');
  });
});

describe('headerColor: senza CSS.supports (node)', () => {
  it('nell\'ambiente di test CSS non esiste', () => {
    expect((globalThis as { CSS?: unknown }).CSS).toBeUndefined();
  });

  it('un valore non riconosciuto passa normalizzato', () => {
    expect(headerColor(' nonsense ')).toBe('nonsense');
  });
});

describe('headerColor: non lancia mai', () => {
  const strane = [
    '#', '##', '###', '#00BFFF#', '00 BF FF', '0x00BFFF', 'rgb(', ')', '()',
    'url(javascript:alert(1))', '<script>', '\u0000', '￿', '€', '😀',
    'a'.repeat(10000), '#'.repeat(1000), '\\', '"', "'", ';', '/* */',
    'undefined', 'null', 'NaN', '__proto__', 'constructor', 'toString',
  ];

  it.each(strane)('%j senza CSS.supports', (s) => {
    expect(() => headerColor(s)).not.toThrow();
    expect(typeof headerColor(s)).toBe('string');
    expect(headerColor(s).length).toBeGreaterThan(0);
  });

  it.each(strane)('%j con CSS.supports', (s) => {
    vi.stubGlobal('CSS', { supports: fakeSupports });
    expect(() => headerColor(s)).not.toThrow();
    expect(typeof headerColor(s)).toBe('string');
    expect(headerColor(s).length).toBeGreaterThan(0);
  });
});
