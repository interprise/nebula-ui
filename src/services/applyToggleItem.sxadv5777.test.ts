import { describe, it, expect, vi } from 'vitest';
import { applyToggleItem, notifyToggleItem, subscribeToggleItem } from './applyToggleItem';
import { hydrate } from './hydrate';
import type { UICell, UIControl, UIRow, UITree } from '../types/ui';

// SXADV-5777: in "Configura campi" il clic sul pallino deve cambiarlo subito a
// schermo, per i campi di un dettaglio e per le colonne di una lista in un tab,
// trasversalmente. Il server risponde solo { toggleItem: { itemId, included } } e
// il client gira il pallino sull'albero che ha: applyToggleItem promette di farlo
// in OGNI punto dove quell'itemId compare, senza toccare gli altri, restituendo lo
// stesso `ui` se niente cambia e copiando solo lungo il percorso toccato.
//
// Le forme vengono da una risposta vera del server (Anagrafica Unica in modo
// configurazione): nomi e valori qui sono inventati. In quella risposta i campi
// stanno a 1-3 livelli di cell.rows e portano il pallino nel TEMPLATE, mentre il
// tab arriva intero nei VALUES, con linguette, contentRows e control.headers.

type Icon = { itemId: string; included: boolean };

const icon = (itemId: string, included = true): Icon => ({ itemId, included });

const field = (name: string, itemId?: string, included = true): UIControl =>
  ({
    name,
    controlName: name,
    type: 'text',
    editable: true,
    ...(itemId ? { configureIcon: icon(itemId, included) } : {}),
  }) as unknown as UIControl;

const fieldCell = (ctl: UIControl, id = `c-${ctl.name}`): UICell =>
  ({ id, colspan: 1, elementType: 1, control: ctl }) as unknown as UICell;

const nestCell = (rows: UIRow[], id: string): UICell =>
  ({ id, colspan: 12, elementType: 7, rows }) as unknown as UICell;

const row = (id: string, ...cells: UICell[]): UIRow => ({ id, cells });

const tree = (...rows: UIRow[]): UITree => ({ rows, viewName: 'vistaProva' }) as UITree;

/** Blocca l'originale: una scrittura in place in un modulo ESM lancia TypeError. */
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o as object).forEach(deepFreeze);
  }
  return o;
}

/** Tutti i pallini dell'albero, ovunque stiano: non ricalca il percorso del codice. */
function collectIcons(node: unknown, path = 'ui', out: Record<string, Icon> = {}): Record<string, Icon> {
  if (Array.isArray(node)) {
    node.forEach((x, i) => collectIcons(x, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'configureIcon') out[path] = v as Icon;
      else collectIcons(v, `${path}.${k}`, out);
    }
  }
  return out;
}

/** I percorsi di un itemId con il loro stato. */
const statesOf = (ui: UITree, itemId: string) =>
  Object.values(collectIcons(ui)).filter((i) => i.itemId === itemId).map((i) => i.included);

/** Controlla il contratto completo su un albero: tutti girati, gli altri fermi. */
function expectOnlyFlipped(before: UITree, after: UITree, itemId: string, included: boolean) {
  const prima = collectIcons(before);
  const dopo = collectIcons(after);
  expect(Object.keys(dopo).sort()).toEqual(Object.keys(prima).sort());
  for (const [p, ic] of Object.entries(prima)) {
    expect(dopo[p], p).toEqual(ic.itemId === itemId ? { itemId, included } : ic);
  }
}

// ---------------------------------------------------------------------------
// Fixture: template + values come li manda il server, da idratare davvero.
// ---------------------------------------------------------------------------

const LISTA_NEL_TAB = {
  type: 'detailView',
  name: 'tabServizi.S1-0',
  controlName: 'tabServizi',
  viewName: 'serviziList',
  contentViewName: 'serviziList',
  viewType: 'list',
  layoutType: 'horizontal',
  configureIcon: icon('schedaTab.tabServizi'),
  totalCols: 16,
  totalWidth: 800,
  hasDetailView: true,
  headers: [
    { colspan: 2, text: '', type: 'selector' }, // il selettore non ha pallino
    { colspan: 10, name: 'servizio', text: 'Servizio', configureIcon: icon('serviziList.servizio') },
    { colspan: 4, name: 'attivo', text: 'Attivo', configureIcon: icon('serviziList.attivo', false) },
  ],
  columns: [{ elementType: 5 }, { elementType: 1 }, { elementType: 1 }],
  rows: [
    row('r0',
      { colspan: 2, elementType: 5 } as unknown as UICell,
      { colspan: 10, elementType: 1, control: { value: 'Servizio finto', displayValue: 'Servizio finto' } } as unknown as UICell),
  ],
  gridActions: { addCommand: 'Add', addLabel: 'Nuovo' },
};

