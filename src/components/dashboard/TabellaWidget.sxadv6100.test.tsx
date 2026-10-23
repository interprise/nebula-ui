import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// SXADV-6100.1 C4 C5 e riga «Html» della tabella del contratto — la resa di TabellaWidget.
// Oracolo: docs/sxadv-62-prove/SXADV6100_contratto.md. Chi prova non e' chi implementa.
//
//   - le colonne marcate `azione` non hanno ne' intestazione ne' celle;
//   - le altre celle restano sotto la loro intestazione (gli indici non slittano: C2);
//   - colonna `tipo === "Html"` oppure valore con un tag della lista dei tag ammessi ->
//     HTML FILTRATO (la stessa regola della lista), suggerimento (`title`) senza tag;
//   - il resto e' testo, con le entita' decodificate; un `<script>` non e' mai eseguito;
//   - con `schemaCambiato` la tabella si mostra com'e', tutte le colonne (C5).
//
// Niente DOM nei test (vitest in node, ne' jsdom ne' happy-dom): la tabella si disegna col
// render lato server. DOMParser manca: un supplente minimo (solo textContent) come in
// listHeaders.sxadv5771.test.tsx; `serverHtml` e' sostituito da un finto che toglie
// <script> e on* e REGISTRA la politica con cui e' chiamato — la prova che la cella passa
// dal filtro vero e' che arriva li' con HTML_POLICY.cell.
//
// Decisione della prova: il `title` delle celle il codice lo mette solo quando la colonna
// ha una larghezza (testo tagliato coi puntini). I casi sul suggerimento danno quindi una
// larghezza alla colonna; il contratto dice COM'E' il suggerimento, non QUANDO c'e'.

const chiamate = vi.hoisted(() => [] as Array<{ html: string; policy: unknown }>);
vi.mock('../../services/serverHtml', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../services/serverHtml')>();
  const finto = (html: string) =>
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return {
    ...real,
    serverHtml: (html: string, policy: unknown) => {
      chiamate.push({ html, policy });
      return real.fixServerHtml(finto(html));
    },
  };
});

const g = globalThis as Record<string, unknown>;
if (typeof g.DOMParser === 'undefined') {
  g.DOMParser = class {
    parseFromString(s: string) {
      const textContent = s
        .replace(/<(script|style|svg|iframe)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&egrave;/g, 'è').replace(/&amp;/g, '&');
      return { body: { textContent, innerText: textContent, innerHTML: s }, documentElement: { textContent } };
    }
  };
}

const { HTML_POLICY } = await import('../../services/serverHtml');
const { default: TabellaWidget } = await import('./TabellaWidget');
type P = Parameters<typeof TabellaWidget>[0];

function disegna(p: Partial<P>): string {
  const props: P = {
    colonne: [],
    righe: [],
    vista: null,
    rigaApribile: () => false,
    onApri: () => {},
    onVista: () => {},
    ...p,
  } as P;
  return renderToStaticMarkup(<TabellaWidget {...props} />);
}

/** I testi delle intestazioni, nell'ordine. */
const intestazioni = (html: string) =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, '').replace(/[▲▼]/g, '').trim(),
  );
/** Le righe del corpo: per ogni <tr> del tbody l'HTML interno delle <td>. */
const righeHtml = (html: string) => {
  const corpo = /<tbody>([\s\S]*)<\/tbody>/.exec(html)?.[1] || '';
  return [...corpo.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...r[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ attr: c[1], dentro: c[2] })),
  );
};
const testoDi = (h: string) => h.replace(/<[^>]*>/g, '').trim();
const titleDi = (attr: string) => {
  const m = /\btitle="([^"]*)"/.exec(attr);
  return m ? m[1] : undefined;
};

