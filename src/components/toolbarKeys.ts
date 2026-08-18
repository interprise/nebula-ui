/**
 * Acceleratori dei bottoni di toolbar: dai keyCode legacy alle combo del DOM.
 *
 * Il server li manda già da sempre — `Toolbar.graphicButton` (CORE) emette
 * `keys` (array con il keyCode in stile ExtJS) e `shift` su ogni bottone
 * abilitato che abbia un'azione — ma il client React se ne serviva solo per
 * comporre il tooltip, e ci scriveva dentro il numero grezzo ("120").
 *
 * Censimento dei bottoni che dichiarano un tasto in CORE + entrasp: sono due,
 * `save` = 120 (F9) e `saveNew` = 121 (F10), entrambi in `RecordNavigator`.
 * Tasti funzione, quindi senza collisioni con la digitazione.
 */

const NAMED_KEYCODES: Record<number, string> = {
  8: 'Backspace',
  9: 'Tab',
  13: 'Enter',
  19: 'Pause',
  27: 'Escape',
  32: ' ',
  33: 'PageUp',
  34: 'PageDown',
  35: 'End',
  36: 'Home',
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  45: 'Insert',
  46: 'Delete',
};

/** keyCode legacy → `KeyboardEvent.key`, o null se non lo sappiamo tradurre
 *  (meglio nessun acceleratore che uno sbagliato). */
export function keyNameFromKeyCode(code: number): string | null {
  if (NAMED_KEYCODES[code]) return NAMED_KEYCODES[code];
  if (code >= 112 && code <= 123) return `F${code - 111}`;      // F1..F12
  if (code >= 48 && code <= 57) return String.fromCharCode(code); // 0..9
  if (code >= 96 && code <= 105) return String(code - 96);        // tastierino
  if (code >= 65 && code <= 90) return String.fromCharCode(code); // A..Z
  return null;
}

/** Il campo `keys` arriva come array JSON di interi; il tipo dichiarato lato
 *  client diceva `string`. Si accettano tutte e tre le forme per non dipendere
 *  da quella discrepanza. */
function firstKeyCode(keys: unknown): number | null {
  const raw = Array.isArray(keys) ? keys[0] : keys;
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : null;
}

/** Combo normalizzata per un bottone di toolbar, o null se il bottone non
 *  dichiara un tasto utilizzabile. */
export function comboFromToolbarKeys(keys: unknown, shift?: boolean): string | null {
  const code = firstKeyCode(keys);
  if (code == null) return null;
  const name = keyNameFromKeyCode(code);
  if (!name) return null;
  return shift ? `Shift+${name}` : name;
}

/** Etichetta leggibile per il tooltip: "F9", "Shift+F10". Lo Spazio ha un nome
 *  proprio perché ' ' da solo non si vede. */
export function comboLabel(combo: string): string {
  return combo === ' ' ? 'Spazio' : combo.replace(/\+ $/, '+Spazio');
}
