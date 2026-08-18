import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { HotkeyPriority, useHotkey } from './hotkeys';

/**
 * Stato delle modalità UI: immersiva (chrome applicativa nascosta) e zoom
 * griglia (SXADV-5737, testata e barra tab collassate).
 *
 * Sono indipendenti e componibili: lo zoom non tocca la chrome, l'immersiva non
 * tocca la vista. Il conto in pixel dice perché — la testata vale 10-15 righe di
 * griglia, tutta la chrome applicativa insieme ne vale 2, e la sidebar non dà
 * righe ma larghezza. Vedi `docs/planned/20260817_immersive_zoom_hotkeys_spec.md`.
 *
 * Stato client: non arriva al server e non sopravvive al reload della pagina.
 */

/** Ambito dello zoom: sessione + vista. Chi zooma una griglia di righi lo fa
 *  per lavorarci su più record — apre il dettaglio di un rigo, torna, apre il
 *  successivo — quindi il ritorno deve ritrovare lo schermo come l'aveva
 *  lasciato. Memorizzando lo zoom per ambito, la vista di dettaglio nuova non
 *  trova una voce e si vede intera, e al ritorno la griglia si rizooma da sé:
 *  nessuno deve azzerare niente alla navigazione.
 *
 *  Shell lo calcola in fase di render, non in un effect, altrimenti la vista
 *  nuova si dipingerebbe per un frame con lo zoom di quella vecchia. */
export const ZoomScopeContext = createContext<string>('');

interface UiModeStore {
  immersive: boolean;
  setImmersive: (v: boolean) => void;
  /** ambito → identità della griglia zoomata in quell'ambito. */
  zoomByScope: Record<string, string>;
  setZoomForScope: (scope: string, gridId: string | null) => void;
  /** `ambito::griglia` → true quando quella griglia è in modalità una-riga.
   *  Chiave composta e non annidata perché più griglie della stessa vista
   *  possono starci contemporaneamente, a differenza dello zoom. */
  oneLineGrids: Record<string, boolean>;
  setOneLineForScope: (scope: string, gridId: string, on: boolean) => void;
}

const UiModeStoreContext = createContext<UiModeStore>({
  immersive: false,
  setImmersive: () => {},
  zoomByScope: {},
  setZoomForScope: () => {},
  oneLineGrids: {},
  setOneLineForScope: () => {},
});

export interface UiModeValue {
  /** Chrome applicativa nascosta (app bar, sidebar, header, strip sessioni).
   *  A differenza dello zoom NON è per vista: si porta avanti nella
   *  navigazione, perché la chrome che nasconde è la stessa ovunque. */
  immersive: boolean;
  setImmersive: (v: boolean) => void;
  /** `ui.path` della griglia zoomata **nell'ambito corrente**, o null.
   *  Identifica quale griglia quando una vista ne ha più d'una. */
  zoomedGridId: string | null;
  setZoomedGridId: (gridId: string | null) => void;
  /** Modalità una-riga: ogni record su una sola linea orizzontale, le bande di
   *  continuazione diventate colonne. Per griglia e per vista, come lo zoom. */
  isOneLine: (gridId: string) => boolean;
  setOneLine: (gridId: string, on: boolean) => void;
}

/** Vista sullo stato per l'ambito corrente. Chi la usa non sa che lo zoom è
 *  memorizzato per vista: legge e scrive un valore solo. */
export function useUiMode(): UiModeValue {
  const store = useContext(UiModeStoreContext);
  const scope = useContext(ZoomScopeContext);
  const { immersive, setImmersive, zoomByScope, setZoomForScope, oneLineGrids, setOneLineForScope } = store;
  const zoomedGridId = zoomByScope[scope] ?? null;
  const setZoomedGridId = useCallback(
    (gridId: string | null) => setZoomForScope(scope, gridId),
    [setZoomForScope, scope],
  );
  const isOneLine = useCallback(
    (gridId: string) => !!oneLineGrids[`${scope}::${gridId}`],
    [oneLineGrids, scope],
  );
  const setOneLine = useCallback(
    (gridId: string, on: boolean) => setOneLineForScope(scope, gridId, on),
    [setOneLineForScope, scope],
  );
  return useMemo<UiModeValue>(
    () => ({ immersive, setImmersive, zoomedGridId, setZoomedGridId, isOneLine, setOneLine }),
    [immersive, setImmersive, zoomedGridId, setZoomedGridId, isOneLine, setOneLine],
  );
}

/** Stato + uscite da tastiera. Vive in un hook perché il provider che lo monta
 *  stia in un file di soli componenti (react-refresh). */
export function useUiModeStore(): UiModeStore {
  const [immersive, setImmersive] = useState(false);
  const [zoomByScope, setZoomByScope] = useState<Record<string, string>>({});
  const [oneLineGrids, setOneLineGrids] = useState<Record<string, boolean>>({});

  const setOneLineForScope = useCallback((scope: string, gridId: string, on: boolean) => {
    setOneLineGrids((prev) => {
      const key = `${scope}::${gridId}`;
      if (!!prev[key] === on) return prev;
      if (!on) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: true };
    });
  }, []);

  const setZoomForScope = useCallback((scope: string, path: string | null) => {
    setZoomByScope((prev) => {
      if (path == null) {
        if (!(scope in prev)) return prev;
        const next = { ...prev };
        delete next[scope];
        return next;
      }
      if (prev[scope] === path) return prev;
      return { ...prev, [scope]: path };
    });
  }, []);

  // Esc chiude la modalità più interna attiva, una per pressione: con entrambe
  // attive la prima Esc toglie lo zoom, la seconda l'immersiva.
  //
  // L'Esc dello zoom NON sta qui ma nella griglia zoomata (`ListRenderer`, con
  // priorità gridZoom): da qui non si saprebbe quale ambito chiudere, e con lo
  // zoom memorizzato su una vista che al momento non è a schermo si finirebbe
  // per rubare Esc e cancellare uno stato che l'utente non sta vedendo.
  useHotkey('Escape', () => setImmersive(false), {
    priority: HotkeyPriority.immersive,
    enabled: immersive,
  });

  return useMemo<UiModeStore>(
    () => ({ immersive, setImmersive, zoomByScope, setZoomForScope, oneLineGrids, setOneLineForScope }),
    [immersive, zoomByScope, setZoomForScope, oneLineGrids, setOneLineForScope],
  );
}

export { UiModeStoreContext };
