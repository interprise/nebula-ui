import { describe, it, expect } from 'vitest';
import { mapUrl } from './mapUrl';

// SXADV-5969.2: il bottone mappa apre Google Maps in una scheda nuova con gli
// URL pubblici (`api=1`): la mappa dell'indirizzo, o il percorso in auto quando
// la view dichiara un'origine diversa dall'indirizzo.

const CARPI = 'VIA DEI TRASPORTI 1\n41012 Carpi (MO)';

function parametri(url: string): { base: string; p: URLSearchParams } {
  const u = new URL(url);
  return { base: `${u.origin}${u.pathname}`, p: u.searchParams };
}

describe('mapUrl: senza indirizzo', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['stringa vuota', ''],
    ['solo spazi', '   '],
    ['solo a capo e tab', '\n\t \n'],
  ])('%s: niente URL', (_nome, indirizzo) => {
    expect(mapUrl(indirizzo as string | undefined | null)).toBeNull();
  });

  it('senza indirizzo non conta l\'origine', () => {
    expect(mapUrl('', 'Modena')).toBeNull();
  });
});

describe('mapUrl: la mappa dell\'indirizzo', () => {
  it('senza origine: ricerca, con l\'indirizzo ripulito dagli spazi', () => {
    const url = mapUrl('  Via Roma 1, Modena  ')!;
    const { base, p } = parametri(url);
    expect(base).toBe('https://www.google.com/maps/search/');
    expect(p.get('api')).toBe('1');
    expect(p.get('query')).toBe('Via Roma 1, Modena');
  });

  it('comincia esattamente col prefisso pubblico', () => {
    expect(mapUrl('Modena')).toBe('https://www.google.com/maps/search/?api=1&query=Modena');
  });

  it('a capo, virgole, apostrofi e parentesi sopravvivono alla codifica', () => {
    const indirizzo = "VIA DELL'INDUSTRIA 5, int. 3\n41012 Carpi (MO) & C. #2 ?x=1";
    const url = mapUrl(indirizzo)!;
    // Niente caratteri grezzi che romperebbero l'URL.
    expect(url).not.toMatch(/[\n #]/);
    expect(parametri(url).p.get('query')).toBe(indirizzo);
  });

  it('l\'indirizzo di Carpi torna intero', () => {
    expect(parametri(mapUrl(CARPI)!).p.get('query')).toBe(CARPI);
  });

  it.each([
    ['origine vuota', ''],
    ['origine di soli spazi', '   '],
    ['origine null', null],
    ['origine uguale all\'indirizzo', CARPI],
    ['origine uguale a meno di maiuscole e spazi', `  ${CARPI.toLowerCase()} `],
  ])('%s: ricerca, non percorso', (_nome, origine) => {
    const url = mapUrl(CARPI, origine as string | null)!;
    const { base, p } = parametri(url);
    expect(base).toBe('https://www.google.com/maps/search/');
    expect(p.get('query')).toBe(CARPI);
  });
});

describe('mapUrl: il percorso', () => {
  it('origine diversa: percorso in auto da origine a destinazione', () => {
    const url = mapUrl(`  ${CARPI} `, ' Piazza Grande, Modena (MO) ')!;
    const { base, p } = parametri(url);
    expect(base).toBe('https://www.google.com/maps/dir/');
    expect(p.get('api')).toBe('1');
    expect(p.get('origin')).toBe('Piazza Grande, Modena (MO)');
    expect(p.get('destination')).toBe(CARPI);
    expect(p.get('travelmode')).toBe('driving');
  });

  it('origine con caratteri speciali: codificata anche lei', () => {
    const origine = "Via Sant'Anna 2\n40100 Bologna (BO) & co";
    const url = mapUrl('Modena', origine)!;
    expect(url).not.toMatch(/[\n ]/);
    expect(parametri(url).p.get('origin')).toBe(origine);
  });
});
