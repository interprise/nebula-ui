import { describe, it, expect } from 'vitest';
import { rememberTree, recallTree, type TreeSnapshot } from './treeMemory';

// SXADV-6146.1: albero con dettaglio (TreeRenderer). Si passa a un'altra
// scheda e si torna: l'albero era richiuso, il nodo scelto e il pannello di
// destra spariti. TreeRenderer smonta lasciando la scheda; lo stato si ricorda
// fuori, per IDENTITA' dell'oggetto `ui` della resa che la scheda conserva.
// Qui si prova quello che il modulo PROMETTE:
//
//  - stesso oggetto: torna l'ultima fotografia ricordata;
//  - oggetto diverso, anche identico nel contenuto (risposta nuova del
//    server, funzione riaperta dal menu): niente;
//  - ricordare di nuovo sullo stesso oggetto sostituisce;
//  - oggetti diversi non si disturbano.

function snap(over: Partial<TreeSnapshot> = {}): TreeSnapshot {
  return {
    expandedKeys: [],
    loadedKeys: [],
    treeData: [{ key: 'A', title: 'Radice' }],
    filteredData: null,
    searchText: '',
    selectedKey: null,
    detailUi: null,
    detailFormValues: {},
    detailCaptions: {},
    ...over,
  };
}

function treeUi(): object {
  return { viewName: 'pianoContiTree', path: 'S1-3', navigateView: 'pianoContiDetail', treeNodes: [{ key: 'A', title: 'Radice' }] };
}

describe('treeMemory (SXADV-6146.1)', () => {
  it('una resa mai vista non ha niente da ricordare', () => {
    expect(recallTree(treeUi())).toBeUndefined();
  });

  it('stesso oggetto ui: torna la fotografia ricordata, intera', () => {
    const ui = treeUi();
    const s = snap({
      expandedKeys: ['A', 'A.1'],
      loadedKeys: ['A'],
      treeData: [{ key: 'A', title: 'Radice', children: [{ key: 'A.1', title: 'Figlio', isLeaf: true }] }],
      filteredData: [{ key: 'A.1', title: 'Figlio', matched: true }],
      searchText: 'fig',
      selectedKey: 'A.1',
      detailUi: { rows: [], viewName: 'pianoContiDetail' } as unknown as TreeSnapshot['detailUi'],
      detailFormValues: { descrizione: 'Cassa', conto: '0101' },
      detailCaptions: { conto: '0101 - Cassa contanti' },
    });
    rememberTree(ui, s);
    const back = recallTree(ui);
    expect(back).toBeDefined();
    expect(back).toEqual(s);
    expect(back!.selectedKey).toBe('A.1');
    expect(back!.detailUi).toBe(s.detailUi);
  });

  it('oggetto diverso ma uguale nel contenuto: non si ricorda niente', () => {
    const ui = treeUi();
    rememberTree(ui, snap({ selectedKey: 'A' }));
    const riaperta = treeUi();
    expect(riaperta).toEqual(ui);
    expect(recallTree(riaperta)).toBeUndefined();
    // e l'originale resta com'era
    expect(recallTree(ui)?.selectedKey).toBe('A');
  });

  it('ricordare di nuovo sullo stesso oggetto sostituisce la fotografia', () => {
    const ui = treeUi();
    rememberTree(ui, snap({ selectedKey: 'A', expandedKeys: ['A'] }));
    rememberTree(ui, snap({ selectedKey: 'B', expandedKeys: [] }));
    const back = recallTree(ui);
    expect(back?.selectedKey).toBe('B');
    expect(back?.expandedKeys).toEqual([]);
  });

  it('due schede, due rese: non si disturbano', () => {
    const s1 = treeUi();
    const s2 = treeUi();
    rememberTree(s1, snap({ selectedKey: 'X', searchText: 'uno' }));
    rememberTree(s2, snap({ selectedKey: 'Y', searchText: 'due' }));
    expect(recallTree(s1)?.selectedKey).toBe('X');
    expect(recallTree(s1)?.searchText).toBe('uno');
    expect(recallTree(s2)?.selectedKey).toBe('Y');
    expect(recallTree(s2)?.searchText).toBe('due');
    rememberTree(s2, snap({ selectedKey: 'Z' }));
    expect(recallTree(s1)?.selectedKey).toBe('X');
  });
});
