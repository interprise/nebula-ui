import { describe, it, expect, beforeAll } from 'vitest';
import { HTML_POLICY, looksLikeServerHtml, sanitizeServerHtml, serverHtml } from './serverHtml';

// SXADV-5815.8 — il link che CdmsRisorseRevisioni.getLinkHtml scrive in una cella di
// lista deve sopravvivere al filtro HTML_POLICY.cell con href e target.
//
// Niente DOM nel progetto (nessun jsdom): il filtro vero gira su un DOMParser minimo
// qui sotto, limitato a cio' che il filtro usa. Decodifica le entita' degli attributi
// e le riscrive in serializzazione, come fa un browser.

type N = FakeEl | FakeText;
class FakeText {
  nodeType = 3;
  parent: FakeEl | null = null;
  text: string;
  constructor(text: string) { this.text = text; }
  remove() { this.parent?.drop(this); }
}
const attrDecode = (v: string) => v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const attrEncode = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const VOID = new Set(['BR', 'IMG', 'HR', 'COL']);
class FakeEl {
  nodeType = 1;
  parent: FakeEl | null = null;
  childNodes: N[] = [];
  attrs = new Map<string, string>();
  tagName: string;
  constructor(tagName: string) { this.tagName = tagName; }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  setAttribute(n: string, v: string) { this.attrs.set(n, v); }
  removeAttribute(n: string) { this.attrs.delete(n); }
  add(c: N) { c.parent = this; this.childNodes.push(c); }
  drop(c: N) { this.childNodes = this.childNodes.filter((x) => x !== c); }
  remove() { this.parent?.drop(this); }
  replaceWith(...nodes: N[]) {
    const p = this.parent!;
    const i = p.childNodes.indexOf(this);
    nodes.forEach((x) => { x.parent = p; });
    p.childNodes.splice(i, 1, ...nodes);
  }
  get innerHTML(): string {
    return this.childNodes.map((c) => {
      if (c.nodeType === 3) return (c as FakeText).text;
      const e = c as FakeEl;
      const t = e.tagName.toLowerCase();
      const a = [...e.attrs].map(([k, v]) => ` ${k}="${attrEncode(v)}"`).join('');
      return VOID.has(e.tagName) ? `<${t}${a}>` : `<${t}${a}>${e.innerHTML}</${t}>`;
    }).join('');
  }
}
function parse(html: string): FakeEl {
  const body = new FakeEl('BODY');
  let cur = body;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/g;
  for (const m of html.matchAll(re)) {
    if (m[4] !== undefined) { cur.add(new FakeText(m[4])); continue; }
    const tag = m[2].toUpperCase();
    if (m[1]) { if (cur.parent) cur = cur.parent; continue; }
    const el = new FakeEl(tag);
    for (const a of m[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      el.attrs.set(a[1].toLowerCase(), attrDecode(a[2] ?? a[3] ?? a[4] ?? ''));
    }
    cur.add(el);
    if (!VOID.has(tag)) cur = el;
  }
  return body;
}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g.Node = class { static TEXT_NODE = 3; static ELEMENT_NODE = 1; };
  g.DOMParser = class { parseFromString(html: string) { return { body: parse(html) }; } };
});

const KEY = 'P01%7C7f3c2e10-0000-4000-8000-000000000001%7C2';
const HREF_ATTR = `controller?action=DownloadAllegato&amp;sid=S1&amp;navpath=${KEY}&amp;option1=inline`;
const HREF = HREF_ATTR.replace(/&amp;/g, '&');
/** La forma esatta di getLinkHtml (vedi CdmsLinkHtmlHarness). */
const link = (href = HREF_ATTR, target = ' target="_blank"') =>
  `<div id="dvtK"><a id="K"${target} href="${href}"><img src="images/icons/page_white_put.png" />Contratto.pdf</a></div>`;

const hrefOf = (html: string) => /<a\b[^>]*\bhref="([^"]*)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
const attrOf = (html: string, a: string) => new RegExp(`<a\\b[^>]*\\b${a}="([^"]*)"`).exec(html)?.[1];

describe('SXADV-5815.8: il link di scaricamento nella cella', () => {
  it('e\' riconosciuto come markup di cella', () => {
    expect(looksLikeServerHtml(link())).toBe(true);
  });

  it('HTML_POLICY.cell conserva href intero e target; aggiunge rel', () => {
    const out = sanitizeServerHtml(link(), HTML_POLICY.cell);
    expect(hrefOf(out)).toBe(HREF);
    expect(attrOf(out, 'target')).toBe('_blank');
    expect(attrOf(out, 'rel')).toBe('noopener noreferrer');
    expect(out).toContain('Contratto.pdf');
  });

  it('serverHtml porta link e icona sotto /entrasp/: dalla base /entrasp/app/ arriva al servlet', () => {
    const out = serverHtml(link(), HTML_POLICY.cell);
    expect(out).toContain('src="/entrasp/images/icons/page_white_put.png"');
    const url = new URL(hrefOf(out)!, 'http://h:9080/entrasp/app/');
    expect(url.pathname).toBe('/entrasp/controller');
    expect(url.searchParams.get('action')).toBe('DownloadAllegato');
    expect(url.searchParams.get('sid')).toBe('S1');
    expect(url.searchParams.get('navpath')).toBe('P01|7f3c2e10-0000-4000-8000-000000000001|2');
    expect(url.searchParams.get('option1')).toBe('inline');
    expect(attrOf(out, 'target')).toBe('_blank');
  });

  it('il link va riportato al servlet anche senza alcuna immagine dentro', () => {
    const out = serverHtml(`<a target="_blank" href="${HREF_ATTR}">Contratto.pdf</a>`, HTML_POLICY.cell);
    expect(new URL(hrefOf(out)!, 'http://h:9080/entrasp/app/').pathname).toBe('/entrasp/controller');
  });

  it('un href assoluto o gia\' sotto /entrasp/ non si tocca; un testo con controller? nemmeno', () => {
    const abs = `http://altro/controller?a=1`;
    expect(hrefOf(serverHtml(`<a href="${abs}">x</a>`, HTML_POLICY.cell))).toBe(abs);
    expect(hrefOf(serverHtml('<a href="/entrasp/controller?a=1">x</a>', HTML_POLICY.cell))).toBe('/entrasp/controller?a=1');
    expect(serverHtml('<b>vedi href=controller?x</b>', HTML_POLICY.cell)).toContain('href=controller?x');
  });

  it('il vecchio javascript: non passa', () => {
    const out = sanitizeServerHtml(link("javascript:openWin4('DownloadAllegato', 'k', 'inline')"), HTML_POLICY.cell);
    expect(hrefOf(out)).toBeUndefined();
  });

  it('un target diverso da _blank/_self viene tolto', () => {
    expect(attrOf(sanitizeServerHtml(link(HREF_ATTR, ' target="evil"'), HTML_POLICY.cell), 'target')).toBeUndefined();
  });
});
