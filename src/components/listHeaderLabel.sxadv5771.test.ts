import { describe, it, expect, vi, beforeAll } from 'vitest';

// SXADV-5771 — intestazioni di colonna delle liste: il testo arriva dal prompt
// del ViewItem, che nel legacy era HTML (`Telefono: <img src="images/icons/…">`,
// anche da DATA_VIEW_ITEM.prompt, scritto dagli utenti). listHeaderLabel(raw)
// da' { text, html? }:
//  - text: etichetta leggibile (niente markup, entita' decodificate, spazi
//    compattati) per headerName, misure, tooltip;
//  - html: solo se c'e' markup o un'entita', ed e' l'uscita di
//    serverHtml(raw, HTML_POLICY.prompt).
//
// Niente DOM nei test (DOMParser assente, come in linkControls.sxadv5741): il
// filtro vero non gira. Al suo posto un finto che fa le stesse cose sui casi
// usati qui, seguito dalla vera fixServerHtml; si verifica che la chiamata usi
// HTML_POLICY.prompt e che `html` sia esattamente quello che serverHtml rende.
// Se l'implementazione usa DOMParser per ricavare il TESTO, un DOMParser
// minimo (solo textContent) fa da supplente.

// Registro cumulativo: l'implementazione puo' tenere una cache per etichetta,
// quindi non si conta per chiamata, si guarda se il grezzo e' mai passato da li'.
const calls: Array<{ html: string; policy: unknown; out: string }> = [];

const DROPPED = 'script|style|svg|iframe|object|embed|template|title|textarea|math';
const PROMPT_TAGS = new Set(['br', 'b', 'strong', 'i', 'em', 'u', 'p', 'div', 'span', 'ul', 'ol', 'li',
  'font', 'nobr', 'small', 'sub', 'sup', 'img', 'a']);

/** Finto filtro: toglie gli elementi pericolosi col contenuto, gli on*, gli
 *  href javascript:, e lascia solo il testo dei tag fuori dalla politica. */
function fakeSanitize(html: string): string {
  if (!html.includes('<')) return html;
  return html
    .replace(new RegExp(`<(${DROPPED})\\b[\\s\\S]*?(<\\/\\1\\s*>|$)`, 'gi'), '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, name: string) => (PROMPT_TAGS.has(name.toLowerCase()) ? tag : ''));
}

vi.mock('../services/serverHtml', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/serverHtml')>();
  return {
    ...real,
    serverHtml: (html: string, policy: unknown) => {
      const out = real.fixServerHtml(fakeSanitize(html));
      calls.push({ html, policy, out });
      return out;
    },
  };
});

/** DOMParser minimo: body.textContent senza tag e con le entita' comuni. */
function textOf(s: string): string {
  return s
    .replace(new RegExp(`<(${DROPPED})\\b[\\s\\S]*?(<\\/\\1\\s*>|$)`, 'gi'), '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMParser === 'undefined') {
    g.DOMParser = class {
      parseFromString(s: string) {
        const textContent = textOf(s);
        return { body: { textContent, innerText: textContent }, documentElement: { textContent } };
      }
    };
  }
});

const { HTML_POLICY, serverHtml } = await import('../services/serverHtml');

/** Il grezzo e' passato da serverHtml con la politica prompt? */
const filtered = (raw: string) => calls.some((c) => c.html === raw && c.policy === HTML_POLICY.prompt);
const { listHeaderLabel } = await import('./listHeaderLabel');

/** Spazi normalizzati: &#160; puo' restare nbsp o diventare spazio. */
const norm = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const TELEFONO = 'AG,33: Telefono: <img src="images/icons/telephone.png">';


describe('listHeaderLabel — testo (SXADV-5771)', () => {
  it('prompt con icona: il testo e\' la sola etichetta', () => {
    expect(listHeaderLabel(TELEFONO).text).toBe('AG,33: Telefono:');
  });

  it.each([
    ['Telefono: <img src="images/icons/telephone.png">', 'Telefono:'],
    ['Fax: <img src="images/icons/printer_empty.png">', 'Fax:'],
    ['Cellulare: <img src="images/icons/phone.png">', 'Cellulare:'],
    ['Email: <img src="images/icons/email.png">', 'Email:'],
    ['Indirizzo PEC: <img src="images/icons/email.png">', 'Indirizzo PEC:'],
  ])('prompt reale %s -> %s', (raw, text) => {
    const l = listHeaderLabel(raw);
    expect(l.text).toBe(text);
    expect(l.text).not.toContain('<');
  });

  it('markup di formattazione: resta il testo', () => {
    expect(norm(listHeaderLabel('<b>Imp.</b> <i>netto</i>').text)).toBe('Imp. netto');
    expect(norm(listHeaderLabel('Data<br>reg.').text)).toMatch(/^Data ?reg\.$/);
  });

  it('entita\': &amp; -> &, &#160; e &nbsp; -> spazio (o nbsp)', () => {
    expect(listHeaderLabel('Dare &amp; Avere').text).toBe('Dare & Avere');
    expect(norm(listHeaderLabel('Imp.&#160;netto').text)).toBe('Imp. netto');
    expect(norm(listHeaderLabel('Imp.&nbsp;netto').text)).toBe('Imp. netto');
    expect(listHeaderLabel('Dare &amp; Avere').text).not.toContain('&amp;');
  });

  // Un'etichetta senza markup resta com'e' (nessuna lista senza icone cambia);
  // gli spazi si compattano solo dove il markup e' stato tolto.
  it('spazi compattati e tolti ai bordi dove c\'era markup', () => {
    expect(listHeaderLabel('  Ragione   sociale  ').text).toBe('  Ragione   sociale  ');
    expect(listHeaderLabel('Telefono:   <img src="images/icons/telephone.png">   ').text).toBe('Telefono:');
  });

  it('null / undefined / vuoto -> { text: \'\' } senza html', () => {
    for (const raw of [null, undefined, '']) {
      const l = listHeaderLabel(raw);
      expect(l.text).toBe('');
      expect(l.html).toBeUndefined();
    }
  });

  it('solo un\'icona: testo vuoto, html presente', () => {
    const l = listHeaderLabel('<img src="images/icons/email.png">');
    expect(l.text).toBe('');
    expect(l.html).toContain('/entrasp/images/icons/email.png');
  });
});

