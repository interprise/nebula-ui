import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from 'antd';
import type { UITree } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

// SXADV-4569 — dove sta il campo «Cerca» in ListRenderer, col render lato
// server (niente DOM nei test del progetto). Contratto:
//   - nella banda dei bottoni di griglia (Nuovo/Excel/Stampa) se c'e';
//   - altrimenti in coda alla barra delle azioni di lista;
//   - altrimenti in una banda sua;
//   - solo con almeno due record (contati sul totale della lista, non sulla pagina).
//
// Cosa NON si prova qui: la selezione / scorrimento / fuoco del rigo trovato
// (effetto su AG Grid, che col render lato server non gira): va vista a schermo.

const { default: ListRenderer } = await import('./ListRenderer');

// ListRenderer misura i testi delle intestazioni con un canvas: un document
// minimo che non sa misurare (getContext null), messo DOPO l'import (i moduli
// che al caricamento vedono un document lo userebbero davvero).
const g = globalThis as Record<string, unknown>;
if (typeof g.document === 'undefined') {
  g.document = { createElement: () => ({ getContext: () => null, style: {} }) };
}
if (typeof g.window === 'undefined') g.window = { innerHeight: 800, innerWidth: 1280 };

const row = (pos: number, text: string) => ({
  id: `r${pos}`,
  props: { path: `S1-0.2,S1-3.${pos}` },
  cells: [{ elementType: ELTYPE_CONTENT, colspan: 1, text, control: { name: `nome.S1-3.${pos}`, id: 'nome', type: 'text', editable: false, value: text } }],
});

function list(over: Partial<Record<string, unknown>>, nRows: number): UITree {
  return {
    pageType: 1,
    viewName: 'eventiList',
    path: 'S1-0.2,S1-3',
    headers: [{ text: 'Nome', colspan: 1 }],
    rows: Array.from({ length: nRows }, (_, i) => row(i, `Nome ${i}`)),
    ...over,
  } as unknown as UITree;
}

function render(ui: UITree, embedded = true): string {
  return renderToStaticMarkup(
    <App>
      <ListRenderer ui={ui} onAction={() => undefined} embedded={embedded} />
    </App>,
  );
}

/** L'HTML del blocco che si apre con un div di quella classe (fino alla sua chiusura). */
function block(html: string, cls: string): string | null {
  const start = html.search(new RegExp(`<div[^>]*class="[^"]*\\b${cls}\\b[^"]*"`));
  if (start < 0) return null;
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + 6);
  }
  return html.slice(start);
}

const hasSearch = (html: string | null) => !!html && /placeholder="Cerca"/.test(html);

describe('ListRenderer: il campo Cerca (SXADV-4569)', () => {
  it('banda dei bottoni di griglia: Cerca accanto a Nuovo', () => {
    const html = render(list({ gridActions: { path: 'S1-0.2,S1-3', addCommand: 'Add', xlsCommand: 'Xls' } }, 3));
    const band = block(html, 'grid-actions');
    expect(band).not.toBeNull();
    expect(band).toContain('Nuovo');
    expect(hasSearch(band)).toBe(true);
    expect((html.match(/placeholder="Cerca"/g) ?? []).length).toBe(1);
  });

  it('niente bottoni di griglia ma azioni di lista: Cerca in coda alla barra delle azioni', () => {
    const html = render(list({
      listActions: [{ label: 'Chiudi tutti', command: 'ChiudiTutti', path: 'S1-0.2,S1-3' }],
    }, 3));
    const bar = block(html, 'action-bar');
    expect(bar).not.toBeNull();
    expect(hasSearch(bar)).toBe(true);
    const idxAction = bar!.indexOf('Chiudi tutti');
    const idxSearch = bar!.indexOf('placeholder="Cerca"');
    expect(idxAction).toBeGreaterThanOrEqual(0);
    expect(idxSearch).toBeGreaterThan(idxAction);
    expect((html.match(/placeholder="Cerca"/g) ?? []).length).toBe(1);
  });

  it('ne\' bottoni ne\' azioni: Cerca in una banda sua', () => {
    const html = render(list({}, 3));
    expect((html.match(/placeholder="Cerca"/g) ?? []).length).toBe(1);
    expect(hasSearch(block(html, 'grid-actions'))).toBe(true);
  });

  it('lista a pagina intera (non incorporata): c\'e\' anche li\'', () => {
    const html = render(list({ path: 'S1-3' }, 5), false);
    expect((html.match(/placeholder="Cerca"/g) ?? []).length).toBe(1);
  });

  it('un solo record: niente Cerca', () => {
    const html = render(list({ gridActions: { path: 'S1-0.2,S1-3', addCommand: 'Add' } }, 1));
    expect(html).not.toContain('placeholder="Cerca"');
    expect(block(html, 'grid-actions')).toContain('Nuovo');
  });

  it('lista vuota: niente Cerca', () => {
    expect(render(list({}, 0))).not.toContain('placeholder="Cerca"');
  });

  it('un rigo nella pagina ma molti record in tutto: Cerca c\'e\'', () => {
    const html = render(list({
      gridActions: { path: 'S1-0.2,S1-3', addCommand: 'Add' },
      paging: { currentPage: 11, totalPages: 11, totalRows: 1001, pageSize: 100, position: 1000 },
    }, 1));
    expect(html).toContain('placeholder="Cerca"');
  });

  it('due righe ma il totale della lista dice un record solo: niente Cerca', () => {
    // Il totale vale piu' della pagina: e' quello che conta i record.
    const html = render(list({
      paging: { currentPage: 1, totalPages: 1, totalRows: 1, pageSize: 100, position: 0 },
    }, 1));
    expect(html).not.toContain('placeholder="Cerca"');
  });
});
