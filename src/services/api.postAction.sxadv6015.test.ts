import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postAction } from './api';

// SXADV-6015 — le azioni che lasciano la pagina di una lista multiEdit e il cui
// navpath e' IL PERCORSO DELLA LISTA STESSA (il client manda ui.path, con la
// posizione: "S1-3.0" per una lista di primo livello, "S1-5.2,S1-8.0" per una
// griglia incorporata): LocateRow, FilterRows, DetailPage. Il server applica
// l'array di colonna di quella lista alla pagina che si lascia; se non parte, le
// spunte della pagina a schermo si perdono. Anche SortColumn (Ordina) manda
// ui.path della lista come navpath e si comporta allo stesso modo. Prima della
// correzione withoutPositionalArrays li toglieva
// perche' il segmento ha una posizione.
//
// Le altre azioni con navpath di riga (Post, Save, NavigateDetail, ...) continuano
// a non mandarli (SXADV-6011): il server li leggerebbe come valori della riga.
//
// Prova a livello di api.postAction con fetch intercettata: il test di Shell
// mockava postAction, ed e' per questo che il difetto non si vedeva.

let fetchMock: ReturnType<typeof vi.fn>;

function sentBody(): URLSearchParams {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return new URLSearchParams(String(init.body));
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOP = 'S1-3';
const TOP_PATH = `${TOP}.0`;
const GRID = 'S1-8';
const GRID_PATH = `S1-5.2,${GRID}.0`;

type Case = [action: string, navpath: string, list: string, extra: Record<string, string>];

const LEAVING: Case[] = [
  ['LocateRow', TOP_PATH, TOP, { option1: 'rossi' }],
  ['FilterRows', TOP_PATH, TOP, { option1: 'rossi' }],
  ['DetailPage', GRID_PATH, GRID, { page: '2' }],
  ['DetailPage', GRID_PATH, GRID, { dir: 'next' }],
  ['LocateRow', GRID_PATH, GRID, { option1: 'rossi' }],
  ['FilterRows', GRID_PATH, GRID, { option1: 'rossi' }],
  // la lista ferma su una riga di pagina 2: stesso percorso della lista, altra posizione
  ['LocateRow', `${TOP}.7`, TOP, { option1: 'rossi' }],
  ['DetailPage', `S1-5.2,${GRID}.7`, GRID, { page: '3' }],
  // Ordina: il browser manda ui.path della lista come navpath
  ['SortColumn', TOP_PATH, TOP, { option1: 'descrizione' }],
  ['SortColumn', GRID_PATH, GRID, { option1: 'descrizione' }],
];

describe('SXADV-6015: gli altri segmenti del percorso restano come prima', () => {
  it.each(['LocateRow', 'FilterRows', 'DetailPage', 'SortColumn'])(
    '%s su una griglia incorporata: gli array del segmento padre (riga puntata) non partono',
    async (action) => {
      await postAction(
        action,
        { navpath: GRID_PATH },
        { [`selected.${GRID}`]: ['true', 'false'], 'importo.S1-5': ['1', '2'] },
        'S1',
      );
      const body = sentBody();
      expect(body.getAll(`selected.${GRID}`)).toEqual(['true', 'false']);
      expect(body.has('importo.S1-5')).toBe(false);
    },
  );
});

describe('SXADV-6015: postAction e gli array della lista che si lascia', () => {
  it.each(LEAVING)('%s navpath %s: partono gli array di %s, nell\'ordine', async (action, navpath, list, extra) => {
    await postAction(
      action,
      { navpath, ...extra },
      {
        [`selected.${list}`]: ['false', 'true', 'false'],
        [`descrizione.${list}`]: ['a', 'b', 'c'],
        'note.S1-0': 'scalare',
      },
      'S1',
    );
    const body = sentBody();
    expect(body.get('action')).toBe(action);
    expect(body.get('navpath')).toBe(navpath);
    expect(body.getAll(`selected.${list}`)).toEqual(['false', 'true', 'false']);
    expect(body.getAll(`descrizione.${list}`)).toEqual(['a', 'b', 'c']);
    expect(body.get('note.S1-0')).toBe('scalare');
  });

  it.each(LEAVING)('%s navpath %s: gli array di un\'altra lista non nominata partono come prima', async (action, navpath, list, extra) => {
    await postAction(
      action,
      { navpath, ...extra },
      { [`selected.${list}`]: ['true'], 'selected.S1-99': ['x', 'y'] },
      'S1',
    );
    expect(sentBody().getAll('selected.S1-99')).toEqual(['x', 'y']);
  });
});

// Non-regressione SXADV-6011: un navpath di riga su un'azione che NON lascia la
// pagina toglie ancora gli array della lista puntata.
const ROW_ACTIONS: [string, string, string][] = [
  ['Post', `${TOP}.4`, TOP],
  ['Save', `${TOP}.4`, TOP],
  ['NavigateDetail', `${TOP}.4`, TOP],
  ['Add', `${TOP}.4`, TOP],
  ['Delete', `${TOP}.4`, TOP],
  ['Post', `S1-5.2,${GRID}.1`, GRID],
  ['Save', `S1-5.2,${GRID}.1`, GRID],
  ['NavigateDetail', `S1-5.2,${GRID}.1`, GRID],
  ['Add', `S1-5.2,${GRID}.1`, GRID],
  ['Refresh', `S1-5.2,${GRID}.1`, GRID],
];

describe('SXADV-6011 non-regressione: azioni di riga', () => {
  it.each(ROW_ACTIONS)('%s navpath %s: gli array di %s non partono', async (action, navpath, list) => {
    await postAction(
      action,
      { navpath },
      { [`selected.${list}`]: ['false', 'true'], [`descrizione.${list}`]: 'dal pannello' },
      'S1',
    );
    const body = sentBody();
    expect(body.has(`selected.${list}`)).toBe(false);
    expect(body.get(`descrizione.${list}`)).toBe('dal pannello');
  });

  it('l\'array del controllo che manda la richiesta (option1) parte comunque', async () => {
    await postAction('Post', { navpath: `${TOP}.4`, option1: `selected.${TOP}` }, { [`selected.${TOP}`]: ['1', '0'] }, 'S1');
    expect(sentBody().getAll(`selected.${TOP}`)).toEqual(['1', '0']);
  });
});
