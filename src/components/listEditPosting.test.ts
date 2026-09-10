import { describe, it, expect } from 'vitest';
import { buildColumnFieldName, resolveReloadNavpath, viewstateIdOf } from './listEditPosting';

// Regression coverage for SXADV-5648: the multiEdit page-wide post array was
// keyed by `ui.path` (which carries a row-position suffix, e.g. "S1-11.0"),
// not the bare list id CORE's ToolViewState.getValue() actually looks up
// (controlName + "." + pVS.getId()) — so the checkbox selection array was
// silently never applied. Worse, once panel-vs-bulk row targeting was added
// (CORE ToolViewState.getCurrentEditPosition), a row-suffixed navpath sent for
// what's meant to be a bulk/page-wide post gets misread as one targeted row.

describe('buildColumnFieldName', () => {
  it('joins the control name and the bare list id with a dot', () => {
    expect(buildColumnFieldName('selected', 'S1-11')).toBe('selected.S1-11');
  });

  it('does not include any row-position suffix', () => {
    const fieldName = buildColumnFieldName('selected', 'S1-11');
    expect(fieldName).not.toMatch(/\.\d+$/);
  });
});

describe('resolveReloadNavpath', () => {
  it('uses the bare selectorBasePath for multiEdit (must stay a bulk/page-wide post)', () => {
    const navpath = resolveReloadNavpath({
      isMultiEdit: true,
      selectorBasePath: 'S1-11',
      uiPath: 'S1-11.0',
    });
    expect(navpath).toBe('S1-11');
  });

  it('never returns a row-position-suffixed navpath for multiEdit, even when uiPath has one', () => {
    const navpath = resolveReloadNavpath({
      isMultiEdit: true,
      selectorBasePath: 'S1-11',
      uiPath: 'S1-11.7',
    });
    expect(navpath).not.toMatch(/\.\d+$/);
  });

  it('returns undefined for multiEdit when selectorBasePath is empty (no selector column)', () => {
    const navpath = resolveReloadNavpath({ isMultiEdit: true, selectorBasePath: '', uiPath: 'S1-11.0' });
    expect(navpath).toBeUndefined();
  });

  it('falls back to ui.path for plain listEdit (unchanged pre-existing behaviour)', () => {
    const navpath = resolveReloadNavpath({
      isMultiEdit: false,
      selectorBasePath: 'S1-11',
      uiPath: 'S1-11.0',
    });
    expect(navpath).toBe('S1-11.0');
  });

  it('returns undefined for plain listEdit when ui.path is absent', () => {
    const navpath = resolveReloadNavpath({ isMultiEdit: false, selectorBasePath: 'S1-11', uiPath: undefined });
    expect(navpath).toBeUndefined();
  });
});

// SXADV-5887: il template del pannello di modifica riga e' in cache per nome di
// VISTA, ma i `bindings` che porta dentro hanno l'id di viewstate della pagina
// in cui fu costruito. Riaperta la funzione, i nomi di campo del post uscivano
// con l'id vecchio, il server non trovava nessun parametro e il Salva
// rispondeva "Nessuna modifica da salvare" svuotando il pannello. L'id vivo si
// ricava dal percorso della riga selezionata.
describe('viewstateIdOf', () => {
  it('takes the bare id of the innermost viewstate from an embedded row path', () => {
    expect(viewstateIdOf('S1-3.0,S1-11.5')).toBe('S1-11');
  });

  it('takes the bare id from a root list row path', () => {
    expect(viewstateIdOf('S1-11.0')).toBe('S1-11');
  });

  it('walks to the LAST segment, not the first (the panel edits the innermost list)', () => {
    expect(viewstateIdOf('S1-3.0,S1-7.2,S1-19.13')).toBe('S1-19');
  });

  it('leaves a path with no position suffix alone', () => {
    expect(viewstateIdOf('S1-11')).toBe('S1-11');
  });
});
