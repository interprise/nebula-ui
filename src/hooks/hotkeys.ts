import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';

/**
 * Dispatcher di tastiera globale: registro unico, priorità esplicita.
 *
 * Tre funzionalità si appoggiano qui — acceleratori della toolbar, modalità
 * immersiva, zoom della griglia (SXADV-5737) — e prima di questo file
 * l'applicazione non aveva **un solo** listener `keydown` globale: esistevano
 * soltanto handler locali (ComboControl, ExpBuilderControl, l'input di pagina
 * nella Toolbar). Lasciando che ognuna delle tre se ne portasse uno,
 * l'applicazione si sarebbe ritrovata con tre idee diverse di chi vince su Esc.
 *
 * Vedi `docs/planned/20260817_immersive_zoom_hotkeys_spec.md`.
 */

/* ── Combo ──────────────────────────────────────────────────────────────── */

/** Ordine canonico dei modificatori: una combo si confronta per stringa, quindi
 *  registrazione ed evento devono comporla nello stesso modo. */
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Meta', 'Shift'] as const;

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt',
  meta: 'Meta', cmd: 'Meta', command: 'Meta', shift: 'Shift',
};

/** Normalizza `KeyboardEvent.key`: i tasti singoli in maiuscolo (con Shift
 *  premuto `key` è già maiuscolo, senza no — e sarebbero due combo diverse per
 *  lo stesso tasto), i nomi lunghi come li scrive il DOM ("Escape", "F9"). */
function normalizeKeyName(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** "shift+f9" → "Shift+F9". Accetta qualunque ordine di modificatori. */
export function normalizeCombo(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  const mods = new Set<string>();
  let key = '';
  for (const p of parts) {
    const mod = MODIFIER_ALIASES[p.toLowerCase()];
    if (mod) mods.add(mod);
    else key = normalizeKeyName(p);
  }
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].filter(Boolean).join('+');
}

export function comboFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.metaKey) mods.push('Meta');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, normalizeKeyName(e.key)].join('+');
}

/* ── Guardie ────────────────────────────────────────────────────────────── */

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** L'utente sta digitando? Obbligatorio prima di qualunque bind: senza questa
 *  guardia un acceleratore ruba il tasto mentre si compila un campo. Copre
 *  anche gli editor di cella AG Grid, che sono input veri ma annidati. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (TYPING_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.('.ag-cell-inline-editing, .ag-popup-editor');
}

/** Overlay antd aperto (modale, drawer, dropdown, calendario, popover). Con uno
 *  di questi aperto l'applicazione sta aspettando una risposta: nessun
 *  acceleratore deve partire, ed Esc appartiene all'overlay, non a noi. */
const OVERLAY_SELECTOR = [
  '.ant-modal-wrap:not(.ant-modal-wrap-hidden)',
  '.ant-drawer-open',
  '.ant-dropdown:not(.ant-dropdown-hidden)',
  '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '.ant-popover:not(.ant-popover-hidden)',
  '.ag-popup-editor',
].join(',');

export function hasOpenOverlay(): boolean {
  return !!document.querySelector(OVERLAY_SELECTOR);
}

/* ── Registro ───────────────────────────────────────────────────────────── */

/** Priorità: vince la più alta, e ne parte **una sola**. Su Esc questo produce
 *  la semantica voluta — si chiude la modalità più interna, una per pressione. */
export const HotkeyPriority = {
  /** Acceleratori dei bottoni di toolbar (F9 Salva, F10 Salva+). */
  toolbar: 10,
  /** Uscita dalla modalità immersiva. */
  immersive: 20,
  /** Rete di sicurezza della vista: c'è uno zoom acceso ma nessuna griglia lo
   *  rivendica (può succedere tornando indietro su un tab diverso da quello
   *  zoomato). Senza, la testata resterebbe collassata con la barra dei tab
   *  nascosta e nessun pulsante per riaprirla. */
  gridZoomFallback: 25,
  /** Uscita dallo zoom griglia: più interna dell'immersiva, quindi prima. */
  gridZoom: 30,
  /** Chiusura del pannello di editing di una lista listEdit: è la superficie
   *  più interna di tutte — una modifica in corso su un rigo — quindi Esc
   *  chiude prima quello e solo alla pressione dopo lo zoom o l'immersiva. */
  editPanel: 40,
} as const;

export interface HotkeyOptions {
  /** Vince la più alta fra quelle registrate sulla stessa combo. */
  priority?: number;
  /** A false la registrazione non viene fatta (comodo per gli Esc condizionali). */
  enabled?: boolean;
  /** Parte anche mentre l'utente digita. Spento di default, da accendere solo
   *  con una ragione: è la guardia che rende gli acceleratori innocui. */
  allowWhileTyping?: boolean;
  /** Parte anche sull'auto-ripetizione del tasto tenuto premuto. */
  allowRepeat?: boolean;
}

interface Registration extends Required<HotkeyOptions> {
  combo: string;
  handler: (e: KeyboardEvent) => void;
}

