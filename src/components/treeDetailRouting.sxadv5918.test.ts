import { describe, it, expect } from 'vitest';
import type { UITree } from '../types/ui';
import { treeHoldingTab, routesToTreePane } from './treeDetailRouting';

// SXADV-5918.1: albero+dettaglio (Anagrafiche -> Tabelle -> Categorie
// Statistiche). La scheda e' l'albero `anagraficheStatisticheTree`, la sua
// navigateView e' `anagraficheStatisticheDetail`, che incorpora la lista
// listEdit "Figlie". Il "Nuovo" della lista incorporata manda `Add`: la
// risposta e' il dettaglio (templateKey `anagraficheStatisticheDetail:2`,
// diverso da quello della scheda). La regola SXADV-5888 ("cambio di template =
// si e' lasciata la lista, disarma l'Add") non deve scattare quando la
// risposta va nel pannello di destra dell'albero; deve continuare a scattare
// fuori dagli alberi, per un record NUOVO del dettaglio stesso e per un'altra
// vista.

const TREE = 'anagraficheStatisticheTree';
const DETAIL = 'anagraficheStatisticheDetail';

function ui(p: Partial<UITree>): UITree {
  return p as UITree;
}

const treeTab = ui({ viewName: TREE, viewType: 'tree', navigateView: DETAIL });
const detailResp = ui({ viewName: DETAIL, viewType: 'detail' });

describe('treeHoldingTab', () => {
  it('scheda assente -> undefined', () => {
    expect(treeHoldingTab(undefined)).toBeUndefined();
  });

  it('albero con navigateView -> la ui stessa (stesso oggetto)', () => {
    expect(treeHoldingTab(treeTab)).toBe(treeTab);
  });

  it('albero senza navigateView -> undefined', () => {
    expect(treeHoldingTab(ui({ viewName: TREE, viewType: 'tree' }))).toBeUndefined();
  });

  it('albero con navigateView vuota -> undefined', () => {
    expect(treeHoldingTab(ui({ viewName: TREE, viewType: 'tree', navigateView: '' }))).toBeUndefined();
  });

  it('vista non albero con navigateView -> undefined', () => {
    expect(treeHoldingTab(ui({ viewName: 'x', viewType: 'list', navigateView: DETAIL }))).toBeUndefined();
    expect(treeHoldingTab(ui({ viewName: 'x', viewType: 'detail', navigateView: DETAIL }))).toBeUndefined();
  });

  it('viewType assente -> undefined anche con treeNodes e navigateView', () => {
    expect(
      treeHoldingTab(ui({ viewName: TREE, navigateView: DETAIL, treeNodes: [] })),
    ).toBeUndefined();
  });

  it('viewType e\' confrontato alla lettera (TREE maiuscolo non vale)', () => {
    expect(treeHoldingTab(ui({ viewType: 'TREE', navigateView: DETAIL }))).toBeUndefined();
  });
});

describe('routesToTreePane', () => {
  it('caso 5918.1: il dettaglio dell\'albero (Nuovo della lista incorporata) -> true', () => {
    expect(routesToTreePane(treeTab, detailResp, false)).toBe(true);
  });

  it('nessun albero -> false', () => {
    expect(routesToTreePane(undefined, detailResp, false)).toBe(false);
  });

  it('record nuovo del dettaglio stesso -> false (si apre a pagina intera)', () => {
    expect(routesToTreePane(treeTab, detailResp, true)).toBe(false);
  });

  it('vista diversa dalla navigateView -> false', () => {
    expect(routesToTreePane(treeTab, ui({ viewName: 'altraDetail', viewType: 'detail' }), false)).toBe(false);
  });

  it('risposta che e\' essa stessa un albero -> false, anche con lo stesso nome', () => {
    expect(routesToTreePane(treeTab, ui({ viewName: DETAIL, viewType: 'tree' }), false)).toBe(false);
    expect(routesToTreePane(treeTab, ui({ viewName: TREE, viewType: 'tree', navigateView: DETAIL }), false)).toBe(false);
  });

  it('risposta con treeNodes (anche vuoti) -> false', () => {
    expect(routesToTreePane(treeTab, ui({ viewName: DETAIL, viewType: 'detail', treeNodes: [] }), false)).toBe(false);
    expect(routesToTreePane(treeTab, ui({ viewName: DETAIL, treeNodes: [] }), false)).toBe(false);
  });

  it('viewName assente sulla risposta con navigateView presente -> false', () => {
    expect(routesToTreePane(treeTab, ui({ viewType: 'detail' }), false)).toBe(false);
  });

  it('viewType assente sulla risposta ma nome giusto -> true', () => {
    expect(routesToTreePane(treeTab, ui({ viewName: DETAIL }), false)).toBe(true);
  });

  it('il confronto del nome e\' esatto (maiuscole, prefissi)', () => {
    expect(routesToTreePane(treeTab, ui({ viewName: DETAIL.toUpperCase() }), false)).toBe(false);
    expect(routesToTreePane(treeTab, ui({ viewName: DETAIL + 'X' }), false)).toBe(false);
  });

  it('non guarda il templateKey: il dettaglio via template `:2` resta instradato', () => {
    expect(
      routesToTreePane(treeTab, ui({ viewName: DETAIL, viewType: 'detail', templateKey: `${DETAIL}:2` }), false),
    ).toBe(true);
  });
});