describe('listHeaderLabel — etichette semplici (SXADV-5771)', () => {
  it.each(['Codice', 'Ragione sociale', 'AG,33: Data doc.', '% Provv.', 'Q.ta\''])(
    '%s resta com\'e\' e non ha html', (raw) => {
      const l = listHeaderLabel(raw);
      expect(l.text).toBe(raw);
      expect(l.html).toBeUndefined();
    },
  );

  it('senza markup non passa dal filtro HTML', () => {
    listHeaderLabel('Codice');
    expect(calls.some((c) => c.html === 'Codice')).toBe(false);
  });
});

describe('listHeaderLabel — html (SXADV-5771)', () => {
  it('icona del legacy: <img> con src riportato a /entrasp/images/', () => {
    const l = listHeaderLabel(TELEFONO);
    expect(l.html).toBeDefined();
    expect(l.html).toMatch(/<img\b[^>]*src="\/entrasp\/images\/icons\/telephone\.png"/i);
    expect(l.html).toContain('AG,33: Telefono:');
    expect(l.html).not.toMatch(/src="images\//);
  });

  it('passa da serverHtml con HTML_POLICY.prompt, e html e\' la sua uscita', () => {
    const l = listHeaderLabel(TELEFONO);
    expect(filtered(TELEFONO)).toBe(true);
    expect(l.html).toBe(serverHtml(TELEFONO, HTML_POLICY.prompt));
  });

  it('html presente anche con le sole entita\'', () => {
    const l = listHeaderLabel('Dare &amp; Avere');
    expect(l.html).toBeDefined();
    expect(filtered('Dare &amp; Avere')).toBe(true);
  });

  it('URL assoluti e http(s) restano come sono', () => {
    const abs = listHeaderLabel('A: <img src="/entrasp/images/icons/a.png">');
    expect(abs.html).toContain('src="/entrasp/images/icons/a.png"');
    expect(abs.html).not.toContain('/entrasp/entrasp/');
    const http = listHeaderLabel('B: <img src="https://cdn.example.com/images/b.png">');
    expect(http.html).toContain('src="https://cdn.example.com/images/b.png"');
  });

  it('un "<" nudo non rompe niente: il testo resta leggibile', () => {
    const l = listHeaderLabel('Data < 2020');
    expect(l.text).toContain('Data');
    if (l.html !== undefined) expect(l.html).not.toMatch(/<script|on[a-z]+=/i);
  });
});

describe('listHeaderLabel — XSS (SXADV-5771)', () => {
  // Il prompt sta anche in DATA_VIEW_ITEM.prompt, modificabile dagli utenti.
  const ATTACKS: Array<[string, string]> = [
    ['<img src=x onerror=alert(1)>', 'onerror'],
    ['Tel: <img src="images/icons/telephone.png" onerror="alert(1)">', 'onerror'],
    ['<IMG SRC=x OnError=alert(1)>', 'onerror'],
    ['<svg onload=alert(1)><circle/></svg>Nome', 'onload'],
    ['<span onmouseover="alert(1)">Nome</span>', 'onmouseover'],
    ['<a href="javascript:alert(1)">x</a>', 'javascript:'],
    ['Nome<script>alert(1)</script>', '<script'],
    ['<iframe src="https://evil.example"></iframe>Nome', '<iframe'],
    ['<table><tr><td>Nome</td></tr></table>', '<table'],
  ];

  it.each(ATTACKS)('%s: niente %s nell\'html', (raw, bad) => {
    const l = listHeaderLabel(raw);
    expect(l.html).toBeDefined();
    expect(l.html!.toLowerCase()).not.toContain(bad.toLowerCase());
    expect(l.html!.toLowerCase()).not.toContain('onerror');
    expect(l.html).not.toBe(raw);
    expect(l.text).not.toContain('<');
  });

  it('l\'html di un attacco e\' sempre quello filtrato, mai il grezzo', () => {
    for (const [raw] of ATTACKS) {
      const l = listHeaderLabel(raw);
      expect(filtered(raw)).toBe(true);
      expect(l.html).toBe(serverHtml(raw, HTML_POLICY.prompt));
    }
  });

  it('lo script sparisce col suo contenuto, il testo vero resta', () => {
    const l = listHeaderLabel('Nome<script>alert(1)</script>');
    expect(l.html).not.toContain('alert');
    expect(l.text).toContain('Nome');
  });

  it('l\'icona sopravvive senza l\'onerror', () => {
    const l = listHeaderLabel('Tel: <img src="images/icons/telephone.png" onerror="alert(1)">');
    expect(l.html).toMatch(/<img\b[^>]*src="\/entrasp\/images\/icons\/telephone\.png"/i);
    expect(l.text).toBe('Tel:');
  });
});