const TAB_VALUE = {
  type: 'tab',
  name: 'tabControl',
  controlName: 'tabControl',
  configureIcon: icon('schedaTab.tabControl'),
  contentViewName: 'serviziList',
  tabs: [
    { name: 'tabServizi.S1-0', prompt: 'Servizi', selected: true, contentViewName: 'serviziList', configureIcon: icon('schedaTab.tabServizi') },
    { name: 'tabNote.S1-0', prompt: 'Note', contentViewName: 'noteList', configureIcon: icon('schedaTab.tabNote', false) },
  ],
  contentRows: [row('tr0', { colspan: 16, elementType: 7, id: 'tc0', cls: 'x', control: LISTA_NEL_TAB } as unknown as UICell)],
};

const RISPOSTA = {
  template: {
    path: 'S1-0.0',
    pageType: 2,
    viewName: 'testaDetail',
    totalCols: 16,
    templateKey: 'testaDetail:2:cfg',
    rows: [
      row('a',
        nestCell([ // livello 1
          row('a1',
            fieldCell(field('codice', 'testaDetail.codice')),
            nestCell([ // livello 2
              row('a2',
                fieldCell(field('nome', 'corpoDetail.nome')),
                fieldCell(field('cognome', 'corpoDetail.cognome', false)),
                nestCell([ // livello 3
                  row('a3', fieldCell(field('via', 'indirizziDetail.via')), fieldCell(field('senzaPallino'))),
                ], 'n3')),
            ], 'n2')),
        ], 'n1')),
      row('b', fieldCell(field('tabControl', 'schedaTab.tabControl'))),
    ],
  } as unknown as UITree,
  values: {
    codice: 'X1',
    nome: 'Mario',
    tabControl: TAB_VALUE,
  },
  dynProps: {},
  bindings: { '': 'S1-0' },
  scopePaths: { '': 'S1-0.0' },
};

const idratato = (): UITree =>
  hydrate(RISPOSTA.template, RISPOSTA.values as never, RISPOSTA.dynProps, RISPOSTA.bindings, RISPOSTA.scopePaths);

describe('fixture: idratata con hydrate ha le forme della risposta vera', () => {
  it('pallini nel template per i campi, nei values per tab e colonne', () => {
    const ui = idratato();
    const percorsi = Object.keys(collectIcons(ui));
    expect(percorsi.some((p) => /rows\[\d+\]\.cells\[\d+\]\.rows\[\d+\]\.cells\[\d+\]\.rows\[\d+\]\.cells\[\d+\]\.rows\[\d+\]\.cells\[\d+\]\.control$/.test(p))).toBe(true);
    expect(percorsi.some((p) => /\.control\.tabs\[\d+\]$/.test(p))).toBe(true);
    expect(percorsi.some((p) => /\.control\.contentRows\[\d+\]\.cells\[\d+\]\.control\.headers\[\d+\]$/.test(p))).toBe(true);
    expect(statesOf(ui, 'schedaTab.tabServizi')).toHaveLength(2); // linguetta + contenuto
  });
});

