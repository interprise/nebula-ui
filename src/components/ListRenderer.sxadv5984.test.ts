// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { serverHtml, HTML_POLICY } from '../services/serverHtml';
import sorgente from './ListRenderer.tsx?raw';

// SXADV-5984 — il clic su un link dentro una cella apre il link e non attiva la
// riga; il clic sul testo della cella la attiva come sempre. ROW_ACTIVATION_IGNORE
// non e' esportata: si legge dal sorgente, cosi' la prova vede il valore vero e
// non una copia. Il DOM e' reale, l'evento e' un clic vero che risale alla riga.

const SELETTORE = /const ROW_ACTIVATION_IGNORE\s*=\s*'([^']*)'/.exec(sorgente)?.[1] ?? '';

const LINK_SERVER =
  '<div id="dvtX"><a id="X" target="_blank" href="/entrasp/controller?action=DownloadAllegato&amp;sid=S1&amp;key=44%7CUUID%7C1&amp;option1=inline">'
  + '<img src="images/icons/page_white_put.png" /></a></div>';

/** Una riga di AG Grid con dentro l'HTML di cella: filtrato se e' del server. */
const rigaCon = (html: string): HTMLElement => {
  const riga = document.createElement('div');
  riga.className = 'ag-row';
  riga.innerHTML = `<div class="ag-cell"><span class="contenuto">${html}</span></div>`;
  document.body.replaceChildren(riga);
  return riga;
};

/** Clic vero su `el`: alla riga arriva come a handleRowClicked. Vero = riga attivata. */
const attivaLaRiga = (riga: HTMLElement, el: Element): boolean => {
  let attivata = false;
  riga.addEventListener('click', (e) => {
    e.preventDefault(); // jsdom non naviga
    attivata = !(e.target as Element).closest(SELETTORE);
  });
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return attivata;
};

const dentro = (riga: HTMLElement, sel: string): Element => {
  const el = riga.querySelector(sel);
  if (!el) throw new Error(`manca ${sel} nella riga: ${riga.innerHTML}`);
  return el;
};

describe('SXADV-5984 il selettore e\' quello dei gestori', () => {
  it('si legge dal sorgente', () => {
    expect(SELETTORE).not.toBe('');
  });

  it('e\' un selettore valido', () => {
    expect(() => document.body.matches(SELETTORE)).not.toThrow();
  });

  it('entrambe le vie di attivazione lo consultano', () => {
    expect(sorgente).toMatch(/handleRowClicked[\s\S]{0,400}closest\(ROW_ACTIVATION_IGNORE\)/);
    expect(sorgente).toMatch(/handleGridClick[\s\S]{0,200}closest\(ROW_ACTIVATION_IGNORE\)/);
  });
});

describe('SXADV-5984 il clic sul link non attiva la riga', () => {
  const cella = serverHtml(LINK_SERVER, HTML_POLICY.cell);

  it('sul link', () => {
    const riga = rigaCon(cella);
    expect(attivaLaRiga(riga, dentro(riga, 'a[href]'))).toBe(false);
  });

  it('sull\'immagine dentro il link', () => {
    const riga = rigaCon(cella);
    expect(attivaLaRiga(riga, dentro(riga, 'a[href] img'))).toBe(false);
  });

  it('su un elemento annidato piu\' a fondo nel link', () => {
    const riga = rigaCon('<a href="/x"><b><span class="fondo">t</span></b></a>');
    expect(attivaLaRiga(riga, dentro(riga, '.fondo'))).toBe(false);
  });

  it('link relativo, esterno, mailto: tutti link', () => {
    for (const href of ['doc/x.pdf', 'https://esempio.it/', 'mailto:a@b.it']) {
      const riga = rigaCon(`<a href="${href}">t</a>`);
      expect(attivaLaRiga(riga, dentro(riga, 'a'))).toBe(false);
    }
  });
});

describe('SXADV-5984 il resto della cella attiva la riga', () => {
  it('testo normale', () => {
    const riga = rigaCon('Revisione 3');
    expect(attivaLaRiga(riga, dentro(riga, '.contenuto'))).toBe(true);
  });

  it('il corpo della cella', () => {
    const riga = rigaCon('Revisione 3');
    expect(attivaLaRiga(riga, dentro(riga, '.ag-cell'))).toBe(true);
  });

  it('il div che avvolge il link, fuori dal link', () => {
    const riga = rigaCon(serverHtml(LINK_SERVER, HTML_POLICY.cell));
    expect(attivaLaRiga(riga, dentro(riga, 'div:has(> a)'))).toBe(true);
  });

  it('un testo accanto al link nella stessa cella', () => {
    const riga = rigaCon('<b class="accanto">Rev. 3</b> <a href="/x">apri</a>');
    expect(attivaLaRiga(riga, dentro(riga, '.accanto'))).toBe(true);
  });

  it('<a> senza href: non e\' un link', () => {
    const riga = rigaCon('<a>ancora</a>');
    expect(attivaLaRiga(riga, dentro(riga, 'a'))).toBe(true);
  });

  it('immagine dentro <a> senza href', () => {
    const riga = rigaCon('<a><img src="/i.png"></a>');
    expect(attivaLaRiga(riga, dentro(riga, 'img'))).toBe(true);
  });

  it('il vecchio link javascript: filtrato perde href e torna ad attivare', () => {
    const riga = rigaCon(serverHtml('<a href="javascript:openWin4(1)"><img src="images/i.png"></a>', HTML_POLICY.cell));
    expect(attivaLaRiga(riga, dentro(riga, 'img'))).toBe(true);
  });
});

describe('SXADV-5984 gli altri comandi di cella restano esclusi', () => {
  it.each([
    ['.list-cell-control', '<span class="list-cell-control"><i class="t">x</i></span>'],
    ['.selector-nav-cell', '<span class="selector-nav-cell"><i class="t">x</i></span>'],
    ['button', '<button><i class="t">x</i></button>'],
    ['input', '<input class="t">'],
    ['select', '<select class="t"></select>'],
    ['textarea', '<textarea class="t"></textarea>'],
    ['.ant-select', '<div class="ant-select"><i class="t">x</i></div>'],
    ['.ant-select-dropdown', '<div class="ant-select-dropdown"><i class="t">x</i></div>'],
    ['.ant-btn', '<span class="ant-btn"><i class="t">x</i></span>'],
    ['combobox', '<div role="combobox"><i class="t">x</i></div>'],
    ['option', '<div role="option"><i class="t">x</i></div>'],
  ])('%s', (_nome, html) => {
    const riga = rigaCon(html);
    expect(attivaLaRiga(riga, dentro(riga, '.t'))).toBe(false);
  });
});