export interface HotkeyRegistry {
  register: (reg: Registration) => () => void;
}

export const HotkeyRegistryContext = createContext<HotkeyRegistry>({ register: () => () => {} });

/** Tasti che restano al browser finché non c'è una ragione esplicita per
 *  toglierglieli: F1 è l'aiuto, F5 il ricaricamento. Nessun bottone di toolbar
 *  li usa oggi (l'unico censimento nel codice CORE dà 120=F9 e 121=F10). */
const BROWSER_RESERVED = new Set(['F1', 'F5']);

/** Stato e listener del registro. Vive in un hook perché il provider che lo
 *  monta stia in un file di soli componenti (react-refresh). */
export function useHotkeyRegistry(): HotkeyRegistry {
  const regsRef = useRef<Set<Registration>>(new Set());

  const register = useCallback((reg: Registration) => {
    regsRef.current.add(reg);
    return () => { regsRef.current.delete(reg); };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Già gestito da qualcun altro (handler locale di un control, antd…).
      if (e.defaultPrevented) return;
      if (hasOpenOverlay()) return;
      const combo = comboFromEvent(e);
      const typing = isTypingTarget(e.target);
      let best: Registration | null = null;
      for (const reg of regsRef.current) {
        if (reg.combo !== combo) continue;
        if (typing && !reg.allowWhileTyping) continue;
        if (e.repeat && !reg.allowRepeat) continue;
        if (!best || reg.priority > best.priority) best = reg;
      }
      if (!best) return;
      e.preventDefault();
      e.stopPropagation();
      best.handler(e);
    };
    // Fase di bubbling: gli handler locali dei control vedono il tasto per
    // primi e possono fermarlo (preventDefault) prima che arrivi qui.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return useMemo<HotkeyRegistry>(() => ({ register }), [register]);
}

/* ── Hook di registrazione ──────────────────────────────────────────────── */

/** Registra una singola combo. `combo` a null/undefined = nessuna
 *  registrazione, così un chiamante può passare un valore che non ha ancora. */
export function useHotkey(
  combo: string | null | undefined,
  handler: (e: KeyboardEvent) => void,
  options?: HotkeyOptions,
): void {
  const { register } = useContext(HotkeyRegistryContext);
  // L'handler cambia identità a ogni render; tenerlo in un ref evita di
  // ri-registrare (e quindi di perdere la combo per un frame) ogni volta.
  const handlerRef = useRef(handler);
  useEffect(() => { handlerRef.current = handler; });
  const { priority = 0, enabled = true, allowWhileTyping = false, allowRepeat = false } = options ?? {};
  const normalized = combo ? normalizeCombo(combo) : null;

  useEffect(() => {
    if (!normalized || !enabled) return;
    if (BROWSER_RESERVED.has(normalized)) {
      console.warn(`[hotkeys] ${normalized} è riservata al browser: registrazione ignorata`);
      return;
    }
    return register({
      combo: normalized,
      priority,
      enabled,
      allowWhileTyping,
      allowRepeat,
      handler: (e) => handlerRef.current(e),
    });
  }, [normalized, enabled, priority, allowWhileTyping, allowRepeat, register]);
}

export interface HotkeyBinding {
  combo: string;
  handler: (e: KeyboardEvent) => void;
}

/** Registra un elenco di combo che cambia nel tempo — il caso della toolbar,
 *  che si ricostruisce a ogni risposta del server. Le registrazioni si rifanno
 *  quando cambia l'insieme delle combo, non a ogni render. */
export function useHotkeys(bindings: HotkeyBinding[], options?: HotkeyOptions): void {
  const { register } = useContext(HotkeyRegistryContext);
  const bindingsRef = useRef(bindings);
  useEffect(() => { bindingsRef.current = bindings; });
  const { priority = 0, enabled = true, allowWhileTyping = false, allowRepeat = false } = options ?? {};
  const signature = bindings.map((b) => normalizeCombo(b.combo)).join('|');

  useEffect(() => {
    if (!enabled || !signature) return;
    const combos = signature.split('|');
    const seen = new Set<string>();
    const unregisters: Array<() => void> = [];
    combos.forEach((combo, i) => {
      if (BROWSER_RESERVED.has(combo)) {
        console.warn(`[hotkeys] ${combo} è riservata al browser: registrazione ignorata`);
        return;
      }
      if (seen.has(combo)) {
        console.warn(`[hotkeys] combo duplicata ${combo}: vale la prima registrata`);
        return;
      }
      seen.add(combo);
      unregisters.push(register({
        combo,
        priority,
        enabled,
        allowWhileTyping,
        allowRepeat,
        // Per indice: l'elenco corrente sta nel ref, quindi l'handler resta
        // valido anche quando la toolbar si ricostruisce senza cambiare combo.
        handler: (e) => bindingsRef.current[i]?.handler(e),
      }));
    });
    return () => unregisters.forEach((u) => u());
  }, [signature, enabled, priority, allowWhileTyping, allowRepeat, register]);
}
