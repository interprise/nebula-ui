import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postAction } from './api';

// SXADV-6052: il Nuovo del pannello di riga porta due percorsi, navpath (la
// lista, dove nasce la riga nuova) e postPath (la riga del pannello, a cui
// appartengono i valori digitati). postAction deve spedirli entrambi.
// Contratto: CORE/docs/20261013_SXADV-6052_postpath_della_riga_in_modifica.md
//
// Il filtro degli array posizionali (SXADV-6011) guarda il navpath, non il
// postPath, e toglie solo gli ARRAY: il valore singolo del pannello deve partire.

const LISTA = 'S1-0.0,S1-9.1';
const RIGA_PANNELLO = 'S1-0.0,S1-9.0';

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

describe('postAction e postPath (SXADV-6052)', () => {
  it('Nuovo del pannello: partono navpath, postPath e il digitato della riga', async () => {
    await postAction(
      'Add',
      { navpath: LISTA, postPath: RIGA_PANNELLO },
      { 'descrizione.S1-9': 'RIGA-A', 'dataReg.S1-0': '13/10/2026' },
      'S1',
    );
    const body = sentBody();
    expect(body.get('action')).toBe('Add');
    expect(body.get('sid')).toBe('S1');
    expect(body.get('navpath')).toBe(LISTA);
    expect(body.get('postPath')).toBe(RIGA_PANNELLO);
    expect(body.getAll('descrizione.S1-9')).toEqual(['RIGA-A']);
    expect(body.get('dataReg.S1-0')).toBe('13/10/2026');
  });

  it('postPath non sposta il filtro posizionale: gli array della lista puntata dal navpath non partono', async () => {
    await postAction(
      'Add',
      { navpath: LISTA, postPath: RIGA_PANNELLO },
      { 'dare.S1-9': ['100,00', ''], 'descrizione.S1-9': 'RIGA-A' },
      'S1',
    );
    const body = sentBody();
    expect(body.has('dare.S1-9')).toBe(false);
    expect(body.get('descrizione.S1-9')).toBe('RIGA-A');
    expect(body.get('postPath')).toBe(RIGA_PANNELLO);
  });

  it('postPath con navpath senza posizione: gli array partono, postPath pure', async () => {
    await postAction(
      'ListActions',
      { navpath: 'S1-9', postPath: RIGA_PANNELLO },
      { 'selected.S1-9': ['on', '', 'on'] },
      'S1',
    );
    const body = sentBody();
    expect(body.getAll('selected.S1-9')).toEqual(['on', '', 'on']);
    expect(body.get('postPath')).toBe(RIGA_PANNELLO);
  });

  it('postPath parte una volta sola', async () => {
    await postAction('Save', { navpath: RIGA_PANNELLO, postPath: RIGA_PANNELLO }, {}, 'S1');
    expect(sentBody().getAll('postPath')).toEqual([RIGA_PANNELLO]);
  });

  it('senza postPath nei params il corpo non lo contiene', async () => {
    await postAction('Add', { navpath: LISTA }, { 'descrizione.S1-9': 'x' }, 'S1');
    expect(sentBody().has('postPath')).toBe(false);
  });
});
