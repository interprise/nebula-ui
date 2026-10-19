import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from 'antd';
import type { UITree, ListHeader } from '../types/ui';
import { ELTYPE_CONTENT } from '../types/ui';

// SXADV-5771 — le intestazioni di colonna (ui.headers[i].text e
// ui.continuationHeaders[banda][j].text) sono prompt HTML del legacy:
// `Telefono: <img src="images/icons/telephone.png">`. Vanno messe in pagina
// come HTML filtrato (icona visibile), mai come testo ("<img src=…" letterale).
//
// Cosa si prova qui: il pannello di riga (EditPanel, <th class="edit-panel-th">)
// col render lato server, come gli altri test dei controlli.
//
// Cosa NON si prova qui: le intestazioni di ListRenderer. Nei test non c'e' DOM
// (ne' jsdom ne' happy-dom installati): AG Grid disegna le intestazioni solo nel
// browser, e le bande di continuazione (.continuation-header-row) le inserisce
// un effetto direttamente nel DOM dopo .ag-header. Col render lato server non
// esce nessuna delle due; la parte pura (listHeaderLabel) e' coperta da
// listHeaderLabel.sxadv5771.test.ts, la resa in griglia va vista a schermo.
//
// DOMParser assente: serverHtml e' sostituito da un finto (via <script> e on*)
// seguito dalla vera fixServerHtml, e si registra la politica usata.

const calls: Array<{ html: string; policy: unknown }> = [];
vi.mock('../services/serverHtml', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/serverHtml')>();
  const fakeSanitize = (html: string) => html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return {
    ...real,
    serverHtml: (html: string, policy: unknown) => {
      calls.push({ html, policy });
      return real.fixServerHtml(fakeSanitize(html));
    },
  };
});

// listHeaderLabel puo' ricavare il TESTO con DOMParser: un supplente minimo
// (solo textContent: niente tag, entita' comuni) se manca.
const g = globalThis as Record<string, unknown>;
if (typeof g.DOMParser === 'undefined') {
  g.DOMParser = class {
    parseFromString(s: string) {
      const textContent = s
        .replace(/<(script|style|svg|iframe)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      return { body: { textContent, innerText: textContent }, documentElement: { textContent } };
    }
  };
}

const { HTML_POLICY } = await import('../services/serverHtml');
const { default: EditPanel } = await import('./EditPanel');

const TELEFONO = 'Telefono: <img src="images/icons/telephone.png">';
const FAX = 'Fax: <img src="images/icons/printer_empty.png">';
const EMAIL = 'Email: <img src="images/icons/email.png">';

const cell = (name: string, value: string) => ({
  elementType: ELTYPE_CONTENT,
  colspan: 1,
  control: { name: `${name}.S1-0.0`, id: name, type: 'text', editable: false, value },
});

function renderPanel(headers: ListHeader[], continuationHeaders?: ListHeader[][]): string {
  const rows = [
    { id: 'r0', cells: [cell('codice', 'C01'), cell('telefono', '0471 123456')] },
    ...(continuationHeaders ? [{ id: 'r1', cells: [cell('fax', '0471 654321'), cell('email', 'a@b.it')] }] : []),
  ];
  const panel = { rows, path: 'S1-0.0', pageType: 1 } as unknown as UITree;
  const listUi = { rows: [], headers, continuationHeaders, path: 'S1-0', pageType: 1 } as unknown as UITree;
  return renderToStaticMarkup(
    <App>
      <EditPanel panel={panel} listUi={listUi} rowPath="S1-0.0" formShape={false}
        onAction={() => {}} onClose={() => {}} />
    </App>,
  );
}

/** Le <th class="edit-panel-th">: attributi, HTML interno, testo. */
function ths(html: string) {
  return Array.from(html.matchAll(/<th\b([^>]*class="edit-panel-th"[^>]*)>([\s\S]*?)<\/th>/gi)).map((m) => {
    const title = /\btitle="([^"]*)"/i.exec(m[1])?.[1];
    return { attrs: m[1], title: title === undefined ? undefined : decode(title), inner: m[2], text: decode(m[2].replace(/<[^>]*>/g, '')) };
  });
}

function decode(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const headers: ListHeader[] = [
  { text: 'Codice', colspan: 1 },
  { text: TELEFONO, colspan: 1 },
];

describe('EditPanel HeaderRow (SXADV-5771)', () => {
  it('intestazione con icona: <img> con src /entrasp/images/…', () => {
    const th = ths(renderPanel(headers));
    expect(th).toHaveLength(2);
    expect(th[1].inner).toMatch(/<img\b[^>]*src="\/entrasp\/images\/icons\/telephone\.png"/i);
    expect(th[1].text).toContain('Telefono:');
  });

  it('nessun "<img" letterale nel testo', () => {
    const html = renderPanel(headers);
    expect(html).not.toContain('&lt;img');
    for (const t of ths(html)) expect(t.text).not.toContain('<img');
  });

  it('title = testo semplice, senza markup', () => {
    const th = ths(renderPanel(headers));
    expect(th[0].title).toBe('Codice');
    expect(th[1].title).toBe('Telefono:');
  });

  it('etichetta semplice: resta testo', () => {
    const th = ths(renderPanel(headers));
    expect(th[0].text).toBe('Codice');
    expect(th[0].inner).not.toContain('<img');
  });

  it('le intestazioni delle bande di continuazione: stessa resa', () => {
    const html = renderPanel(headers, [[{ text: FAX, colspan: 1 }, { text: EMAIL, colspan: 1 }]]);
    expect(html).not.toContain('&lt;img');
    const th = ths(html);
    expect(th).toHaveLength(4);
    expect(th[2].inner).toMatch(/<img\b[^>]*src="\/entrasp\/images\/icons\/printer_empty\.png"/i);
    expect(th[3].inner).toMatch(/<img\b[^>]*src="\/entrasp\/images\/icons\/email\.png"/i);
    expect(th[2].title).toBe('Fax:');
    expect(th[3].title).toBe('Email:');
  });

  it('l\'HTML passa dal filtro con HTML_POLICY.prompt', () => {
    calls.length = 0;
    renderPanel([{ text: 'Tel: <img src="images/icons/telephone.png" onerror="alert(1)">', colspan: 1 }]);
    // Con una cache in listHeaderLabel la chiamata puo' essere avvenuta prima:
    // conta che il grezzo sia passato di qui con la politica giusta, una volta.
    expect(calls.some((c) => c.html.includes('onerror') && c.policy === HTML_POLICY.prompt)).toBe(true);
  });

  it('niente onerror nella pagina', () => {
    const html = renderPanel([{ text: 'Tel: <img src="images/icons/telephone.png" onerror="alert(1)">', colspan: 1 }]);
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(ths(html)[0].inner).toMatch(/<img\b[^>]*src="\/entrasp\/images\/icons\/telephone\.png"/i);
  });
});
