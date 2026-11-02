import type { UIControl, UIRow, UITree } from '../types/ui';

type ConfigureIcon = { included: boolean; itemId: string };
type WithIcon = { configureIcon?: ConfigureIcon };

/** map che restituisce lo STESSO array se nessun elemento e' cambiato. */
function mapSame<T>(items: T[], fn: (item: T) => T): T[] {
  let changed = false;
  const out = items.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}

/**
 * Gira il pallino di "Configura campi" di un solo elemento dopo un ToggleItem,
 * senza far ridisegnare la vista al server.
 *
 * Lo stesso elemento puo' stare in piu' punti dell'albero, e vanno girati tutti:
 * - `control`: i campi;
 * - `cell.rows`: i campi delle viste incorporate, dove sta quasi tutto un dettaglio
 *   (SXADV-5777.1);
 * - `control.tabs` e `control.contentRows`: le linguette e il contenuto del tab;
 * - `headers` e `continuationHeaders`, del controllo o della pagina: le colonne di
 *   una lista, comprese quelle delle bande successive (SXADV-5777.2);
 * - `control.buttons`: i pulsanti di una ButtonBar;
 * - `control.rows`: il contenuto di una vista incorporata, che ViewRenderer preferisce
 *   a `contentRows`;
 * - `panelTemplate` (del controllo o della pagina): il pannello di riga di una lista.
 *
 * Restituisce lo stesso oggetto se l'elemento non c'e' e copie solo lungo il
 * percorso toccato.
 */
export function applyToggleItem(ui: UITree, itemId: string, included: boolean): UITree {
  const flip = <T extends WithIcon>(node: T): T =>
    node.configureIcon?.itemId === itemId && node.configureIcon.included !== included
      ? { ...node, configureIcon: { ...node.configureIcon, included } }
      : node;

  const visitBands = (bands: WithIcon[][]): WithIcon[][] =>
    mapSame(bands, (band) => mapSame(band, flip));

  const visitControl = (ctl: UIControl): UIControl => {
    let next = flip(ctl);
    if (ctl.tabs) {
      const tabs = mapSame(ctl.tabs, flip);
      if (tabs !== ctl.tabs) next = { ...next, tabs };
    }
    if (ctl.contentRows) {
      const contentRows = mapSame(ctl.contentRows, visitRow);
      if (contentRows !== ctl.contentRows) next = { ...next, contentRows };
    }
    const { headers, continuationHeaders, buttons, rows, panelTemplate } = ctl as unknown as {
      headers?: WithIcon[];
      continuationHeaders?: WithIcon[][];
      buttons?: UIControl[];
      rows?: UIRow[];
      panelTemplate?: { rows?: UIRow[] };
    };
    if (Array.isArray(rows)) {
      const r = mapSame(rows, visitRow);
      if (r !== rows) next = { ...next, rows: r } as unknown as UIControl;
    }
    const panel = visitPanel(panelTemplate);
    if (panel !== panelTemplate) next = { ...next, panelTemplate: panel } as UIControl;
    if (Array.isArray(headers)) {
      const h = mapSame(headers, flip);
      if (h !== headers) next = { ...next, headers: h } as UIControl;
    }
    if (Array.isArray(continuationHeaders)) {
      const c = visitBands(continuationHeaders);
      if (c !== continuationHeaders) next = { ...next, continuationHeaders: c } as UIControl;
    }
    if (Array.isArray(buttons)) {
      const b = mapSame(buttons, visitControl);
      if (b !== buttons) next = { ...next, buttons: b } as UIControl;
    }
    return next;
  };

  function visitPanel<T extends { rows?: UIRow[] } | undefined>(panel: T): T {
    if (!panel?.rows) return panel;
    const rows = mapSame(panel.rows, visitRow);
    return rows === panel.rows ? panel : { ...panel, rows };
  }

  function visitRow(row: UIRow): UIRow {
    // `rows` non e' sempre una griglia: un controllo personalizzato puo' metterci
    // i suoi dati (CdmsClassUIControl), e qui si passa anche da li'.
    if (!Array.isArray(row?.cells)) return row;
    const cells = mapSame(row.cells, (cell) => {
      let out = cell;
      if (cell.control) {
        const control = visitControl(cell.control);
        if (control !== cell.control) out = { ...out, control };
      }
      if (cell.rows) {
        const rows = mapSame(cell.rows, visitRow);
        if (rows !== cell.rows) out = { ...out, rows };
      }
      return out;
    });
    return cells === row.cells ? row : { ...row, cells };
  }

  const rows = mapSame(ui.rows, visitRow);
  const headers = ui.headers ? mapSame(ui.headers, flip) : ui.headers;
  const pagePanel = (ui as { panelTemplate?: { rows?: UIRow[] } }).panelTemplate;
  const panelTemplate = visitPanel(pagePanel);
  const continuationHeaders = ui.continuationHeaders
    ? (visitBands(ui.continuationHeaders) as typeof ui.continuationHeaders)
    : ui.continuationHeaders;
  if (rows === ui.rows && headers === ui.headers && panelTemplate === pagePanel
    && continuationHeaders === ui.continuationHeaders) return ui;
  const out: UITree = { ...ui, rows, headers, continuationHeaders };
  return panelTemplate === pagePanel ? out : ({ ...out, panelTemplate } as UITree);
}

/**
 * Il dettaglio accanto a un albero vive nello stato locale di TreeRenderer, non
 * nell'albero della scheda: chi tiene una copia della vista si iscrive qui.
 */
type ToggleListener = (itemId: string, included: boolean) => void;
const toggleListeners = new Set<ToggleListener>();

export function subscribeToggleItem(fn: ToggleListener): () => void {
  toggleListeners.add(fn);
  return () => { toggleListeners.delete(fn); };
}

export function notifyToggleItem(itemId: string, included: boolean): void {
  toggleListeners.forEach((fn) => fn(itemId, included));
}