// La W1 di Elena in piccolo: due colonne-dato, due comandi in mezzo e in fondo.
const COLONNE_W1 = [
  { item: 'numDoc', etichetta: 'Num doc.', tipo: 'Text' },
  { item: 'visualizzaFE', etichetta: 'visualizzaFE', tipo: 'SingleAction', azione: true },
  { item: 'anagrafica', etichetta: 'Cliente', tipo: 'List' },
  { item: 'att', etichetta: 'Allegati', tipo: 'Attachments' },
  { item: 'print', etichetta: 'Stampa', tipo: 'ReportBar', azione: true },
];
const RIGHE_W1 = [
  { k: 'K1', c: [{ t: 'F001' }, { t: 'COMANDO-1' }, { t: 'Rossi SpA' }, { t: 'a.pdf, b.pdf' }, { t: 'STAMPA-1' }] },
  { k: 'K2', c: [{ t: 'F002' }, { t: '' }, { t: 'Bianchi Srl' }, { t: '' }, { t: '' }] },
];

beforeEach(() => {
  chiamate.length = 0;
});

describe('SXADV-6100.1 C4: le colonne di comando non si disegnano', () => {
  it('niente intestazione per le colonne marcate azione', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1 });
    expect(intestazioni(h)).toEqual(['Num doc.', 'Cliente', 'Allegati']);
  });

  it('niente celle per le colonne marcate azione (neanche col testo dentro)', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1 });
    expect(h).not.toContain('COMANDO-1');
    expect(h).not.toContain('STAMPA-1');
    expect(h).not.toContain('visualizzaFE');
    expect(h).not.toContain('Stampa');
  });

  it('le altre celle stanno sotto la loro intestazione (gli indici non slittano)', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1 });
    const r = righeHtml(h);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.map((c) => testoDi(c.dentro)))).toEqual([
      ['F001', 'Rossi SpA', 'a.pdf, b.pdf'],
      ['F002', 'Bianchi Srl', ''],
    ]);
  });

  it('tante celle per riga quante intestazioni', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1 });
    const n = intestazioni(h).length;
    for (const r of righeHtml(h)) expect(r.length).toBe(n);
  });

  it('con l\'ordine di chi guarda (vista) i comandi restano fuori e le celle seguono le intestazioni', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, vista: { ordineColonne: [4, 2, 1, 0, 3] } });
    expect(intestazioni(h)).toEqual(['Cliente', 'Num doc.', 'Allegati']);
    expect(righeHtml(h)[0].map((c) => testoDi(c.dentro))).toEqual(['Rossi SpA', 'F001', 'a.pdf, b.pdf']);
  });

  it('con ordineIniziale (6001.0) i comandi restano fuori', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, ordineIniziale: [1, 4, 3, 2, 0] });
    expect(intestazioni(h)).toEqual(['Allegati', 'Cliente', 'Num doc.']);
    expect(righeHtml(h)[0].map((c) => testoDi(c.dentro))).toEqual(['a.pdf, b.pdf', 'Rossi SpA', 'F001']);
  });

  it('nascoste tutte le colonne-dato tranne una: si vede lei, mai un comando', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, vista: { nascoste: [0, 3] } });
    expect(intestazioni(h)).toEqual(['Cliente']);
    expect(righeHtml(h)[0].map((c) => testoDi(c.dentro))).toEqual(['Rossi SpA']);
  });

  it('nascoste tutte le colonne-dato: le nascoste non contano, i comandi restano fuori', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, vista: { nascoste: [0, 2, 3] } });
    expect(intestazioni(h)).toEqual(['Num doc.', 'Cliente', 'Allegati']);
  });

  it('una larghezza salvata su una colonna dopo un comando resta alla SUA colonna', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, vista: { larghezze: { '2': 333 } } });
    const th = [...h.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)];
    const cliente = th.find((m) => m[2].includes('Cliente'));
    expect(cliente?.[1]).toMatch(/width:\s*333px/);
    for (const m of th.filter((x) => !x[2].includes('Cliente'))) expect(m[1]).not.toMatch(/333px/);
  });

  it('senza colonne marcate: tutte le colonne, come prima del 6100', () => {
    const colonne = COLONNE_W1.map((c) => ({ ...c, azione: undefined }));
    const h = disegna({ colonne, righe: RIGHE_W1 });
    expect(intestazioni(h)).toEqual(['Num doc.', 'visualizzaFE', 'Cliente', 'Allegati', 'Stampa']);
  });
});