describe('giro sull\'albero idratato', () => {
  it.each([
    ['campo di testata, livello 1', 'testaDetail.codice', 1],
    ['campo, livello 2', 'corpoDetail.nome', 1],
    ['campo, livello 3', 'indirizziDetail.via', 1],
    ['il controllo tab', 'schedaTab.tabControl', 1],
    ['linguetta + controllo del contenuto', 'schedaTab.tabServizi', 2],
    ['colonna di lista nel tab', 'serviziList.servizio', 1],
  ])('%s: gira tutti i punti e nessun altro', (_n, itemId, quanti) => {
    const ui = deepFreeze(idratato());
    const out = applyToggleItem(ui, itemId, false);
    expect(out).not.toBe(ui);
    expect(statesOf(out, itemId)).toEqual(Array(quanti).fill(false));
    expectOnlyFlipped(ui, out, itemId, false);
  });

  it('da rosso a verde: linguetta e colonna partite escluse', () => {
    const ui = deepFreeze(idratato());
    for (const id of ['schedaTab.tabNote', 'serviziList.attivo', 'corpoDetail.cognome']) {
      const out = applyToggleItem(ui, id, true);
      expect(statesOf(out, id)).toEqual([true]);
      expectOnlyFlipped(ui, out, id, true);
    }
  });

  it('andata e ritorno true->false->true torna uguale all\'originale, su ogni pallino', () => {
    const ui = deepFreeze(idratato());
    const ids = new Set(Object.values(collectIcons(ui)).filter((i) => i.included).map((i) => i.itemId));
    expect(ids.size).toBeGreaterThan(5);
    for (const id of ids) {
      const spento = deepFreeze(applyToggleItem(ui, id, false));
      expect(statesOf(spento, id).every((s) => s === false), id).toBe(true);
      const riacceso = applyToggleItem(spento, id, true);
      expect(riacceso, id).toEqual(ui);
      expect(riacceso, id).not.toBe(spento);
    }
  });

  it('itemId inesistente: stesso riferimento', () => {
    const ui = deepFreeze(idratato());
    expect(applyToggleItem(ui, 'nessuna.vista', false)).toBe(ui);
  });

  it('stato gia\' quello chiesto: stesso riferimento', () => {
    const ui = deepFreeze(idratato());
    expect(applyToggleItem(ui, 'testaDetail.codice', true)).toBe(ui);
    expect(applyToggleItem(ui, 'serviziList.attivo', false)).toBe(ui);
    expect(applyToggleItem(ui, 'schedaTab.tabServizi', true)).toBe(ui);
  });

  it('non muta l\'originale, anche senza congelarlo', () => {
    const ui = idratato();
    const prima = JSON.stringify(ui);
    applyToggleItem(ui, 'schedaTab.tabServizi', false);
    applyToggleItem(ui, 'serviziList.servizio', false);
    applyToggleItem(ui, 'indirizziDetail.via', false);
    expect(JSON.stringify(ui)).toBe(prima);
  });

  it('non tocca template e values della risposta, da cui si reidrata', () => {
    const prima = JSON.stringify(RISPOSTA);
    applyToggleItem(idratato(), 'testaDetail.codice', false);
    applyToggleItem(idratato(), 'serviziList.servizio', false);
    expect(JSON.stringify(RISPOSTA)).toBe(prima);
  });

  it('una colonna girata conserva il resto dell\'intestazione e le altre colonne', () => {
    const ui = idratato();
    const out = applyToggleItem(ui, 'serviziList.servizio', false);
    const lista = (a: UITree) =>
      a.rows[1].cells[0].control!.contentRows![0].cells[0].control as unknown as typeof LISTA_NEL_TAB;
    expect(lista(out).headers[1]).toEqual({ ...LISTA_NEL_TAB.headers[1], configureIcon: icon('serviziList.servizio', false) });
    expect(lista(out).headers[0]).toBe(lista(ui).headers[0]);
    expect(lista(out).headers[2]).toBe(lista(ui).headers[2]);
    // righe e colonne dell'albero non cambiano identita'...
    expect(lista(out).rows).toBe(lista(ui).rows);
    expect(lista(out).columns).toBe(lista(ui).columns);
    // ...ma l'array delle intestazioni si', e il useMemo di colonne e righe di
    // ListRenderer dipende da ui.headers: la griglia i dati li rifa'.
    expect(lista(out).headers).not.toBe(lista(ui).headers);
  });
});

