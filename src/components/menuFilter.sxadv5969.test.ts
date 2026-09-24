import { describe, it, expect } from 'vitest';
import { filterMenuTree } from './menuFilter';
import type { MenuItem } from '../types/ui';

// SXADV-5969: la ricerca nel menu a sinistra. Tiene le voci la cui descrizione
// contiene il testo (maiuscole e minuscole indifferenti) e i rami che portano a
// una voce trovata. Una voce che arriva SENZA descrizione (azienda Domino)
// faceva crollare l'intera app con "Cannot read properties of undefined
// (reading 'toLowerCase')": non deve esplodere, e per testo non corrisponde.

function voce(id: string, description: string | undefined | null, children?: MenuItem[]): MenuItem {
  return { id, description: description as string, children, leaf: !children };
}

function ids(items: MenuItem[]): unknown {
  return items.map((i) => (i.children ? { [i.id]: ids(i.children) } : i.id));
}

const albero: MenuItem[] = [
  voce('anag', 'Anagrafiche', [
    voce('iscritti', 'Iscritti'),
    voce('tessere', 'Tessere - Interrogazione'),
  ]),
  voce('cont', 'Contabilita', [
    voce('fatt', 'Fatture', [
      voce('fattAtt', 'Fatture attive'),
      voce('fattPass', 'Fatture passive'),
    ]),
    voce('reg', 'Registrazioni contabili'),
  ]),
  voce('home', 'Home'),
];

describe('filterMenuTree: corrispondenza per testo', () => {
  it('tiene le voci che contengono il filtro, maiuscole e minuscole indifferenti', () => {
    expect(ids(filterMenuTree(albero, 'hOmE'))).toEqual(['home']);
    expect(ids(filterMenuTree(albero, 'TESSERE'))).toEqual([{ anag: ['tessere'] }]);
  });

  it('corrisponde anche a meta\' parola', () => {
    expect(ids(filterMenuTree(albero, 'rogaz'))).toEqual([{ anag: ['tessere'] }]);
  });

  it('nessuna corrispondenza: elenco vuoto', () => {
    expect(filterMenuTree(albero, 'zzz')).toEqual([]);
  });

  it('filtro vuoto: tiene tutto', () => {
    expect(ids(filterMenuTree(albero, ''))).toEqual(ids(albero));
  });

  it('non modifica l\'albero di partenza', () => {
    const prima = JSON.stringify(albero);
    filterMenuTree(albero, 'fatture');
    expect(JSON.stringify(albero)).toBe(prima);
  });
});

describe('filterMenuTree: i rami', () => {
  it('tiene i rami che portano a una voce trovata, coi soli figli trovati', () => {
    expect(ids(filterMenuTree(albero, 'passive'))).toEqual([
      { cont: [{ fatt: ['fattPass'] }] },
    ]);
  });

  it('corrispondenze in rami diversi: ogni ramo coi suoi', () => {
    expect(ids(filterMenuTree(albero, 'iscritti'))).toEqual([{ anag: ['iscritti'] }]);
    expect(ids(filterMenuTree(albero, 'tt'))).toEqual([
      { anag: ['iscritti'] },
      { cont: [{ fatt: ['fattAtt', 'fattPass'] }] },
    ]);
  });

  it('voce trovata senza figli trovati: tiene i figli originali', () => {
    const r = filterMenuTree(albero, 'anagraf');
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('anag');
    expect(r[0].children).toBe(albero[0].children);
  });

  it('voce trovata con figli trovati: tiene solo quelli', () => {
    // Il filtro prende il padre e UNO solo dei figli.
    const menu = [voce('p', 'Stampe', [voce('a', 'Stampe fiscali'), voce('b', 'Registri')])];
    const r = filterMenuTree(menu, 'stampe');
    expect(ids(r)).toEqual([{ p: ['a'] }]);
  });
});

describe('filterMenuTree: voce senza descrizione (SXADV-5969)', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
  ])('descrizione %s: non esplode e non corrisponde per testo', (_nome, d) => {
    const menu = [voce('x', d), voce('home', 'Home')];
    expect(() => filterMenuTree(menu, 'home')).not.toThrow();
    expect(ids(filterMenuTree(menu, 'home'))).toEqual(['home']);
  });

  it('ramo senza descrizione: resta se un figlio corrisponde', () => {
    const menu = [voce('ramo', undefined, [voce('f1', 'Fatture'), voce('f2', 'Iscritti')])];
    expect(ids(filterMenuTree(menu, 'fatt'))).toEqual([{ ramo: ['f1'] }]);
  });

  it('figlio senza descrizione in un ramo trovato: nessuna eccezione', () => {
    const menu = [voce('ramo', 'Fatture', [voce('f1', null), voce('f2', 'Altro')])];
    expect(() => filterMenuTree(menu, 'fatt')).not.toThrow();
    const r = filterMenuTree(menu, 'fatt');
    expect(r[0].id).toBe('ramo');
    // Nessun figlio corrisponde: restano quelli originali.
    expect(r[0].children).toBe(menu[0].children);
  });

  it('senza descrizione e senza figli trovati: scartata', () => {
    const menu = [voce('ramo', undefined, [voce('f1', undefined)])];
    expect(filterMenuTree(menu, 'x')).toEqual([]);
  });
});
