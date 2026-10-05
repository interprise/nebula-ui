import { describe, it, expect } from 'vitest';
import * as content from './oneLineContent';
import {
  ONE_LINE_SEPARATOR,
  ONE_LINE_MAX_COL_WIDTH,
  ONE_LINE_CELL_PAD,
  hasLineBreak,
  joinLineBreaks,
  oneLinePlainText,
  fitWidthToContent,
} from './oneLineContent';

// SXADV-6012: Clienti / Fornitori / Anagrafica Unica hanno poche colonne che
// entrano nella finestra, ma le righe sono alte perche' Indirizzo e Contatti
// portano un `<br/>` composto dal server. In modalita' "un record per riga"
// (solo liste senza bande di continuazione) gli a capo del markup diventano un
// separatore sulla stessa riga e la colonna si allarga al contenuto.

// pageHasLineBreaks puo' non esistere ancora: lo si prende dal modulo, cosi' la
// sua assenza fa fallire solo i suoi test e non l'intero file.
const pageHasLineBreaks = (values: Iterable<unknown>): boolean => {
  const fn = (content as Record<string, unknown>).pageHasLineBreaks as
    | ((v: Iterable<unknown>) => boolean)
    | undefined;
  if (typeof fn !== 'function') throw new Error('pageHasLineBreaks non e\' esportata da oneLineContent');
  return fn(values);
};

const ZAMENHOF = 'VIA LUDWIK LEJZER ZAMENHOF 23<br/>41125 MODENA (MO)';
const SASSUOLO = 'VIA PO 24<br/>41049 SASSUOLO (MO)';
const CONTATTI = 'Telefono: 0522340812 , Cellulare: 3487723479';
const NBSP = ' ';

describe('costanti', () => {
  it('separatore, tetto e padding come da contratto', () => {
    expect(ONE_LINE_SEPARATOR).toBe(' · ');
    expect(ONE_LINE_MAX_COL_WIDTH).toBe(720);
    expect(ONE_LINE_CELL_PAD).toBe(14);
  });
});