describe('copia solo lungo il percorso toccato', () => {
  it('campo annidato: i fratelli a ogni livello restano gli stessi', () => {
    const ui = idratato();
    const out = applyToggleItem(ui, 'indirizziDetail.via', false);
    expect(out.rows[1]).toBe(ui.rows[1]); // il tab
    const l1 = ui.rows[0].cells[0].rows![0];
    const l1o = out.rows[0].cells[0].rows![0];
    expect(l1o).not.toBe(l1);
    expect(l1o.cells[0]).toBe(l1.cells[0]); // codice
    const l2 = l1.cells[1].rows![0];
    const l2o = l1o.cells[1].rows![0];
    expect(l2o.cells[0]).toBe(l2.cells[0]); // nome
    expect(l2o.cells[1]).toBe(l2.cells[1]); // cognome
    const l3 = l2.cells[2].rows![0];
    const l3o = l2o.cells[2].rows![0];
    expect(l3o.cells[1]).toBe(l3.cells[1]); // senzaPallino
    expect(l3o.cells[0]).not.toBe(l3.cells[0]);
  });

  it('colonna nel tab: il dettaglio accanto e le linguette restano gli stessi', () => {
    const ui = idratato();
    const out = applyToggleItem(ui, 'serviziList.servizio', false);
    expect(out.rows[0]).toBe(ui.rows[0]);
    const c = ui.rows[1].cells[0].control!;
    const co = out.rows[1].cells[0].control!;
    expect(co).not.toBe(c);
    expect(co.tabs).toBe(c.tabs);
  });

  it('solo una linguetta: contentRows e l\'altra linguetta restano gli stessi', () => {
    const ui = idratato();
    const out = applyToggleItem(ui, 'schedaTab.tabNote', true);
    const c = ui.rows[1].cells[0].control!;
    const co = out.rows[1].cells[0].control!;
    expect(co.contentRows).toBe(c.contentRows);
    expect(co.tabs![0]).toBe(c.tabs![0]);
    expect(co.tabs![1]).not.toBe(c.tabs![1]);
  });

  it('colonna di pagina: ui.rows resta lo stesso; campo: ui.headers resta lo stesso', () => {
    const ui = deepFreeze({
      ...tree(row('a', fieldCell(field('x', 'v.x')))),
      headers: [{ name: 'k', text: 'K', configureIcon: icon('v.k') }, { name: 'j', text: 'J' }],
    } as UITree);
    const colonna = applyToggleItem(ui, 'v.k', false);
    expect(colonna.rows).toBe(ui.rows);
    expect(colonna.headers![0].configureIcon).toEqual(icon('v.k', false));
    expect(colonna.headers![1]).toBe(ui.headers![1]);
    const campo = applyToggleItem(ui, 'v.x', false);
    expect(campo.headers).toBe(ui.headers);
    expect(campo.rows).not.toBe(ui.rows);
  });
});

describe('dove compare lo stesso itemId', () => {
  it('match esatto: non scambia i nomi con lo stesso prefisso o di un\'altra vista', () => {
    const ui = deepFreeze(tree(row('a',
      fieldCell(field('a1', 'v.a1')),
      fieldCell(field('a10', 'v.a10')),
      fieldCell(field('a1b', 'altra.a1')),
      fieldCell(field('a1c', 'zv.a1')),
    )));
    const out = applyToggleItem(ui, 'v.a1', false);
    expectOnlyFlipped(ui, out, 'v.a1', false);
    expect(statesOf(out, 'v.a10')).toEqual([true]);
    expect(applyToggleItem(ui, 'v', false)).toBe(ui);
    expect(applyToggleItem(ui, '', false)).toBe(ui);
  });

  it('stesso id in punti diversi: tutti girati, anche fra ui.headers, celle e bottoni', () => {
    const ui = deepFreeze({
      ...tree(
        row('a', fieldCell(field('x', 'v.x'))),
        row('b', nestCell([row('c', fieldCell(field('x2', 'v.x')))], 'n')),
        row('d', fieldCell({
          name: 'barra',
          type: 'buttonBar',
          buttons: [{ name: 'b1', type: 'button', configureIcon: icon('v.x') }, { name: 'b2', type: 'button', configureIcon: icon('v.b2') }],
        } as unknown as UIControl)),
      ),
      headers: [{ name: 'x', text: 'X', configureIcon: icon('v.x') }],
    } as UITree);
    const out = applyToggleItem(ui, 'v.x', false);
    expect(statesOf(out, 'v.x')).toEqual([false, false, false, false]);
    expectOnlyFlipped(ui, out, 'v.x', false);
  });

  it('stato misto: gira solo quello diverso, l\'altro resta lo stesso oggetto', () => {
    const ui = deepFreeze(tree(row('a', fieldCell(field('x', 'v.x', false)), fieldCell(field('y', 'v.x', true)))));
    const out = applyToggleItem(ui, 'v.x', false);
    expect(statesOf(out, 'v.x')).toEqual([false, false]);
    expect(out.rows[0].cells[0]).toBe(ui.rows[0].cells[0]);
  });

  it('cella con control E rows: gira entrambi', () => {
    const ui = deepFreeze(tree(row('a', {
      ...fieldCell(field('contenitore', 'v.k')),
      rows: [row('b', fieldCell(field('dentro', 'v.k')))],
    } as UICell)));
    expect(statesOf(applyToggleItem(ui, 'v.k', false), 'v.k')).toEqual([false, false]);
  });

  it('un bottone di ButtonBar dentro il contenuto di un tab', () => {
    const ui = deepFreeze(tree(row('a', fieldCell({
      name: 'tab',
      type: 'tab',
      tabs: [],
      contentRows: [row('t', fieldCell({
        name: 'barra',
        type: 'buttonBar',
        buttons: [{ name: 'b1', type: 'navigateView', configureIcon: icon('v.b1') }],
      } as unknown as UIControl))],
    } as unknown as UIControl))));
    const out = applyToggleItem(ui, 'v.b1', false);
    expect(statesOf(out, 'v.b1')).toEqual([false]);
  });

  it('tab dentro il contenuto di un tab, con colonne e campi annidati', () => {
    const interno = {
      name: 'tabInterno',
      type: 'tab',
      tabs: [{ name: 'l', prompt: 'L', configureIcon: icon('v.l') }],
      contentRows: [row('i',
        nestCell([row('i2', fieldCell(field('f', 'v.f')))], 'ni'),
        fieldCell({ name: 'lista', type: 'detailView', headers: [{ name: 'h', text: 'H', configureIcon: icon('v.h') }] } as unknown as UIControl),
      )],
    } as unknown as UIControl;
    const ui = deepFreeze(tree(row('a', fieldCell({
      name: 'tabEsterno', type: 'tab', tabs: [], contentRows: [row('e', fieldCell(interno))],
    } as unknown as UIControl))));
    for (const id of ['v.l', 'v.f', 'v.h']) {
      const out = applyToggleItem(ui, id, false);
      expect(statesOf(out, id), id).toEqual([false]);
      expectOnlyFlipped(ui, out, id, false);
    }
  });

  it('albero minimo: senza righe, senza headers, intestazioni senza pallino', () => {
    const vuoto = deepFreeze(tree());
    expect(applyToggleItem(vuoto, 'v.x', false)).toBe(vuoto);
    const senza = deepFreeze({
      ...tree(row('a', { id: 'c', colspan: 1, elementType: 0 } as unknown as UICell)),
      headers: [{ name: 'k', text: 'K' }],
    } as UITree);
    expect(applyToggleItem(senza, 'v.x', false)).toBe(senza);
  });
});