describe('composizione treeHoldingTab -> routesToTreePane', () => {
  it('albero senza navigateView e risposta senza viewName: undefined===undefined NON instrada', () => {
    const tab = ui({ viewName: TREE, viewType: 'tree' });
    expect(routesToTreePane(treeHoldingTab(tab), ui({ viewType: 'detail' }), false)).toBe(false);
  });

  it('scheda non albero senza navigateView e risposta senza viewName -> false', () => {
    const tab = ui({ viewName: 'lista', viewType: 'list' });
    expect(routesToTreePane(treeHoldingTab(tab), ui({ viewType: 'detail' }), false)).toBe(false);
  });

  it('scheda non albero che dichiara navigateView -> false anche se il nome combacia', () => {
    const tab = ui({ viewName: 'lista', viewType: 'list', navigateView: DETAIL });
    expect(routesToTreePane(treeHoldingTab(tab), detailResp, false)).toBe(false);
  });

  it('scheda assente -> false', () => {
    expect(routesToTreePane(treeHoldingTab(undefined), detailResp, false)).toBe(false);
  });
});

// La decisione di Shell (ramo METADATA): disarma il "Nuovo" armato quando il
// template cambia E la risposta non va nel pannello dell'albero.
//   if (resp.templateKey !== prevTemplateKey && !routesToTreePane(treeUi, hydrated, !!resp.newRecord))
//     pendingAddRef.current = false;
function disarmsAdd(
  tabUi: UITree | undefined,
  prevTemplateKey: string | undefined,
  respTemplateKey: string,
  respUi: UITree,
  newRecord: boolean,
): boolean {
  return respTemplateKey !== prevTemplateKey &&
    !routesToTreePane(treeHoldingTab(tabUi), respUi, newRecord);
}

describe('disarmo del Nuovo (SXADV-5888 vs SXADV-5918.1)', () => {
  it('5918.1: Nuovo di Figlie nel dettaglio dell\'albero -> resta armato', () => {
    expect(
      disarmsAdd(treeTab, TREE, `${DETAIL}:2`, ui({ viewName: DETAIL, viewType: 'detail' }), false),
    ).toBe(false);
  });

  it('5888: lista il cui Nuovo apre un altro dettaglio a pagina intera -> disarma', () => {
    const listTab = ui({ viewName: 'clientiList', viewType: 'list' });
    expect(
      disarmsAdd(listTab, 'clientiList', 'clientiDetail', ui({ viewName: 'clientiDetail', viewType: 'detail' }), true),
    ).toBe(true);
    // anche se il server non marcasse la risposta come record nuovo
    expect(
      disarmsAdd(listTab, 'clientiList', 'clientiDetail', ui({ viewName: 'clientiDetail', viewType: 'detail' }), false),
    ).toBe(true);
  });

  it('albero, record NUOVO del dettaglio stesso -> disarma', () => {
    expect(disarmsAdd(treeTab, TREE, DETAIL, detailResp, true)).toBe(true);
  });

  it('albero, risposta di un\'altra vista -> disarma', () => {
    expect(disarmsAdd(treeTab, TREE, 'altraView', ui({ viewName: 'altraView', viewType: 'list' }), false)).toBe(true);
  });

  it('albero, risposta che e\' un albero -> disarma', () => {
    expect(
      disarmsAdd(treeTab, TREE, 'altroTree', ui({ viewName: 'altroTree', viewType: 'tree', treeNodes: [] }), false),
    ).toBe(true);
  });

  it('template invariato -> mai disarmato da questa regola, albero o no', () => {
    const listTab = ui({ viewName: 'lista', viewType: 'listEdit' });
    expect(disarmsAdd(listTab, 'lista', 'lista', ui({ viewName: 'lista' }), false)).toBe(false);
    expect(disarmsAdd(treeTab, DETAIL, DETAIL, ui({ viewName: 'altro' }), true)).toBe(false);
  });

  it('scheda nuova (nessun template precedente) fuori da un albero -> disarma', () => {
    expect(disarmsAdd(undefined, undefined, 'x', ui({ viewName: 'x' }), false)).toBe(true);
  });
});