describe('SXADV-6100.1 C5: schemaCambiato mostra tutto', () => {
  it('tutte le intestazioni, comandi compresi', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, schemaCambiato: true });
    expect(intestazioni(h)).toEqual(['Num doc.', 'visualizzaFE', 'Cliente', 'Allegati', 'Stampa']);
  });

  it('tutte le celle com\'erano, anche quelle dei comandi', () => {
    const h = disegna({ colonne: COLONNE_W1, righe: RIGHE_W1, schemaCambiato: true });
    expect(righeHtml(h)[0].map((c) => testoDi(c.dentro))).toEqual([
      'F001', 'COMANDO-1', 'Rossi SpA', 'a.pdf, b.pdf', 'STAMPA-1',
    ]);
  });

  it('e la vista di chi guarda non si applica', () => {
    const h = disegna({
      colonne: COLONNE_W1, righe: RIGHE_W1, schemaCambiato: true, vista: { ordineColonne: [4, 3, 2, 1, 0], nascoste: [0] },
    });
    expect(intestazioni(h)).toEqual(['Num doc.', 'visualizzaFE', 'Cliente', 'Allegati', 'Stampa']);
  });
});

describe('SXADV-6100.1 celle Html e markup: HTML filtrato, suggerimento senza tag', () => {
  const COL = [
    { item: 'indirizzo', etichetta: 'Indirizzo', tipo: 'Html' },
    { item: 'descrizione', etichetta: 'Descrizione', tipo: 'Text' },
  ];
  const conLarghezze = { larghezze: { '0': 120, '1': 120 } };

  it('colonna tipo Html: passa dal filtro con la politica delle celle, e il markup resta markup', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: 'Via Roma 1<br/>41100 Modena' }, { t: 'x' }] }] });
    expect(chiamate.some((c) => c.html === 'Via Roma 1<br/>41100 Modena' && c.policy === HTML_POLICY.cell)).toBe(true);
    const cella = righeHtml(h)[0][0].dentro;
    expect(cella).toMatch(/<br\s*\/?>/);
    expect(cella).not.toContain('&lt;br');
  });

  it('valore con un tag ELENCATO in una colonna di testo: HTML filtrato come nella lista', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: '' }, { t: '<b>Rossi</b> SpA' }] }] });
    expect(chiamate.some((c) => c.html === '<b>Rossi</b> SpA' && c.policy === HTML_POLICY.cell)).toBe(true);
    const cella = righeHtml(h)[0][1].dentro;
    expect(cella).toContain('<b>Rossi</b>');
    expect(cella).not.toContain('&lt;b&gt;');
  });

  it('suggerimento di una cella Html: il testo senza tag', () => {
    const h = disegna({
      colonne: COL, vista: conLarghezze, righe: [{ k: '1', c: [{ t: 'Via Roma 1<br/>41100 <b>Modena</b>' }, { t: 'x' }] }],
    });
    const t = titleDi(righeHtml(h)[0][0].attr);
    expect(t).toBeDefined();
    expect(t).not.toMatch(/[<>]|&lt;|&gt;/);
    expect(t).toContain('Via Roma 1');
    expect(t).toContain('Modena');
  });

  it('suggerimento di un valore con tag elencati in colonna di testo: senza tag', () => {
    const h = disegna({ colonne: COL, vista: conLarghezze, righe: [{ k: '1', c: [{ t: '' }, { t: '<b>Rossi</b> SpA' }] }] });
    const t = titleDi(righeHtml(h)[0][1].attr);
    expect(t).toBe('Rossi SpA');
  });

  it('un tag NON elencato (dump XML di un BO) resta testo visibile, non sparisce', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: '' }, { t: '<Documenti id="7"/>' }] }] });
    const cella = righeHtml(h)[0][1].dentro;
    expect(cella).toContain('&lt;Documenti');
    expect(chiamate.some((c) => c.html.includes('<Documenti'))).toBe(false);
  });

  it('<script> in una colonna di testo: testo, mai un elemento script', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: '' }, { t: '<script>alert(1)</script>' }] }] });
    expect(h).not.toMatch(/<script/i);
    expect(righeHtml(h)[0][1].dentro).toContain('&lt;script&gt;');
  });

  it('<script> in una colonna Html: filtrato, nessun elemento script nella pagina', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: 'ok<script>alert(1)</script><br/>' }, { t: '' }] }] });
    expect(h).not.toMatch(/<script/i);
    expect(chiamate.some((c) => c.policy === HTML_POLICY.cell && c.html.includes('<script>'))).toBe(true);
  });

  it('<img onerror> (tag elencato) in colonna di testo: passa dal filtro, nessun on* in pagina', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: '' }, { t: '<img src="x" onerror="alert(1)">' }] }] });
    expect(chiamate.some((c) => c.policy === HTML_POLICY.cell && c.html.includes('onerror'))).toBe(true);
    expect(h).not.toMatch(/onerror/i);
  });

  it('il suggerimento di una cella con <script>/onerror non porta lo script', () => {
    const h = disegna({
      colonne: COL, vista: conLarghezze,
      righe: [{ k: '1', c: [{ t: 'A<script>alert(1)</script><img src=x onerror=alert(2)>B' }, { t: '' }] }],
    });
    const t = titleDi(righeHtml(h)[0][0].attr) || '';
    expect(t).not.toMatch(/alert|<|>/);
  });

  it('il valore di prima (cella cambiata) con markup: anche lui filtrato', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: '<b>nuovo</b>', p: '<b>vecchio</b><script>x()</script>' }, { t: '' }] }] });
    expect(h).not.toMatch(/<script/i);
    expect(h).toContain('<b>vecchio</b>');
  });
});

