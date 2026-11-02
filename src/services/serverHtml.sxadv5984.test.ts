// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serverHtml, HTML_POLICY, looksLikeServerHtml } from './serverHtml';

// SXADV-5984 — il link della colonna Revisioni, ora un href vero. Il filtro della
// politica `cell` lo lascia passare intatto, porta l'icona sotto /entrasp/, e
// continua a togliere tutto cio' che esegue qualcosa. Filtro vero, DOM vero.

const LINK_SERVER =
  '<div id="dvtX"><a id="X" target="_blank" href="/entrasp/controller?action=DownloadAllegato&amp;sid=S1&amp;key=44%7CUUID%7C1&amp;option1=inline">'
  + '<img src="images/icons/page_white_put.png" /></a></div>';
const HREF_ATTESO = '/entrasp/controller?action=DownloadAllegato&sid=S1&key=44%7CUUID%7C1&option1=inline';

/** L'uscita del filtro, rimessa in un DOM per leggerne gli attributi. */
const filtra = (html: string): HTMLElement => {
  const box = document.createElement('div');
  box.innerHTML = serverHtml(html, HTML_POLICY.cell);
  return box;
};

describe('SXADV-5984 il link vero passa dal filtro cell', () => {
  it('la cella e\' riconosciuta come markup', () => {
    expect(looksLikeServerHtml(LINK_SERVER)).toBe(true);
  });

  it('href con i parametri intatto', () => {
    expect(filtra(LINK_SERVER).querySelector('a')?.getAttribute('href')).toBe(HREF_ATTESO);
  });

  it('le & restano una sola entita\' nel markup, senza doppia codifica', () => {
    const out = serverHtml(LINK_SERVER, HTML_POLICY.cell);
    expect(out).toContain('action=DownloadAllegato&amp;sid=S1&amp;key=44%7CUUID%7C1&amp;option1=inline');
    expect(out).not.toContain('&amp;amp;');
  });

  it('target="_blank" resta e si aggiunge rel noopener', () => {
    const a = filtra(LINK_SERVER).querySelector('a');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('target maiuscolo: il link resta e ha comunque rel', () => {
    const a = filtra('<A HREF="/entrasp/controller?a=1" TARGET="_BLANK">x</A>').querySelector('a');
    expect(a?.getAttribute('href')).toBe('/entrasp/controller?a=1');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('il src relativo images/ diventa /entrasp/images/', () => {
    expect(filtra(LINK_SERVER).querySelector('img')?.getAttribute('src'))
      .toBe('/entrasp/images/icons/page_white_put.png');
  });

  it('l\'immagine resta dentro il link, il link dentro il div', () => {
    expect(filtra(LINK_SERVER).querySelector('div > a[href] > img')).not.toBeNull();
  });

  it.each([
    ['gia\' assoluto', '/entrasp/images/a.png'],
    ['http', 'http://host/images/a.png'],
    ['altra cartella', '/altro/images/a.png'],
  ])('src %s: non si tocca', (_nome, src) => {
    expect(filtra(`<img src="${src}">`).querySelector('img')?.getAttribute('src')).toBe(src);
  });
});

describe('SXADV-5984 il filtro cell continua a togliere cio\' che esegue', () => {
  // Scritti come arrivano nel markup: entita' e controlli li risolve il parser.
  it.each([
    ['il vecchio link del server', 'javascript:openWin4(\'x\',\'y\')'],
    ['minuscolo', 'javascript:alert(1)'],
    ['maiuscole miste', 'JaVaScRiPt:alert(1)'],
    ['tab nello schema', 'java\tscript:alert(1)'],
    ['a capo nello schema', 'java\nscript:alert(1)'],
    ['CR nello schema', 'java\rscript:alert(1)'],
    ['spazi davanti', '   javascript:alert(1)'],
    ['controllo davanti', '\u0001javascript:alert(1)'],
    ['entita\' decimale', '&#106;avascript:alert(1)'],
    ['entita\' esadecimale con tab', 'java&#x09;script:alert(1)'],
    ['due punti come entita\'', 'javascript&colon;alert(1)'],
    ['data: html', 'data:text/html,<script>alert(1)</script>'],
    ['data: maiuscolo', 'DATA:text/html;base64,PHNjcmlwdD4='],
    ['data: anche se immagine', 'data:image/png;base64,AAAA'],
    ['vbscript', 'vbscript:msgbox(1)'],
  ])('href via, il contenuto resta: %s', (_nome, href) => {
    const a = filtra(`<a href="${href.replace(/"/g, '&quot;')}"><img src="images/i.png" />testo</a>`).querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.hasAttribute('href')).toBe(false);
    expect(a?.querySelector('img')).not.toBeNull();
    expect(a?.textContent).toBe('testo');
  });

  it.each([
    ['onclick su a', '<a href="/x" onclick="alert(1)">t</a>'],
    ['ONCLICK maiuscolo', '<a href="/x" ONCLICK="alert(1)">t</a>'],
    ['onmouseover su a', '<a href="/x" onmouseover="alert(1)">t</a>'],
    ['onerror su img', '<img src="images/i.png" onerror="alert(1)">'],
    ['onload su img', '<img src="images/i.png" onload="alert(1)">'],
    ['onclick su div', '<div onclick="alert(1)">t</div>'],
    ['onfocus su span', '<span onfocus="alert(1)" tabindex="0">t</span>'],
    ['dentro il link vero', LINK_SERVER.replace('<img ', '<img onerror="alert(1)" ').replace('<a ', '<a onclick="alert(1)" ')],
  ])('nessun on*: %s', (_nome, html) => {
    const box = filtra(html);
    const attrs = Array.from(box.querySelectorAll('*')).flatMap((el) => Array.from(el.attributes).map((a) => a.name));
    expect(attrs.filter((n) => n.toLowerCase().startsWith('on'))).toEqual([]);
  });

  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['JS maiuscole e tab', 'Java\tScript:alert(1)'],
    ['svg, che porta script', 'data:image/svg+xml;base64,PHN2Zz4='],
    ['data html', 'data:text/html,x'],
  ])('src via: %s', (_nome, src) => {
    expect(filtra(`<img src="${src}">`).querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('data: di un\'immagine raster resta (contratto esistente)', () => {
    const src = 'data:image/png;base64,AAAA';
    expect(filtra(`<img src="${src}">`).querySelector('img')?.getAttribute('src')).toBe(src);
  });

  it.each(['_top', '_parent', 'javascript:alert(1)'])('target non ammesso via: %s', (target) => {
    const a = filtra(`<a href="/x" target="${target}">t</a>`).querySelector('a');
    expect(a?.hasAttribute('target')).toBe(false);
    expect(a?.getAttribute('href')).toBe('/x');
  });

  it('script e svg spariscono col contenuto, anche dentro il link', () => {
    const box = filtra('<a href="/x"><script>alert(1)</script><svg><a href="javascript:alert(1)">y</a></svg>ok</a>');
    expect(box.querySelector('script, svg')).toBeNull();
    expect(box.querySelector('a')?.textContent).toBe('ok');
    expect(box.querySelectorAll('a[href^="javascript" i]').length).toBe(0);
  });
});
