import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UIControl } from '../../types/ui';

// SXADV-5741.4 — PopupUrl e Url: il legacy scriveva <a href=CONTENT>PROMPT</a>
// con PROMPT come HTML. In React il prompt deve passare da serverHtml con la
// politica `prompt` (niente testo "<img ..." letterale) e l'href da legacyUrl
// (doc/x.pdf → /entrasp/doc/x.pdf, mai javascript:).
//
// Niente DOM nei test (DOMParser assente): il filtro vero non gira. Al suo
// posto un finto che toglie <script> e gli on*, seguito dalla vera
// fixServerHtml; si verifica anche che la chiamata usi HTML_POLICY.prompt.

const calls: Array<{ html: string; policy: unknown }> = [];
vi.mock('../../services/serverHtml', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../services/serverHtml')>();
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

const { HTML_POLICY } = await import('../../services/serverHtml');
const { PopupUrlControl } = await import('./MiscControls');
const { UrlControl } = await import('./DisplayControls');

type Comp = typeof PopupUrlControl;

function render(Comp: Comp, control: Partial<UIControl>): string {
  const c = { name: 'guida.S1-0', id: 'guida', ...control } as UIControl;
  return renderToStaticMarkup(<Comp control={c} onAction={() => {}} onChange={() => {}} />);
}

/** Primo <a> del markup: attributi, HTML interno e testo. */
function anchor(html: string) {
  const m = /<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(html);
  if (!m) return null;
  const attrs: Record<string, string> = {};
  for (const a of m[1].matchAll(/([a-z-]+)="([^"]*)"/gi)) attrs[a[1].toLowerCase()] = decode(a[2]);
  const text = decode(m[2].replace(/<[^>]*>/g, ''));
  return { attrs, inner: m[2], text };
}

function decode(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const GUIDA = 'Guida:<img src="images/icons/help.png">';

beforeEach(() => { calls.length = 0; });

describe.each([
  ['PopupUrlControl', PopupUrlControl, 'popupUrl', 'doc/anagraficheduplicate.pdf', '/entrasp/doc/anagraficheduplicate.pdf'],
  ['UrlControl', UrlControl, 'url', 'doc/ManualeAntiriciclaggio.pdf', '/entrasp/doc/ManualeAntiriciclaggio.pdf'],
] as const)('%s (SXADV-5741.4)', (_name, Comp, type, href, expected) => {
  it('href riportato alla base del legacy', () => {
    const a = anchor(render(Comp, { type, href, prompt: 'Apri' }));
    expect(a).not.toBeNull();
    expect(a!.attrs.href).toBe(expected);
  });

  it('prompt HTML: testo + icona con src /entrasp/images/…, niente "<img" letterale', () => {
    const a = anchor(render(Comp, { type, href, prompt: GUIDA }));
    expect(a).not.toBeNull();
    expect(a!.text).toContain('Guida:');
    expect(a!.text).not.toContain('<img');
    const img = /<img\b([^>]*)>/i.exec(a!.inner);
    expect(img).not.toBeNull();
    expect(img![1]).toMatch(/src="\/entrasp\/images\/icons\/help\.png"/);
  });

  it('il prompt passa da serverHtml con HTML_POLICY.prompt', () => {
    render(Comp, { type, href, prompt: GUIDA });
    expect(calls.some((c) => c.html === GUIDA && c.policy === HTML_POLICY.prompt)).toBe(true);
  });

  it('HTML pericoloso nel prompt neutralizzato', () => {
    const a = anchor(render(Comp, {
      type, href, prompt: 'Guida<img src="x" onerror="alert(1)"><script>alert(2)</script>',
    }));
    expect(a).not.toBeNull();
    expect(a!.inner).not.toMatch(/onerror/i);
    expect(a!.inner).not.toMatch(/<script/i);
    expect(a!.text).not.toContain('alert(2)');
  });

  it('prompt di solo testo: resta quel testo', () => {
    const a = anchor(render(Comp, { type, href, prompt: 'Scarica specifiche file excel...' }));
    expect(a!.text).toBe('Scarica specifiche file excel...');
  });

  it('visible:false → niente', () => {
    expect(render(Comp, { type, href, prompt: 'x', visible: false })).toBe('');
  });

  it('href javascript: → niente link', () => {
    const out = render(Comp, { type, href: 'javascript:alert(1)', prompt: 'x' });
    expect(out).not.toMatch(/<a\b/i);
    expect(out).not.toMatch(/javascript:/i);
  });

  it('href data:text/html → niente link', () => {
    const out = render(Comp, { type, href: 'data:text/html,<b>x</b>', prompt: 'x' });
    expect(out).not.toMatch(/<a\b/i);
  });

  it('href assoluto http(s) invariato', () => {
    const a = anchor(render(Comp, { type, href: 'https://example.com/m.pdf', prompt: 'x' }));
    expect(a!.attrs.href).toBe('https://example.com/m.pdf');
  });

  it('rel noopener noreferrer', () => {
    const a = anchor(render(Comp, { type, href, prompt: 'x' }));
    expect(a!.attrs.rel).toBe('noopener noreferrer');
  });
});

describe('PopupUrlControl: target, classe, ripieghi (SXADV-5741.4)', () => {
  const href = 'doc/anagraficheduplicate.pdf';

  it('target dal controllo (_new), classe link di default', () => {
    const a = anchor(render(PopupUrlControl, { type: 'popupUrl', href, prompt: GUIDA, target: '_new' }));
    expect(a!.attrs.target).toBe('_new');
    expect(a!.attrs.class).toBe('link');
  });

  it('target di default _blank, classe dal controllo', () => {
    const a = anchor(render(PopupUrlControl, { type: 'popupUrl', href, prompt: 'x', cls: 'mylink' }));
    expect(a!.attrs.target).toBe('_blank');
    expect(a!.attrs.class).toBe('mylink');
  });

  it('senza prompt mostra l\'href', () => {
    const a = anchor(render(PopupUrlControl, { type: 'popupUrl', href }));
    expect(a!.text).toContain('doc/anagraficheduplicate.pdf');
    expect(a!.attrs.href).toBe('/entrasp/doc/anagraficheduplicate.pdf');
  });

  it('senza href → niente', () => {
    expect(render(PopupUrlControl, { type: 'popupUrl', prompt: GUIDA })).toBe('');
  });
});

describe('UrlControl: target e ripieghi (SXADV-5741.4)', () => {
  const href = 'doc/ManualeAntiriciclaggio.pdf';

  it('target _blank', () => {
    const a = anchor(render(UrlControl, { type: 'url', href, prompt: 'Manuale' }));
    expect(a!.attrs.target).toBe('_blank');
  });

  it('senza prompt: displayValue come testo', () => {
    const a = anchor(render(UrlControl, { type: 'url', href, displayValue: 'Manuale antiriciclaggio' }));
    expect(a!.text).toBe('Manuale antiriciclaggio');
  });

  it('senza prompt ne\' displayValue: value come testo', () => {
    const a = anchor(render(UrlControl, { type: 'url', href, value: 'Manuale AR' }));
    expect(a!.text).toBe('Manuale AR');
  });

  it('senza href ne\' value → niente', () => {
    expect(render(UrlControl, { type: 'url', prompt: 'x' })).toBe('');
  });
});