describe('SXADV-6100.1 testo semplice', () => {
  const COL = [{ item: 'descrizione', etichetta: 'Descrizione', tipo: 'Text' }];

  it('le entita\' diventano i loro caratteri (e non si mostrano due volte codificate)', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: 'Caff&#232; &amp; latte' }] }] });
    const cella = righeHtml(h)[0][0].dentro;
    expect(cella).toBe('Caffè &amp; latte');
    expect(cella).not.toContain('&amp;amp;');
    expect(cella).not.toContain('&#232;');
  });

  it('&nbsp; di indentazione: spazi, non il testo «&nbsp;»', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: '&#160;&#160;Conto' }] }] });
    expect(righeHtml(h)[0][0].dentro).not.toContain('&amp;#160;');
    expect(righeHtml(h)[0][0].dentro).toContain('Conto');
  });

  it('un testo con < e > che non e\' un tag resta testo', () => {
    const h = disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: 'importo < 100 e > 50' }] }] });
    expect(righeHtml(h)[0][0].dentro).toBe('importo &lt; 100 e &gt; 50');
  });

  it('una colonna di testo semplice non passa dal filtro HTML', () => {
    disegna({ colonne: COL, righe: [{ k: '1', c: [{ t: 'Rossi SpA' }] }] });
    expect(chiamate).toEqual([]);
  });

  it('cella vuota, nulla o mancante: cella vuota, niente «null»/«undefined»', () => {
    const h = disegna({
      colonne: [...COL, { item: 'b', etichetta: 'B', tipo: 'Text' }],
      righe: [{ k: '1', c: [{ t: undefined }, {}] }, { k: '2', c: [{ t: '' }] }],
    });
    for (const r of righeHtml(h)) for (const c of r) expect(c.dentro).not.toMatch(/null|undefined/);
  });

  it('suggerimento del testo semplice: il testo decodificato', () => {
    const h = disegna({ colonne: COL, vista: { larghezze: { '0': 100 } }, righe: [{ k: '1', c: [{ t: 'A &amp; B' }] }] });
    // nell'attributo l'& torna codificato da React: il testo e' «A & B»
    expect(titleDi(righeHtml(h)[0][0].attr)).toBe('A &amp; B');
  });
});
