import { describe, it, expect } from 'vitest';
import * as serverHtmlModule from './serverHtml';

// SXADV-5741.4 — i link PopupUrl/Url del server portano percorsi scritti per il
// legacy, servito da /entrasp/: "doc/x.pdf" va riportato a /entrasp/doc/x.pdf
// (la base della app React e' /entrasp/app/, dove il file non c'e').
// Gli schemi pericolosi non diventano mai un href.

const legacyUrl = (serverHtmlModule as unknown as {
  legacyUrl: (href: string | null | undefined) => string | undefined;
}).legacyUrl;

describe('legacyUrl (SXADV-5741.4)', () => {
  it('e\' esportata da serverHtml', () => {
    expect(typeof legacyUrl).toBe('function');
  });

  it('vuoto, null, undefined → undefined', () => {
    expect(legacyUrl(undefined)).toBeUndefined();
    expect(legacyUrl(null)).toBeUndefined();
    expect(legacyUrl('')).toBeUndefined();
  });

  it('relativo senza barra → sotto /entrasp/', () => {
    expect(legacyUrl('doc/x.pdf')).toBe('/entrasp/doc/x.pdf');
    expect(legacyUrl('doc/anagraficheduplicate.pdf')).toBe('/entrasp/doc/anagraficheduplicate.pdf');
    expect(legacyUrl('doc/ManualeAntiriciclaggio.pdf')).toBe('/entrasp/doc/ManualeAntiriciclaggio.pdf');
    expect(legacyUrl('images/icons/a.png')).toBe('/entrasp/images/icons/a.png');
  });

  it('assoluto: invariato', () => {
    expect(legacyUrl('/entrasp/doc/x.pdf')).toBe('/entrasp/doc/x.pdf');
    expect(legacyUrl('/other/x')).toBe('/other/x');
  });

  it('http, https, mailto, tel: invariati', () => {
    for (const u of ['http://example.com/a.pdf', 'https://example.com/a?b=1', 'mailto:a@b.it', 'tel:+39041000000']) {
      expect(legacyUrl(u)).toBe(u);
    }
  });

  it('schemi pericolosi → undefined', () => {
    for (const u of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(legacyUrl(u), JSON.stringify(u)).toBeUndefined();
    }
  });
});
