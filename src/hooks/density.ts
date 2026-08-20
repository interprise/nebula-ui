import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Densità tipografica dell'interfaccia (SXADV-5745).
 *
 * Il problema segnalato non è il carattere ma il **corpo**: Inter ha una
 * x-height di circa 0.73em contro lo 0.55em del Tahoma/Verdana del client
 * legacy, quindi a parità di corpo nominale i glifi sono circa il 40% più
 * alti. Inter a 13px ingombra come Tahoma a 17px: il guadagno di leggibilità
 * è reale, ma il corpo era stato scelto come se i due caratteri fossero
 * intercambiabili, e l'area di editing ne paga la differenza in campi visibili.
 *
 * Leggibilità e densità sono due decisioni distinte e finora sono state prese
 * insieme. Qui vengono separate: il carattere resta Inter per tutti, il corpo
 * diventa una preferenza dell'utente. Chi ha bisogno di vedere più righe
 * sceglie "Compatta" — che a 12px resta comunque più leggibile del legacy,
 * perché la x-height di Inter a 12px (~8.7px) supera ancora quella di Tahoma
 * a 12px (~6.5px) — e chi lavora su schermi piccoli o ha bisogno di corpi
 * grandi sceglie "Ampia", senza che nessuna delle due scelte sia imposta
 * all'altro.
 *
 * Dove atterra la scelta:
 *  - attributo `data-density` su <html>, che seleziona il blocco di token in
 *    `styles/tokens.css` (corpo, altezza dei controlli, interlinee, griglie);
 *  - token `fontSize` di antd, per i componenti che non passano dal CSS della
 *    layout-table (modali, tendine, toolbar, menu);
 *  - il righello della layout-table (`ViewRenderer`), che misura le etichette
 *    con lo stesso corpo con cui verranno disegnate.
 *
 * Le altezze dei controlli **dentro** il form arrivano dai token CSS, non da
 * `controlHeight` di antd: la layout-table le forza già con `!important` e
 * l'altezza della chrome applicativa è stata tarata a parte (SXADV-5742), non
 * va trascinata dietro al corpo del carattere.
 */

export type Density = 'compact' | 'normal' | 'comfortable';

export const DENSITY_OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: 'compact', label: 'Compatta', hint: 'Più campi a schermo' },
  { value: 'normal', label: 'Normale', hint: 'Impostazione predefinita' },
  { value: 'comfortable', label: 'Ampia', hint: 'Caratteri più grandi' },
];

/** Corpo base per preset, passato al token `fontSize` di antd. Tiene il passo
 *  con `--app-font-size` in tokens.css: sono lo stesso valore per due consumatori
 *  diversi, e se divergono i componenti antd fuori dal form si disallineano da
 *  quelli dentro. */
export const DENSITY_FONT_SIZE: Record<Density, number> = {
  compact: 12,
  normal: 13,
  comfortable: 14,
};

/** Come sopra, per il testo di griglia: tiene il passo con
 *  `--app-grid-font-size`. Serve a chi misura le intestazioni su canvas
 *  (`ListRenderer`), che deve usare lo stesso corpo con cui verranno disegnate. */
export const DENSITY_GRID_FONT_SIZE: Record<Density, number> = {
  compact: 11,
  normal: 12,
  comfortable: 13,
};

const STORAGE_KEY = 'entrasp.ui.density';
const DEFAULT_DENSITY: Density = 'normal';

const isDensity = (v: unknown): v is Density =>
  v === 'compact' || v === 'normal' || v === 'comfortable';

/** A differenza delle modalità immersiva/zoom (`uiMode.ts`), che sono stati di
 *  lavoro e muoiono col reload, questa è una preferenza personale: se non
 *  sopravvivesse al ricaricamento della pagina andrebbe riscelta a ogni accesso
 *  e non varrebbe la pena di offrirla. Resta comunque solo sul client — non è
 *  un dato dell'applicazione e non ha motivo di attraversare il protocollo. */
function readStored(): Density {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isDensity(v)) return v;
  } catch {
    // localStorage negato (navigazione privata, policy): si usa il default.
  }
  return DEFAULT_DENSITY;
}

/** Ultima densita' applicata. Esiste per chi misura testo fuori dall'albero
 *  React — funzioni di modulo che non possono leggere un context — e vuole
 *  farlo con il corpo giusto senza pagare una `getComputedStyle` a chiamata. */
let currentDensity: Density = DEFAULT_DENSITY;

function applyAttribute(density: Density): void {
  currentDensity = density;
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-density', density);
}

/** Corpo del testo di griglia in px, alla densita' corrente. */
export function gridFontSizePx(): number {
  return DENSITY_GRID_FONT_SIZE[currentDensity];
}

/* L'attributo si scrive già al caricamento del modulo, prima del primo render:
   applicandolo solo in un effect la pagina lampeggerebbe alla densità di
   default per un frame prima di assestarsi su quella scelta. */
const initialDensity: Density = (() => {
  const d = readStored();
  applyAttribute(d);
  return d;
})();

export interface DensityValue {
  density: Density;
  setDensity: (d: Density) => void;
}

export const DensityContext = createContext<DensityValue>({
  density: DEFAULT_DENSITY,
  setDensity: () => {},
});

/** Densità corrente + selettore, per chi la mostra (menu utente) o deve
 *  rimisurare quando cambia (righello della layout-table). */
export function useDensity(): DensityValue {
  return useContext(DensityContext);
}

/** Stato radice. Vive in un hook perché il provider stia in App, sopra il
 *  ConfigProvider di antd: il corpo del carattere è un token del tema, quindi
 *  deve essere noto prima che il tema venga costruito. */
export function useDensityStore(): DensityValue {
  const [density, setDensityState] = useState<Density>(initialDensity);

  useEffect(() => {
    applyAttribute(density);
  }, [density]);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    try {
      localStorage.setItem(STORAGE_KEY, d);
    } catch {
      // Preferenza non memorizzabile: vale per la sessione corrente.
    }
  }, []);

  return useMemo<DensityValue>(() => ({ density, setDensity }), [density, setDensity]);
}