// Punti che i renderer leggono e che il visitatore non percorre. Nella risposta di
// prova non portano pallini, ma il contratto e' "ogni punto" e il ticket chiede
// l'intervento trasversale: sotto, in ogni prova, cosa legge il renderer.
describe('punti dell\'albero da cui il renderer disegna un pallino', () => {
  it('control.rows di una vista incorporata (ViewRenderer: control.rows ?? control.contentRows)', () => {
    const ui = deepFreeze(tree(row('a', fieldCell({
      name: 'incorporata',
      type: 'embeddedView',
      rows: [row('e', fieldCell(field('f', 'v.f')))],
    } as unknown as UIControl))));
    expect(statesOf(applyToggleItem(ui, 'v.f', false), 'v.f')).toEqual([false]);
  });

  it('control.panelTemplate di una lista in un tab (pannello di riga idratato da li\')', () => {
    const ui = deepFreeze(tree(row('a', fieldCell({
      name: 'lista',
      type: 'detailView',
      headers: [{ name: 'f', text: 'F', configureIcon: icon('v.f') }],
      panelTemplate: { rows: [row('p', fieldCell(field('f', 'v.f')))], formShape: true },
    } as unknown as UIControl))));
    expect(statesOf(applyToggleItem(ui, 'v.f', false), 'v.f')).toEqual([false, false]);
  });

  it('ui.panelTemplate di una lista di pagina', () => {
    const ui = deepFreeze({
      ...tree(),
      headers: [{ name: 'f', text: 'F', configureIcon: icon('v.f') }],
      panelTemplate: { rows: [row('p', fieldCell(field('f', 'v.f')))] },
    } as UITree);
    expect(statesOf(applyToggleItem(ui, 'v.f', false), 'v.f')).toEqual([false, false]);
  });
});

