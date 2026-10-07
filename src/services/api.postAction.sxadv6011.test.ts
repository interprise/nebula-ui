import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { postAction } from './api';

// SXADV-6011 (difetto trovato): postAction spedisce
// withoutPositionalArrays(formValues, params.navpath) al posto di formValues.
// Contratto: docs/features/20261007_SXADV-6011_valori_posizionali.md, punto 3.

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

describe('postAction e i valori posizionali', () => {
  it('navpath che punta una riga: non partono gli array di quel view state, partono gli scalari', async () => {
    await postAction(
      'Add',
      { navpath: 'S1-0.0,S1-9.1' },
      {
        'descrizione.S1-9': ['riga uno', ''],
        'dare.S1-9': ['100,00', ''],
        'dataReg.S1-0': '07/10/2026',
        'note.S1-9': 'dal pannello',
        'importo.S1-12': ['1', '2'],
      },
      'S1',
    );
    const body = sentBody();
    expect(body.get('action')).toBe('Add');
    expect(body.get('sid')).toBe('S1');
    expect(body.get('navpath')).toBe('S1-0.0,S1-9.1');
    expect(body.has('descrizione.S1-9')).toBe(false);
    expect(body.has('dare.S1-9')).toBe(false);
    expect(body.get('dataReg.S1-0')).toBe('07/10/2026');
    expect(body.get('note.S1-9')).toBe('dal pannello');
    expect(body.getAll('importo.S1-12')).toEqual(['1', '2']);
  });

  it('senza navpath gli array partono ripetuti (name=a&name=b)', async () => {
    await postAction(
      'Save',
      {},
      { 'descrizione.S1-9': ['riga uno', 'riga due'], 'dataReg.S1-0': '07/10/2026' },
      'S1',
    );
    const body = sentBody();
    expect(body.getAll('descrizione.S1-9')).toEqual(['riga uno', 'riga due']);
    expect(body.get('dataReg.S1-0')).toBe('07/10/2026');
  });

  it('navpath senza posizione (ListActions): gli array partono', async () => {
    await postAction(
      'ListActions',
      { navpath: 'S1-9' },
      { 'selected.S1-9': ['on', '', 'on'] },
      'S1',
    );
    expect(sentBody().getAll('selected.S1-9')).toEqual(['on', '', 'on']);
  });

  it("i formValues del chiamante restano invariati", async () => {
    const fv = { 'descrizione.S1-9': ['riga uno', ''], 'dataReg.S1-0': 'x' };
    await postAction('Add', { navpath: 'S1-9.1' }, fv, 'S1');
    expect(fv).toEqual({ 'descrizione.S1-9': ['riga uno', ''], 'dataReg.S1-0': 'x' });
  });

  it('senza formValues non si rompe', async () => {
    await postAction('Refresh', { navpath: 'S1-9.1' }, undefined, 'S1');
    expect(sentBody().get('action')).toBe('Refresh');
  });
});
