// Colore della testata dall'azienda di accesso (SXADV-5639, 5454.4).
//
// Il valore e' "Colore Testata" di Config > Aziende (Aziende.coloreTestata),
// testo libero che arriva cosi' com'e' in loginInfo.bkColor. Sul DB convivono
// '#6666CC' e '00BFFF': il legacy li dipinge entrambi perche' la sua pagina e' in
// quirks mode, dove un esadecimale senza '#' vale ancora come colore. Qui no: un
// valore non valido assegnato a style.background viene scartato dal browser, e la
// testata RESTA del colore dell'azienda di prima.
//
// Quindi: '#' davanti agli esadecimali nudi, e un valore che il browser non
// prenderebbe torna al colore di default, cosi' la testata viene comunque
// ridipinta.

export const DEFAULT_HEADER_COLOR = '#1E4176';

const BARE_HEX = /^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function headerColor(raw: string | null | undefined): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return DEFAULT_HEADER_COLOR;
  const color = BARE_HEX.test(v) ? `#${v}` : v;
  const css = (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS;
  if (typeof css?.supports === 'function') {
    try {
      if (!css.supports('color', color)) return DEFAULT_HEADER_COLOR;
    } catch {
      return DEFAULT_HEADER_COLOR;
    }
  }
  return color;
}