// control.rows e' una griglia solo per alcuni controlli: una textarea ci mette il
// numero di righe, un controllo personalizzato i suoi dati.
describe('control.rows che non e\' una griglia', () => {
  const TEXTAREA = { name: 'note', type: 'textarea', rows: 5 };
  const PERSONALIZZATO = {
    name: 'classe',
    type: 'cdmsClass',
    rows: [
      { options: [{ value: 'a', text: 'A' }], selectedDescription: 'A' },
      { options: [], selectedDescription: '' },
    ],
  };

  it.each([
    ['numero (textarea)', TEXTAREA],
    ['zero', { ...TEXTAREA, rows: 0 }],
    ['array di oggetti senza cells', PERSONALIZZATO],
    ['oggetti con cells non array', { name: 'x', type: 'custom', rows: [{ cells: 3 }] }],
    ['elementi nulli o primitivi', { name: 'x', type: 'custom', rows: [null, 'a', 7] }],
    ['array vuoto', { name: 'x', type: 'custom', rows: [] }],
  ])('%s: nessuna eccezione e stesso riferimento', (_n, ctl) => {
    const ui = deepFreeze(tree(row('a', fieldCell(ctl as unknown as UIControl), fieldCell(field('f', 'v.f')))));
    expect(applyToggleItem(ui, 'altro.id', false)).toBe(ui);
    expect(applyToggleItem(ui, 'v.f', true)).toBe(ui); // gia' in quello stato
  });

  it('il campo accanto si gira, e il controllo con rows non-griglia resta lo stesso oggetto', () => {
    for (const ctl of [TEXTAREA, PERSONALIZZATO]) {
      const ui = deepFreeze(tree(row('a', fieldCell(ctl as unknown as UIControl), fieldCell(field('f', 'v.f')))));
      const out = applyToggleItem(ui, 'v.f', false);
      expect(statesOf(out, 'v.f')).toEqual([false]);
      expect(out.rows[0].cells[0]).toBe(ui.rows[0].cells[0]);
    }
  });

  it('il pallino del controllo stesso si gira e i suoi rows passano intatti', () => {
    for (const ctl of [TEXTAREA, PERSONALIZZATO]) {
      const conPallino = { ...ctl, configureIcon: icon('v.c') };
      const ui = deepFreeze(tree(row('a', fieldCell(conPallino as unknown as UIControl))));
      const out = applyToggleItem(ui, 'v.c', false);
      const control = out.rows[0].cells[0].control as unknown as typeof conPallino;
      expect(control.configureIcon).toEqual(icon('v.c', false));
      expect(control.rows).toBe(conPallino.rows);
    }
  });

  it('nei punti annidati: contenuto di un tab, vista incorporata, pannello di riga, ButtonBar', () => {
    const t = TEXTAREA as unknown as UIControl;
    const p = PERSONALIZZATO as unknown as UIControl;
    const dentro = () => row('i', fieldCell(t), fieldCell(p));
    const ui = deepFreeze(tree(
      row('tab', fieldCell({ name: 'tab', type: 'tab', tabs: [], contentRows: [dentro()] } as unknown as UIControl)),
      row('inc', fieldCell({ name: 'inc', type: 'embeddedView', rows: [dentro()] } as unknown as UIControl)),
      row('pan', fieldCell({ name: 'lista', type: 'detailView', panelTemplate: { rows: [dentro()] } } as unknown as UIControl)),
      row('bar', fieldCell({ name: 'barra', type: 'buttonBar', buttons: [t, p] } as unknown as UIControl)),
      row('nest', nestCell([dentro()], 'n')),
    ));
    expect(applyToggleItem(ui, 'altro.id', false)).toBe(ui);
  });

  it('accanto a una griglia vera: il campo dentro la griglia si gira, la textarea resta', () => {
    const ui = deepFreeze(tree(row('a', fieldCell({
      name: 'incorporata',
      type: 'embeddedView',
      rows: [row('e', fieldCell(TEXTAREA as unknown as UIControl), fieldCell(field('f', 'v.f')))],
    } as unknown as UIControl))));
    const out = applyToggleItem(ui, 'v.f', false);
    expect(statesOf(out, 'v.f')).toEqual([false]);
    const interna = (out.rows[0].cells[0].control as unknown as { rows: UIRow[] }).rows[0];
    expect((interna.cells[0].control as unknown as typeof TEXTAREA).rows).toBe(5);
  });

  it('passa da hydrate: la textarea nei values arriva con il suo numero', () => {
    const ui = deepFreeze(hydrate(
      tree(row('a', fieldCell(field('note')), fieldCell(field('f', 'v.f')))),
      { note: TEXTAREA } as never,
      {},
      { '': 'S1-0' },
      { '': 'S1-0.0' },
    ));
    expect((ui.rows[0].cells[0].control as unknown as typeof TEXTAREA).rows).toBe(5);
    expect(applyToggleItem(ui, 'altro.id', false)).toBe(ui);
    expect(statesOf(applyToggleItem(ui, 'v.f', false), 'v.f')).toEqual([false]);
  });
});

