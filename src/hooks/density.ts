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

/* La preferenza e' **per login**, non per browser (SXADV-5745.E).
 *
 * La prima versione teneva la scelta in una sola chiave di localStorage: chiave
 * unica per origine, quindi condivisa da chiunque usasse quel browser. Due
 * utenti sulla stessa postazione si sovrascrivevano a vicenda — entrando con
 * SX_DESALVO si trovava l'impostazione di SX_ISEPPI, e cambiandola la si
 * cambiava anche all'altro. Il valore sopravviveva al logout (ed e' per questo
 * che il punto 5745.0 risultava soddisfatto), ma sopravviveva a *chiunque*:
 * era persistenza, non memoria dell'utente.
 *
 * Ora la chiave porta il login (`entrasp.ui.density.<LOGIN>`) e l'identita'
 * arriva dal `loginfo` del server. Conseguenze volute:
 *  - al primo accesso di un login la densita' e' il default (Normale), qualunque
 *    cosa abbia scelto chi ha usato la postazione prima;
 *  - la scelta di un utente non e' scrivibile finche' non e' loggato: prima del
 *    login non c'e' un'identita' a cui attribuirla.
 *
 * Resta una preferenza del client: vive nel browser di quella postazione, non
 * segue l'utente su un'altra macchina. Portarla sul server vorrebbe dire
 * inventare un archivio di preferenze utente che il framework non ha, per un
 * dato che non e' dell'applicazione.
 */
const STORAGE_PREFIX = 'entrasp.ui.density.';
/** Chiave globale pre-5745.E: apparteneva all'ultimo che l'aveva toccata, e
 *  lasciarla in giro significherebbe solo poterla riattribuire a qualcuno per
 *  sbaglio. Si rimuove al primo caricamento. */
const LEGACY_STORAGE_KEY = 'entrasp.ui.density';
/** Ultimo login che ha usato questo browser. Serve solo a scegliere la densita'
 *  con cui disegnare i primi frame — prima che il server dica chi e' l'utente,
 *  con un F5 a sessione viva l'alternativa e' un lampeggio dal default alla
 *  densita' scelta. Non e' un'identita': appena il `loginfo` arriva, il valore
 *  viene riletto per il login vero. Il carattere `#` non puo' comparire in un
 *  codice utente, quindi la chiave non collide con nessun login. */
const LAST_LOGIN_KEY = 'entrasp.ui.density#lastLogin';
const DEFAULT_DENSITY: Density = 'normal';

const isDensity = (v: unknown): v is Density =>
  v === 'compact' || v === 'normal' || v === 'comfortable';

/** Forma canonica dell'identita': il login del `loginfo`, normalizzato, oppure
 *  `null` quando nessuno e' autenticato (schermata di login, post-logout). */
export function densityIdentity(login: string | null | undefined): string | null {
  const v = (login ?? '').trim().toUpperCase();
  return v ? v : null;
}

/** A differenza delle modalita' immersiva/zoom (`uiMode.ts`), che sono stati di
 *  lavoro e muoiono col reload, questa e' una preferenza personale: se non
 *  sopravvivesse al ricaricamento della pagina andrebbe riscelta a ogni accesso
 *  e non varrebbe la pena di offrirla. */
function readStored(identity: string | null): Density {
  if (!identity) return DEFAULT_DENSITY;
  try {
    const v = localStorage.getItem(STORAGE_PREFIX + identity);
    if (isDensity(v)) return v;
  } catch {
    // localStorage negato (navigazione privata, policy): si usa il default.
  }
  return DEFAULT_DENSITY;
}

function writeStored(identity: string, density: Density): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + identity, density);
    localStorage.setItem(LAST_LOGIN_KEY, identity);
  } catch {
    // Preferenza non memorizzabile: vale per la sessione corrente.
  }
}

function readLastLogin(): string | null {
  try {
    return densityIdentity(localStorage.getItem(LAST_LOGIN_KEY));
  } catch {
    return null;
  }
}

function forgetLegacyKey(): void {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // niente da rimuovere se lo storage non e' accessibile.
  }
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

/** Corpo del testo del FORM in px, alla densita' corrente — lo stesso valore
 *  che `--app-font-size` da' ai controlli della layout-table. Serve a chi deve
 *  dimensionare un campo sul numero di caratteri che deve contenere: quella
 *  larghezza dipende dal corpo con cui il campo verra' disegnato, e una costante
 *  scritta a mano taglia i campi appena l'utente sceglie "Ampia". */
export function formFontSizePx(): number {
  return DENSITY_FONT_SIZE[currentDensity];
}

/* L'attributo si scrive gia' al caricamento del modulo, prima del primo render:
   applicandolo solo in un effect la pagina lampeggerebbe alla densita' di
   default per un frame prima di assestarsi su quella scelta. Qui l'identita'
   non e' ancora nota, quindi si parte da quella dell'ultimo login su questo
   browser: e' una previsione, non un'attribuzione, e viene corretta appena il
   server dice chi e' collegato. */
const initialDensity: Density = (() => {
  forgetLegacyKey();
  const d = readStored(readLastLogin());
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

/** Stato radice. Vive in un hook perche' il provider stia in App, sopra il
 *  ConfigProvider di antd: il corpo del carattere e' un token del tema, quindi
 *  deve essere noto prima che il tema venga costruito.
 *
 *  `login` e' il `loginfo.login` corrente (`null` quando nessuno e' collegato).
 *  Cambiarlo — accesso, logout, cambio utente — ricarica la densita' di
 *  quell'utente: e' questo il punto in cui la preferenza smette di essere del
 *  browser e diventa di chi lo sta usando (SXADV-5745.E). */
export function useDensityStore(login?: string | null): DensityValue {
  const identity = densityIdentity(login);
  const [density, setDensityState] = useState<Density>(initialDensity);

  useEffect(() => {
    applyAttribute(density);
  }, [density]);

  /* Fuori dal login (schermata iniziale, subito dopo il logout) non si torna al
     default: non c'e' un utente a cui attribuire una densita', e riportare la
     pagina a "Normale" mentre si esce sarebbe solo uno sfarfallio. Quello che
     conta e' che all'ingresso di un login la densita' sia la SUA — default
     compreso, se non ha mai scelto. */
  useEffect(() => {
    if (!identity) return;
    setDensityState(readStored(identity));
    try {
      localStorage.setItem(LAST_LOGIN_KEY, identity);
    } catch {
      // storage non accessibile: la previsione al prossimo caricamento salta.
    }
  }, [identity]);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    // Senza identita' la scelta vale per la pagina corrente e non viene scritta:
    // finirebbe addosso al prossimo che si collega da questo browser.
    if (identity) writeStored(identity, d);
  }, [identity]);

  return useMemo<DensityValue>(() => ({ density, setDensity }), [density, setDensity]);
}