describe('hasLineBreak', () => {
  it.each([
    ['<br/> di un indirizzo', ZAMENHOF],
    ['<br> nudo', 'VIA PO 24<br>41049 SASSUOLO (MO)'],
    ['<br /> con spazio', 'Mario Rossi<br />Via Roma 1'],
    ['maiuscolo <BR/>', 'VIA PO 24<BR/>41049'],
    ['maiuscole miste <Br>', 'a<Br>b'],
    ['spazi multipli <br   />', 'a<br   />b'],
    ['solo l\'a capo', '<br/>'],
    ['a capo in testa', '<br/>VIA PO 24'],
    ['dentro altro markup', '<b>Rossi</b><br />Modena'],
  ])('%s -> true', (_label, v) => {
    expect(hasLineBreak(v)).toBe(true);
  });

  it.each([
    ['contatti senza a capo', CONTATTI],
    ['stringa vuota', ''],
    ['tag simile <brx>', 'a<brx>b'],
    ['tag simile <break>', 'a<break>b'],
    ['tag simile <bR-x/>', 'a<bR-x/>b'],
    ['entita\' escapata &lt;br/&gt;', 'a&lt;br/&gt;b'],
    ['testo "br" senza parentesi', 'br / br'],
    ['grassetto senza a capo', '<b>Rossi</b>'],
    ['dump XML di un BO', '<Clienti codice="1"/>'],
  ])('%s -> false', (_label, v) => {
    expect(hasLineBreak(v)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['numero', 1220],
    ['booleano', true],
    ['oggetto', { value: '<br/>' }],
    ['array con a capo', ['<br/>']],
  ])('non stringa (%s) -> false', (_label, v) => {
    expect(hasLineBreak(v)).toBe(false);
  });

  it('chiamate ripetute non dipendono da stato della regex (lastIndex)', () => {
    for (let i = 0; i < 5; i++) expect(hasLineBreak(SASSUOLO)).toBe(true);
  });
});

describe('joinLineBreaks', () => {
  it('indirizzo Clienti: via e citta\' sulla stessa riga', () => {
    expect(joinLineBreaks(ZAMENHOF)).toBe('VIA LUDWIK LEJZER ZAMENHOF 23 · 41125 MODENA (MO)');
  });

  it('separatore di default = ONE_LINE_SEPARATOR', () => {
    expect(joinLineBreaks(SASSUOLO)).toBe(`VIA PO 24${ONE_LINE_SEPARATOR}41049 SASSUOLO (MO)`);
  });

  it('separatore esplicito', () => {
    expect(joinLineBreaks(SASSUOLO, ' | ')).toBe('VIA PO 24 | 41049 SASSUOLO (MO)');
  });

  it('separatore con caratteri speciali di replace ($&, $1, $$) resta letterale', () => {
    expect(joinLineBreaks('a<br/>b', '$&')).toBe('a$&b');
    expect(joinLineBreaks('a<br/>b', '$1')).toBe('a$1b');
    expect(joinLineBreaks('a<br/>b', '$$')).toBe('a$$b');
    expect(joinLineBreaks('a<br/>b', '$`')).toBe('a$`b');
  });

  it('tutte le varianti di a capo', () => {
    expect(joinLineBreaks('a<br>b<BR/>c<br />d<Br   />e', '|')).toBe('a|b|c|d|e');
  });

  it('piu\' a capo di fila valgono uno solo', () => {
    expect(joinLineBreaks('VIA PO 24<br/><br/><br/>41049 SASSUOLO', '|')).toBe('VIA PO 24|41049 SASSUOLO');
  });

  it('a capo di fila separati solo da spazi bianchi valgono uno solo', () => {
    expect(joinLineBreaks('VIA PO 24<br/> \n\t <br />41049', '|')).toBe('VIA PO 24|41049');
  });

  it('gli spazi attorno all\'a capo sono assorbiti dal separatore', () => {
    expect(joinLineBreaks('VIA PO 24 <br/> 41049', '|')).toBe('VIA PO 24|41049');
    expect(joinLineBreaks('VIA PO 24\n<br/>\n41049', '|')).toBe('VIA PO 24|41049');
  });

  it('a capo in testa spariscono senza separatore', () => {
    expect(joinLineBreaks('<br/>VIA PO 24', '|')).toBe('VIA PO 24');
    expect(joinLineBreaks('  <br/> <br>VIA PO 24', '|')).toBe('VIA PO 24');
  });

  it('a capo in coda spariscono senza separatore', () => {
    expect(joinLineBreaks('VIA PO 24<br/>', '|')).toBe('VIA PO 24');
    expect(joinLineBreaks('VIA PO 24<br/><br />  ', '|')).toBe('VIA PO 24');
  });

  it('a capo in testa, in mezzo e in coda', () => {
    expect(joinLineBreaks('<br/>VIA PO 24<br/>41049 SASSUOLO<br/>', '|')).toBe('VIA PO 24|41049 SASSUOLO');
  });

  it('solo a capo -> stringa vuota (nessun separatore orfano)', () => {
    expect(joinLineBreaks('<br/>', '|')).toBe('');
    expect(joinLineBreaks('<br/><br/> <br>', '|')).toBe('');
  });

  it('stringa vuota -> stringa vuota', () => {
    expect(joinLineBreaks('')).toBe('');
  });

  it('descrizione di lookup composta: <b> resta, <br /> diventa separatore', () => {
    expect(joinLineBreaks('<b>ROSSI MARIO</b><br />C.F. RSSMRA80A01F257X'))
      .toBe('<b>ROSSI MARIO</b> · C.F. RSSMRA80A01F257X');
  });

  it('a capo dentro un <b> non rompe il markup circostante', () => {
    expect(joinLineBreaks('<b>VIA PO 24<br/>41049</b>', '|')).toBe('<b>VIA PO 24|41049</b>');
  });

  it('tag simili a <br> non sono a capo', () => {
    expect(joinLineBreaks('a<brx>b<break>c', '|')).toBe('a<brx>b<break>c');
  });

  it('valore senza a capo torna identico (contatti)', () => {
    expect(joinLineBreaks(CONTATTI)).toBe(CONTATTI);
  });

  it('regressione Iscritti/Tessere: valori senza a capo invariati, spazi compresi', () => {
    for (const v of ['  0001234  ', 'TESSERA 2026', '<b>Socio</b>', '1.220,00 €', '&#160;&#160;Attivo', '<Clienti codice="1"/>']) {
      expect(joinLineBreaks(v)).toBe(v);
    }
  });
});

describe('oneLinePlainText', () => {
  it('indirizzo: a capo -> separatore, testo piano', () => {
    expect(oneLinePlainText(ZAMENHOF, true)).toBe('VIA LUDWIK LEJZER ZAMENHOF 23 · 41125 MODENA (MO)');
  });

  it('separatore esplicito', () => {
    expect(oneLinePlainText(SASSUOLO, true, ' / ')).toBe('VIA PO 24 / 41049 SASSUOLO (MO)');
  });

  it('lookup composta: tag tolti, a capo -> separatore', () => {
    expect(oneLinePlainText('<b>ROSSI MARIO</b><br />C.F. RSSMRA80A01F257X', true))
      .toBe('ROSSI MARIO · C.F. RSSMRA80A01F257X');
  });

  it('tag con attributi vengono tolti', () => {
    expect(oneLinePlainText('<span class="x" style="color:red">Modena</span>', true)).toBe('Modena');
  });

  it('contatti senza markup restano uguali in entrambe le modalita\'', () => {
    expect(oneLinePlainText(CONTATTI, true)).toBe(CONTATTI);
    expect(oneLinePlainText(CONTATTI, false)).toBe(CONTATTI);
  });

  it('asHtml=false: il dump XML di un BO resta visibile come testo', () => {
    expect(oneLinePlainText('<Clienti codice="1"/>', false)).toBe('<Clienti codice="1"/>');
  });

  it('asHtml=false: un <br/> e\' testo letterale, non un a capo', () => {
    expect(oneLinePlainText('VIA PO 24<br/>41049', false)).toBe('VIA PO 24<br/>41049');
  });

  it('asHtml=true: entita\' escapate diventano testo, non tag da togliere', () => {
    expect(oneLinePlainText('&lt;Clienti codice=&quot;1&quot;/&gt;', true)).toBe('<Clienti codice="1"/>');
  });

  it('entita\' nominate decodificate in entrambe le modalita\'', () => {
    for (const asHtml of [true, false]) {
      expect(oneLinePlainText('Rossi &amp; Figli &lt;srl&gt; &quot;A&quot; &apos;B&apos;', asHtml))
        .toBe('Rossi & Figli <srl> "A" \'B\'');
    }
  });

  it('&nbsp;, &#160; e &#xA0; diventano U+00A0', () => {
    expect(oneLinePlainText('a&nbsp;b', true)).toBe(`a${NBSP}b`);
    expect(oneLinePlainText('a&#160;b', true)).toBe(`a${NBSP}b`);
    expect(oneLinePlainText('a&#xA0;b', false)).toBe(`a${NBSP}b`);
    expect(oneLinePlainText('a&#xa0;b', false)).toBe(`a${NBSP}b`);
  });

  it('entita\' numeriche generiche (decimali ed esadecimali)', () => {
    expect(oneLinePlainText('&#8364; 1.220,00', true)).toBe('€ 1.220,00');
    expect(oneLinePlainText('&#x20AC; 1.220,00', false)).toBe('€ 1.220,00');
  });

  it('niente doppia decodifica: &amp;lt; -> "&lt;" letterale', () => {
    expect(oneLinePlainText('&amp;lt;', true)).toBe('&lt;');
    expect(oneLinePlainText('&amp;#160;', false)).toBe('&#160;');
  });

  it('entita\' nominate sconosciute restano letterali', () => {
    expect(oneLinePlainText('caff&egrave; &foo;', true)).toBe('caff&egrave; &foo;');
  });

  it('& senza entita\' resta letterale', () => {
    expect(oneLinePlainText('Rossi & Figli', true)).toBe('Rossi & Figli');
  });

  it('Bilancio: l\'indentazione con &#160; in testa resta tutta', () => {
    expect(oneLinePlainText('&#160;&#160;&#160;&#160;Attivo', true)).toBe(`${NBSP.repeat(4)}Attivo`);
    expect(oneLinePlainText('&#160;&#160;&#160;&#160;Attivo', false)).toBe(`${NBSP.repeat(4)}Attivo`);
  });

  it('U+00A0 gia\' come carattere, in testa e in coda, resta', () => {
    expect(oneLinePlainText(`${NBSP}${NBSP}Attivo${NBSP}`, false)).toBe(`${NBSP}${NBSP}Attivo${NBSP}`);
    expect(oneLinePlainText(`${NBSP}${NBSP}Attivo`, true)).toBe(`${NBSP}${NBSP}Attivo`);
  });

  it('U+00A0 interni non si comprimono', () => {
    expect(oneLinePlainText(`a${NBSP}${NBSP}${NBSP}b`, true)).toBe(`a${NBSP}${NBSP}${NBSP}b`);
  });

  it('spazi comuni (spazio, tab, CR, LF) si comprimono in uno e si tolgono ai bordi', () => {
    expect(oneLinePlainText('  VIA PO\t\t24 \r\n 41049  ', false)).toBe('VIA PO 24 41049');
    expect(oneLinePlainText('\n\tVIA PO   24\r\n', true)).toBe('VIA PO 24');
  });

  it('spazi da entita\' (&#32;, &#10;) si comprimono come gli altri', () => {
    expect(oneLinePlainText('a&#32;&#32;&#10;b', true)).toBe('a b');
  });

  it('spazi comuni attorno a U+00A0 in testa: si toglie lo spazio, resta l\'indentazione', () => {
    expect(oneLinePlainText(` ${NBSP}${NBSP}Attivo `, false)).toBe(`${NBSP}${NBSP}Attivo`);
  });

  it('a capo solo in testa/coda: nessun separatore nel testo misurato', () => {
    expect(oneLinePlainText('<br/>VIA PO 24<br/>', true)).toBe('VIA PO 24');
  });

  it('tag che restano vuoti dopo la rimozione non lasciano spazi ai bordi', () => {
    expect(oneLinePlainText(' <b> </b> Modena <i></i> ', true)).toBe('Modena');
  });

  // Il contratto: gli U+00A0 restano "cosi' come sono, anche in testa". Un a
  // capo in testa sparisce, ma l'indentazione che lo segue e' contenuto: non
  // deve essere assorbita come se fosse spazio comune (in JS `\s` comprende
  // U+00A0, ed e' facile mangiarla insieme all'a capo).
  it('indentazione U+00A0 dopo un a capo in testa resta', () => {
    expect(oneLinePlainText(`<br/>${NBSP}${NBSP}Attivo`, true)).toBe(`${NBSP}${NBSP}Attivo`);
  });

  // Stesso principio in mezzo: l'indentazione del secondo rigo e' contenuto e
  // occupa larghezza, il separatore non la deve inghiottire.
  it('indentazione U+00A0 dopo un a capo in mezzo resta dopo il separatore', () => {
    expect(oneLinePlainText(`Attivo<br/>${NBSP}${NBSP}Crediti`, true, '|')).toBe(`Attivo|${NBSP}${NBSP}Crediti`);
  });

  // Un "<" seguito da spazio non e' un tag per il parser HTML: il browser lo
  // mostra come testo. Se la misura lo tratta da tag inghiotte il testo fino al
  // ">" successivo e la colonna viene stretta.
  it('"<" seguito da spazio in HTML e\' testo, non apre un tag', () => {
    expect(oneLinePlainText('Importo < 100 <b>scaduto</b>', true)).toBe('Importo < 100 scaduto');
  });

  it('stringa vuota -> stringa vuota', () => {
    expect(oneLinePlainText('', true)).toBe('');
    expect(oneLinePlainText('', false)).toBe('');
  });

  it('solo spazi -> stringa vuota', () => {
    expect(oneLinePlainText(' \t\r\n ', true)).toBe('');
  });
});

describe('fitWidthToContent', () => {
  it('contenuto piu\' largo della dichiarata: contenuto + pad', () => {
    expect(fitWidthToContent(120, 300)).toBe(314);
  });

  it('contenuto piu\' stretto: resta la dichiarata', () => {
    expect(fitWidthToContent(200, 50)).toBe(200);
  });

  it('contenuto + pad uguale alla dichiarata', () => {
    expect(fitWidthToContent(214, 200)).toBe(214);
  });

  it('misura frazionaria arrotondata per eccesso prima del pad', () => {
    expect(fitWidthToContent(100, 200.01)).toBe(215);
    expect(fitWidthToContent(100, 200)).toBe(214);
  });

  // Il tetto e' 720: i contatti di Fornitori misurano 490-940px, con 480 meta'
  // delle righe restavano tagliate.
  it('tetto: un contenuto enorme si ferma a 720', () => {
    expect(fitWidthToContent(120, 5000)).toBe(720);
  });

  it('contatti Fornitori da 490-700px non sono piu\' tagliati (oltre il vecchio 480)', () => {
    expect(fitWidthToContent(120, 490)).toBe(504);
    expect(fitWidthToContent(120, 700)).toBe(714);
  });

  it('contenuto che col pad supera di poco il tetto si ferma al tetto', () => {
    expect(fitWidthToContent(120, 710)).toBe(720);
    expect(fitWidthToContent(120, 706)).toBe(720);
    expect(fitWidthToContent(120, 705.5)).toBe(720);
    expect(fitWidthToContent(120, 705)).toBe(719);
  });

  it('dichiarata gia\' oltre il tetto resta com\'e\' (il tetto non restringe)', () => {
    expect(fitWidthToContent(900, 5000)).toBe(900);
    expect(fitWidthToContent(900, 10)).toBe(900);
  });

  it('dichiarata esattamente al tetto', () => {
    expect(fitWidthToContent(720, 1000)).toBe(720);
  });

  it('dichiarata fra il vecchio e il nuovo tetto cresce fino a 720', () => {
    expect(fitWidthToContent(600, 5000)).toBe(720);
    expect(fitWidthToContent(600, 10)).toBe(600);
  });

  it('il tetto di default e\' ONE_LINE_MAX_COL_WIDTH', () => {
    expect(fitWidthToContent(0.5, 1e6)).toBe(ONE_LINE_MAX_COL_WIDTH);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['0', 0],
    ['-0', -0],
    ['negativa', -50],
  ])('misura non valida (%s) -> dichiarata', (_label, w) => {
    expect(fitWidthToContent(150, w)).toBe(150);
  });

  it('pad e cap personalizzati', () => {
    expect(fitWidthToContent(100, 300, { pad: 0, cap: 1000 })).toBe(300);
    expect(fitWidthToContent(100, 300, { pad: 20 })).toBe(320);
    expect(fitWidthToContent(100, 300, { cap: 250 })).toBe(250);
  });

  it('cap personalizzato sotto la dichiarata non restringe', () => {
    expect(fitWidthToContent(300, 1000, { cap: 200 })).toBe(300);
  });

  it('options vuote = default', () => {
    expect(fitWidthToContent(120, 300, {})).toBe(314);
  });
});

describe('pageHasLineBreaks', () => {
  it('pagina Clienti: un indirizzo con <br/> basta', () => {
    expect(pageHasLineBreaks(['C001', 'ROSSI MARIO', ZAMENHOF, CONTATTI])).toBe(true);
  });

  it('pagina senza a capo (Iscritti/Tessere) -> false', () => {
    expect(pageHasLineBreaks(['0001234', 'TESSERA 2026', CONTATTI, '<b>Socio</b>', '<Clienti codice="1"/>'])).toBe(false);
  });

  it('iterabile vuoto -> false', () => {
    expect(pageHasLineBreaks([])).toBe(false);
    expect(pageHasLineBreaks(new Set())).toBe(false);
  });

  it('valori non stringa ignorati', () => {
    expect(pageHasLineBreaks([null, undefined, 12, true, { a: '<br/>' }, ['<br/>']])).toBe(false);
    expect(pageHasLineBreaks([null, 12, SASSUOLO])).toBe(true);
  });

  it('tag simili non contano', () => {
    expect(pageHasLineBreaks(['a<brx>b', 'c<break>d'])).toBe(false);
  });

  it('accetta Set e generatori (qualunque Iterable)', () => {
    expect(pageHasLineBreaks(new Set(['x', SASSUOLO]))).toBe(true);
    function* gen() { yield 'x'; yield 'y<BR>z'; }
    expect(pageHasLineBreaks(gen())).toBe(true);
  });

  it('si ferma al primo a capo (non consuma tutto un generatore infinito)', () => {
    function* infinite() { yield 'x'; yield SASSUOLO; for (;;) yield 'y'; }
    expect(pageHasLineBreaks(infinite())).toBe(true);
  });
});