// Una lista su piu' bande: le colonne della seconda banda in poi stanno in
// continuationHeaders, una per banda, sia sulla pagina sia sul controllo.
describe('continuationHeaders', () => {
  const bande = () => [
    [
      { name: 'b0a', text: 'B0A', configureIcon: icon('v.b0a') },
      { name: 'b0b', text: 'B0B', configureIcon: icon('v.b0b', false) },
    ],
    [
      { name: 'b1a', text: 'B1A' }, // senza pallino
      { name: 'b1b', text: 'B1B', configureIcon: icon('v.b1b') },
    ],
  ];
  const pagina = () => deepFreeze({
    ...tree(row('a', fieldCell(field('x', 'v.x')))),
    headers: [{ name: 'h', text: 'H', configureIcon: icon('v.h') }],
    continuationHeaders: bande(),
  } as unknown as UITree);
  const controllo = () => deepFreeze(tree(
    row('a', fieldCell({
      name: 'lista',
      type: 'detailView',
      headers: [{ name: 'h', text: 'H', configureIcon: icon('v.h') }],
      continuationHeaders: bande(),
    } as unknown as UIControl)),
    row('b', fieldCell(field('x', 'v.x'))),
  ));
  type ConBande = { headers: { configureIcon?: Icon }[]; continuationHeaders: { name: string; configureIcon?: Icon }[][] };
  const delControllo = (ui: UITree) => ui.rows[0].cells[0].control as unknown as ConBande;

  it('pagina: gira la colonna, in qualunque banda, e nessun\'altra', () => {
    const ui = pagina();
    for (const [id, verso] of [['v.b0a', false], ['v.b0b', true], ['v.b1b', false]] as const) {
      const out = applyToggleItem(ui, id, verso);
      expect(statesOf(out, id), id).toEqual([verso]);
      expectOnlyFlipped(ui, out, id, verso);
    }
  });

  it('controllo: gira la colonna, in qualunque banda, e nessun\'altra', () => {
    const ui = controllo();
    for (const [id, verso] of [['v.b0a', false], ['v.b0b', true], ['v.b1b', false]] as const) {
      const out = applyToggleItem(ui, id, verso);
      expect(statesOf(out, id), id).toEqual([verso]);
      expectOnlyFlipped(ui, out, id, verso);
    }
  });

  it('pagina: copia solo la banda toccata, righe e headers restano gli stessi', () => {
    const ui = pagina();
    const out = applyToggleItem(ui, 'v.b1b', false);
    expect(out).not.toBe(ui);
    expect(out.rows).toBe(ui.rows);
    expect(out.headers).toBe(ui.headers);
    expect(out.continuationHeaders).not.toBe(ui.continuationHeaders);
    expect(out.continuationHeaders![0]).toBe(ui.continuationHeaders![0]);
    expect(out.continuationHeaders![1]).not.toBe(ui.continuationHeaders![1]);
    expect(out.continuationHeaders![1][0]).toBe(ui.continuationHeaders![1][0]);
    expect(out.continuationHeaders![1][1]).toEqual({ name: 'b1b', text: 'B1B', configureIcon: icon('v.b1b', false) });
  });

  it('controllo: copia solo la banda toccata, il resto dell\'albero resta lo stesso', () => {
    const ui = controllo();
    const out = applyToggleItem(ui, 'v.b0a', false);
    expect(out.rows[1]).toBe(ui.rows[1]);
    expect(delControllo(out).headers).toBe(delControllo(ui).headers);
    expect(delControllo(out).continuationHeaders[1]).toBe(delControllo(ui).continuationHeaders[1]);
    expect(delControllo(out).continuationHeaders[0][1]).toBe(delControllo(ui).continuationHeaders[0][1]);
    expect(delControllo(out).continuationHeaders[0][0].configureIcon).toEqual(icon('v.b0a', false));
  });

  it('colonna fuori dalle bande: l\'array delle bande resta lo stesso, su pagina e controllo', () => {
    const p = pagina();
    const po = applyToggleItem(p, 'v.h', false);
    expect(po.headers).not.toBe(p.headers);
    expect(po.continuationHeaders).toBe(p.continuationHeaders);
    const c = controllo();
    const co = applyToggleItem(c, 'v.h', false);
    expect(delControllo(co).continuationHeaders).toBe(delControllo(c).continuationHeaders);
  });

  it('niente da girare o gia\' nello stato chiesto: stesso riferimento', () => {
    for (const ui of [pagina(), controllo()]) {
      expect(applyToggleItem(ui, 'nessuna.vista', false)).toBe(ui);
      expect(applyToggleItem(ui, 'v.b0a', true)).toBe(ui);
      expect(applyToggleItem(ui, 'v.b0b', false)).toBe(ui);
    }
  });

  it('bande vuote o assenti: stesso riferimento', () => {
    const vuote = deepFreeze({ ...tree(), continuationHeaders: [] } as unknown as UITree);
    expect(applyToggleItem(vuote, 'v.x', false)).toBe(vuote);
    const bandaVuota = deepFreeze({ ...tree(), continuationHeaders: [[]] } as unknown as UITree);
    expect(applyToggleItem(bandaVuota, 'v.x', false)).toBe(bandaVuota);
    const ctl = deepFreeze(tree(row('a', fieldCell({ name: 'l', type: 'detailView', continuationHeaders: [] } as unknown as UIControl))));
    expect(applyToggleItem(ctl, 'v.x', false)).toBe(ctl);
  });

  it('lo stesso itemId in headers, in piu\' bande e in un campo: tutti girati', () => {
    const ui = deepFreeze({
      ...tree(row('a', fieldCell(field('k', 'v.k')))),
      headers: [{ name: 'k', text: 'K', configureIcon: icon('v.k') }],
      continuationHeaders: [
        [{ name: 'k', text: 'K', configureIcon: icon('v.k') }],
        [{ name: 'k', text: 'K', configureIcon: icon('v.k') }],
      ],
    } as unknown as UITree);
    const out = applyToggleItem(ui, 'v.k', false);
    expect(statesOf(out, 'v.k')).toEqual([false, false, false, false]);
  });

  it('una lista in un tab, con le bande sul controllo', () => {
    const ui = deepFreeze(tree(row('a', fieldCell({
      name: 'tab',
      type: 'tab',
      tabs: [],
      contentRows: [row('t', fieldCell({
        name: 'lista', type: 'detailView', continuationHeaders: bande(),
      } as unknown as UIControl))],
    } as unknown as UIControl))));
    const out = applyToggleItem(ui, 'v.b1b', false);
    expect(statesOf(out, 'v.b1b')).toEqual([false]);
    expectOnlyFlipped(ui, out, 'v.b1b', false);
  });

  it('andata e ritorno torna uguale all\'originale', () => {
    for (const ui of [pagina(), controllo()]) {
      const spento = deepFreeze(applyToggleItem(ui, 'v.b1b', false));
      expect(applyToggleItem(spento, 'v.b1b', true)).toEqual(ui);
    }
  });
});

describe('subscribeToggleItem / notifyToggleItem', () => {
  it('chi e\' iscritto riceve itemId e included', () => {
    const fn = vi.fn();
    const via = subscribeToggleItem(fn);
    try {
      notifyToggleItem('v.x', false);
      notifyToggleItem('v.y', true);
      expect(fn.mock.calls).toEqual([['v.x', false], ['v.y', true]]);
    } finally {
      via();
    }
  });

  it('dopo la disiscrizione non riceve piu\'', () => {
    const fn = vi.fn();
    const via = subscribeToggleItem(fn);
    notifyToggleItem('v.x', false);
    via();
    notifyToggleItem('v.x', true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('piu\' iscritti: tutti ricevono, e togliersi non toglie gli altri', () => {
    const a = vi.fn();
    const b = vi.fn();
    const viaA = subscribeToggleItem(a);
    const viaB = subscribeToggleItem(b);
    try {
      notifyToggleItem('v.x', true);
      viaA();
      viaA(); // disiscriversi due volte non fa danni
      notifyToggleItem('v.y', false);
      expect(a.mock.calls).toEqual([['v.x', true]]);
      expect(b.mock.calls).toEqual([['v.x', true], ['v.y', false]]);
    } finally {
      viaB();
    }
  });

  it('togliersi durante la notifica non salta gli altri', () => {
    const b = vi.fn();
    const viaA = subscribeToggleItem(() => viaA());
    const viaB = subscribeToggleItem(b);
    try {
      notifyToggleItem('v.x', false);
      expect(b).toHaveBeenCalledTimes(1);
    } finally {
      viaB();
    }
  });

  it('nessun iscritto: notificare non fa niente', () => {
    expect(() => notifyToggleItem('v.x', false)).not.toThrow();
  });
});
