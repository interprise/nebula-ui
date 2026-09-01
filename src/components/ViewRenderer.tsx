import React, { useCallback, useRef } from 'react';
import { fixServerHtml } from '../services/serverHtml';
import { Button, Tabs, Tooltip } from 'antd';
import { BookOutlined, CheckCircleFilled, CloseCircleFilled, CompressOutlined, ExpandOutlined } from '@ant-design/icons';
import type { UITree, UIRow, UICell, UIControl, ListRecord, RowEditData, ToolbarItem } from '../types/ui';
import { hydrate } from '../services/hydrate';
import { putPanelTemplate, getPanelTemplate } from '../services/templateCache';
import {
  ELTYPE_PROMPT,
  ELTYPE_CONTENT,
  ELTYPE_SECTION_HEADER,
  ELTYPE_SELECTOR,
  ELTYPE_FILLER,
  ELTYPE_CONTAINER,
} from '../types/ui';
import ControlRenderer from '../controls/ControlRenderer';
import { comboWidthForSize, fieldWidthForSize, moneyWidthForSize, numberWidthForSize } from '../controls/helpers';
import { useUiMode, UiModeStoreContext, ZoomScopeContext, PANEL_ZOOM_ID } from '../hooks/uiMode';
import { useDensity, DENSITY_FONT_SIZE, type Density } from '../hooks/density';
import { useHotkey, HotkeyPriority } from '../hooks/hotkeys';
import { DataVersionContext, useNestedDataVersion } from '../controls/dataVersion';
import ListRenderer from './ListRenderer';
import EditPanel from './EditPanel';
import TreeRenderer from './TreeRenderer';
import { viewHasOlapCube } from './olap/detect';

/** Shows horizontal scrollbar only when mouse is near the bottom edge */
const SCROLL_REVEAL_ZONE = 25; // pixels from bottom edge
function useEdgeScrollReveal() {
  // Niente ref: l'elemento da decorare e' quello a cui i due gestori sono
  // attaccati, cioe' il `currentTarget` dell'evento. Tenerlo in una ref
  // obbligava a passarla con `ref=` durante il render, e una funzione che legge
  // una ref "sporca" tutto l'oggetto restituito dall'hook: il compilatore React
  // non distingue una ref letta in un gestore di eventi (legittima) da una
  // letta durante il render, e segnalava ogni uso di questi tre valori.
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const distFromBottom = el.getBoundingClientRect().bottom - e.clientY;
    el.classList.toggle('scrollbar-visible', distFromBottom <= SCROLL_REVEAL_ZONE);
  }, []);
  const onMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('scrollbar-visible');
  }, []);
  return { onMouseMove, onMouseLeave };
}

/* Layout-table ruler sizing (SXADV-5742.1) ---------------------------------- */

/** One server grid column, when the ruler can't be fitted to the visible width
 *  (no measurement yet, or a table without a label band). Legacy HTML billed a
 *  column at ~charWidth * gridSize — typically 24–30px. */
const DEFAULT_COL_WIDTH = 24;
/** Pavimento assoluto: sotto questa larghezza per colonna non si scende mai,
 *  qualunque cosa dica il calcolo (una tabella senza controlli incomprimibili
 *  non ha comunque motivo di stringersi oltre). */
const MIN_CONTENT_COL = 19;
/** Padding orizzontale di `.content-cell` (4px per lato): non è spazio
 *  disponibile per il controllo, e va scontato prima di confrontare la
 *  larghezza della cella con quella che il controllo pretende. */
const CONTENT_CELL_PADDING = 8;

/** Larghezza INCOMPRIMIBILE di un controllo, in px — quella che il controllo si
 *  impone da sé e che la cella non può negoziare. Un `<input>` di testo è
 *  `width:100%` e si adatta alla cella, quindi qui vale 0: al più gli si taglia
 *  il testo dentro, che è recuperabile scorrendo. Un Select antd no — o è
 *  fissato alla larghezza derivata dal `size` (vedi ComboControl) o porta un
 *  `min-width` di 160px — e lo stesso vale per i DatePicker. Se la cella è più
 *  stretta, `overflow:hidden` di `.content-cell` taglia il bordo destro e la
 *  freccia della tendina, e il campo diventa inapribile: è SXADV-5677. */
function controlHardWidth(control: UIControl): number {
  switch (control.type) {
    case 'combo':
    case 'multiselect':
      // Mirror di getTextMaxWidth + della regola di ComboControl. La larghezza
      // dal `size` si chiede al controllo stesso: e' misurata sul corpo scelto
      // dall'utente, non su una costante (SXADV-5796).
      return control.size != null ? comboWidthForSize(control.size) : 160;
    case 'workflowStatus':
    case 'bpmStatus':
      return 160;
    case 'date':
      return 96;
    case 'time':
      return 95;
    case 'timestamp':
      return 170;
    default:
      return 0;
  }
}

/** Larghezza che un controllo vorrebbe per mostrare il proprio contenuto per
 *  intero — non incomprimibile come {@link controlHardWidth}, ma nemmeno zero:
 *  un `<input>` che si adatta alla cella, se la cella e' piu' stretta del
 *  `size` dichiarato, il testo lo TAGLIA (`.content-cell` ha
 *  `overflow:hidden`), e le ultime lettere non si recuperano scorrendo perche'
 *  a scorrere e' la tabella, non il campo. Serve a decidere quanto larga fare
 *  la colonna quando la tabella scorre comunque (vedi `contentColFloor`). */
function controlContentWidth(control: UIControl): number {
  const hard = controlHardWidth(control);
  if (hard) return hard;
  switch (control.type) {
    case 'text':
    case 'password':
    case 'durata':
      return control.size != null ? fieldWidthForSize(control.size) : 0;
    case 'number':
      return control.size != null ? numberWidthForSize(control.size) : 0;
    case 'money':
      // Mirror di MoneyControl: oltre al campo c'e' l'etichetta della valuta,
      // che sta FUORI dal riquadro e vuole la sua parte di colonna (5653.3).
      return control.size != null ? moneyWidthForSize(control.size) : 0;
    default:
      return 0;
  }
}
/** The prompt cell's own horizontal padding (`.prompt-cell`: 4px each side) plus
 *  a couple of pixels of air, so the longest label still fits on one line. */
const PROMPT_CELL_PADDING = 10;
/** Kept free so a table sized to the host doesn't itself trigger the scrollbar. */
const RULER_GUTTER = 8;

const RULER_FONT_FAMILY = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Il carattere con cui la layout-table disegnera' davvero le etichette. Il
 *  corpo non e' piu' inchiodato a 13px: lo sceglie l'utente (SXADV-5745), e un
 *  righello che misura con un corpo diverso da quello disegnato sbaglia la
 *  banda delle etichette proprio nel preset compatto, dove lo spazio conta di
 *  piu'. Il valore arriva da `DENSITY_FONT_SIZE`, che tiene il passo con
 *  `--app-font-size` in tokens.css — come `GRID_ROW_HEIGHT` fa con
 *  `--ag-row-height`. */
function layoutTableFont(density: Density): string {
  return `${DENSITY_FONT_SIZE[density]}px ${RULER_FONT_FAMILY}`;
}

/** Width of a prompt's text at the layout table's own font. Uses a canvas so it
 *  can run inside a useMemo — no DOM node, no reflow. Il chiamante misura il
 *  font una volta per passata e lo passa qui: `getComputedStyle` per ogni
 *  etichetta costerebbe un reflow a testa. A mismatch only costs a few pixels,
 *  which PROMPT_BAND_SLACK absorbs, and the prompt cell wraps rather than
 *  clipping if it ever came out short. */
const measurePromptWidth = (() => {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (promptHtml: string, font: string): number => {
    const text = promptHtml.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    if (!text) return 0;
    if (ctx === undefined) ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * 7;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
})();


/** Larghezza UTILE del contenitore di una tabella: il suo box di contenuto, non
 *  `clientWidth`, che il padding lo comprende. `.tab-content` ne ha 8px per
 *  lato: dimensionare il righello su clientWidth produceva una tabella 16px
 *  piu' larga dello spazio disponibile e quindi una barra di scorrimento
 *  orizzontale per 8 pixel (SXADV-5809). Il ResizeObserver riceve gia' il box
 *  di contenuto in `contentRect`; questa serve per la prima misura e come
 *  ripiego. */
function hostContentWidth(host: HTMLElement): number {
  const cs = getComputedStyle(host);
  return host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}
/** Il righello di UNA tabella: le colonne che il server ha dichiarato, fittate
 *  alla larghezza visibile di quella tabella.
 *
 *  Estratto dal corpo di `ViewRenderer` perche' nel layout split le tabelle
 *  sono DUE — il form in alto e il contenuto del tab in basso — e fino a
 *  SXADV-5809 la seconda riusava il righello della prima. Le due tabelle pero'
 *  contengono righe diverse: la banda delle etichette calcolata su "Codice:" e
 *  "Valido dal:" della testata e' meta' di quella che "Codice Attivita' 2025
 *  Primaria" pretende nel tab, e le colonne di contenuto dichiarate per una
 *  testata da 90 colonne (2094px) finivano in un tab largo 1210px, dove il
 *  browser le riscalava in proporzione — banda a 12px per colonna, coda a
 *  10px. Ogni tabella misura ora le PROPRIE righe. */
interface LayoutRuler {
  /** Colonne del righello: quelle delle sole righe di form (vedi `formCols`),
   *  o il totale dichiarato dal server quando non ce ne sono. */
  totalCols: number;
  /** Colonne delle righe di FORM, `undefined` se la tabella non ne ha. E' anche
   *  il colspan con cui si disegnano i separatori di sezione. */
  formCols: number | undefined;
  promptBandCols: number;
  promptBandWidth: number;
  contentColWidth: number;
  tableWidth: number;
  fitRuler: boolean;
  /** La larghezza che entrerebbe e' sotto il pavimento preteso dai controlli:
   *  la tabella non si stringe, tiene le colonne e scorre (SXADV-5677). */
  overflows: boolean;
  /** Griglie, tab annidati, cubi: scorrono gia' per conto loro, e allargare la
   *  tabella oltre il contenitore rimetterebbe in campo la seconda barra di
   *  scorrimento (SXADV-5450). */
  hostsAutonomousContent: boolean;
}

function buildRuler(rows: UIRow[], hostWidth: number, density: Density, totalColsHint?: number, totalWidthHint?: number): LayoutRuler {
  // Compute actual column count from form rows only (exclude container/section-header rows
  // whose colspans include child sub-views and inflate the auto-layout table)
  const formCols = (() => {
    let max = 0;
    for (const row of rows) {
      let sum = 0;
      let isFormRow = false;
      for (const cell of row.cells) {
        // Bars are autonomous flex-wrap containers (like grids): they take
        // whatever width is available and wrap their items. Their declared
        // colspan — e.g. the anagrafica links ButtonBar's size="120" — must
        // not inflate the ruler width, or the table gets a huge minWidth and
        // the bar (as wide as its cell) never wraps, silently pushing
        // trailing links off-screen (5450.1C).
        const ctlType = cell.control?.type;
        if (ctlType === 'buttonBar' || ctlType === 'actionBar') continue;
        sum += cell.colspan || 1;
        if (cell.elementType === ELTYPE_PROMPT || cell.elementType === ELTYPE_CONTENT || cell.elementType === ELTYPE_SELECTOR) {
          isFormRow = true;
        }
      }
      if (isFormRow && sum > max) max = sum;
    }
    return max || undefined;
  })();

  // Ruler columns. Use formCols (form rows only) not ui.totalCols — grids render
  // outside the table and don't constrain the ruler.
  const totalCols = formCols || totalColsHint || 0;

  // The label band is the run of leading columns every prompt cell shares. Its
  // width is a property of the LONGEST LABEL, not of the server's column count:
  // billed at the uniform 24px/column it came out ~240px wide against ~180px of
  // actual text, and since prompts are right-aligned all that slack piled up on
  // the left as dead space while the fields it pushed rightwards ran off the
  // edge of the screen (SXADV-5742.1).
  let promptBandCols = 0;
  for (const row of rows) {
    const first = row.cells[0];
    if (first && first.elementType === ELTYPE_PROMPT) promptBandCols = Math.max(promptBandCols, first.colspan || 1);
  }

  // Sized PER COLUMN, not per band: prompt cells don't all span the same number
  // of columns, so a band merely wide enough for the longest label leaves the
  // rows with a shorter colspan too narrow and wraps them anyway. What every row
  // shares is the column, so the requirement each label imposes is
  // (its width / its colspan) and the band is the largest of those, times the
  // widest prompt colspan in the view.
  //
  // Rimisurato quando cambia la densita': il corpo del carattere e' cambiato e
  // con lui la larghezza che ogni etichetta pretende.
  let promptBandWidth = 0;
  if (promptBandCols) {
    const font = layoutTableFont(density);
    let perCol = 0;
    for (const row of rows) {
      const first = row.cells[0];
      if (!first || first.elementType !== ELTYPE_PROMPT || !first.prompt) continue;
      const span = first.colspan || 1;
      perCol = Math.max(perCol, (measurePromptWidth(first.prompt, font) + PROMPT_CELL_PADDING) / span);
    }
    promptBandWidth = perCol ? Math.ceil(perCol * promptBandCols) : 0;
  }

  // Pavimento delle colonne di contenuto, derivato dai controlli che questa
  // tabella contiene davvero e non da una costante: ogni cella con un controllo
  // incomprimibile pretende (larghezza + padding) / colspan px per colonna, e la
  // tabella non può scendere sotto la più esigente senza tagliarlo.
  // Il tetto è DEFAULT_COL_WIDTH, la colonna del layout legacy: oltre non si
  // sale, altrimenti una singola tendina in una cella colspan=1 (168px per
  // colonna) gonfierebbe l'intera tabella per compiacere un campo solo.
  //
  // Si calcolano due pavimenti dalla stessa passata sulle celle:
  //  - `contentColFloor`, dai controlli INCOMPRIMIBILI: e' quello che decide se
  //    la tabella scorre, ed e' la regola invariata di 5677;
  //  - `contentColWish`, che tiene conto anche dei campi di testo, che si
  //    adattano alla cella ma il cui contenuto viene TAGLIATO quando la cella
  //    e' piu' stretta del `size` dichiarato (SXADV-5796).
  // Il secondo si usa solo quando il primo ha gia' deciso che la tabella
  // scorre: allargare le colonne di una tabella che scorre comunque non costa
  // niente — nessuna barra in piu' — e restituisce i caratteri tagliati. Se
  // invece la tabella entra, si tiene la larghezza che la fa entrare, e un
  // campo stretto resta il prezzo di non avere la barra orizzontale.
  const { contentColFloor, contentColWish } = (() => {
    let hardNeed = 0;
    let wishNeed = 0;
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.elementType !== ELTYPE_CONTENT || !cell.control) continue;
        const span = cell.colspan || 1;
        const hard = controlHardWidth(cell.control);
        if (hard) hardNeed = Math.max(hardNeed, (hard + CONTENT_CELL_PADDING) / span);
        const wish = controlContentWidth(cell.control);
        if (wish) wishNeed = Math.max(wishNeed, (wish + CONTENT_CELL_PADDING) / span);
      }
    }
    const clamp = (n: number) =>
      Math.max(MIN_CONTENT_COL, Math.min(DEFAULT_COL_WIDTH, Math.ceil(n)));
    return { contentColFloor: clamp(hardNeed), contentColWish: clamp(wishNeed) };
  })();

  // What's left of the visible width goes to the content columns, in the
  // proportions the server declared (colspans), so the form fills the editing
  // area instead of overflowing it.
  //
  // Stringere sotto il pavimento NON si fa (SXADV-5677): il righello a larghezza
  // visibile serve a togliere la scrollbar orizzontale, ma su una view molto
  // larga — Fatture ha 86 colonne server, Anagrafica Unica 90 — la scrollbar
  // resta comunque, e la stretta si è pagata solo in campi tagliati. Quando la
  // larghezza che entrerebbe è sotto il pavimento la tabella torna quindi alle
  // colonne che i suoi controlli chiedono e scorre, come faceva il legacy.
  const contentCols = totalCols - promptBandCols;
  const fitRuler = hostWidth > 0 && promptBandWidth > 0 && contentCols > 0;
  const fittedColWidth = fitRuler
    ? (hostWidth - promptBandWidth - RULER_GUTTER) / contentCols
    : 0;
  const contentColWidth = fitRuler
    ? (fittedColWidth >= contentColFloor ? fittedColWidth : contentColWish)
    : DEFAULT_COL_WIDTH;

  // Fallback (no measurement yet, or a table with no prompt band): the previous
  // uniform grid. Each formCol is one server grid column, ~charWidth * gridSize
  // px on the legacy HTML layout — typically 24–30px.
  const uniformWidth = formCols ? formCols * DEFAULT_COL_WIDTH : (totalWidthHint || 0);
  const tableWidth = fitRuler
    ? Math.round(promptBandWidth + contentCols * contentColWidth)
    : uniformWidth;

  const hostsAutonomousContent = viewHasOlapCube({ rows } as UITree) || rows.some((row) =>
    row.cells.some((cell) => {
      const t = cell.control?.type;
      return t === 'tab' || t === 'detailView' || t === 'embeddedView';
    }),
  );

  return {
    totalCols, formCols, promptBandCols, promptBandWidth, contentColWidth, tableWidth,
    fitRuler, overflows: fitRuler && fittedColWidth < contentColFloor, hostsAutonomousContent,
  };
}

/** Lo stile della tabella che porta questo righello.
 *
 *  Una tabella EMBEDDED (il form aperto dentro un tab) con il solo
 *  `width:100%` è costretta dentro il contenitore, e con `table-layout:fixed`
 *  il browser riscala il righello in proporzione: il pavimento non protegge
 *  più niente e i campi si tagliano lo stesso — è il caso "Tab Indirizzi ->
 *  Nuovo -> Cap" di SXADV-5677. Quando il righello non entra le si dà quindi
 *  un `minWidth`, come alla tabella di pagina: meglio scorrere che tagliare.
 *
 *  MAI però se la tabella ospita contenuti autonomi (griglie, tab annidati):
 *  quelli scorrono già per conto loro, e una tabella più larga del tab
 *  rimetterebbe in campo la seconda barra di scorrimento (SXADV-5450). */
function layoutTableStyle(ruler: LayoutRuler, embedded: boolean | undefined): React.CSSProperties {
  if (!embedded) return { minWidth: ruler.tableWidth || '100%' };
  return ruler.overflows && !ruler.hostsAutonomousContent
    ? { width: '100%', minWidth: ruler.tableWidth }
    : { width: '100%' };
}

/** La riga a altezza zero che fissa le colonne per `table-layout: fixed`. */
function rulerRowFor(ruler: LayoutRuler): React.ReactNode {
  const { totalCols, tableWidth, fitRuler, promptBandCols, promptBandWidth, contentColWidth } = ruler;
  if (!(totalCols > 0 && tableWidth > 0)) return null;
  return (
    <tr style={{ height: 0, lineHeight: 0, fontSize: 0 }}>
      {Array.from({ length: totalCols }, (_, i) => (
        <td
          key={i}
          style={{
            width: fitRuler
              ? (i < promptBandCols ? promptBandWidth / promptBandCols : contentColWidth)
              : tableWidth / totalCols,
            padding: 0,
            border: 'none',
            height: 0,
          }}
        />
      ))}
    </tr>
  );
}

/** Il contenuto di un tab nel layout split, con il righello delle PROPRIE righe.
 *
 *  Le righe del tab vivono nella stessa griglia master della view (i colspan
 *  sono confrontabili), ma la tabella e' un elemento a se': fino a SXADV-5809
 *  riusava il righello della testata, calcolato su etichette e controlli che
 *  in questo tab non ci sono. Su Anagrafica Unica il righello della testata
 *  dichiarava 90 colonne per 2094px dentro un tab da 1210px, e siccome qui la
 *  tabella e' `width:100%` senza `minWidth` il browser lo comprimeva in
 *  proporzione invece di farla scorrere: banda delle etichette a 12px per
 *  colonna (le etichette lunghe andavano a capo) e colonne di coda a 10px.
 *
 *  E' un componente e non un pezzo di JSX perche' ha bisogno di hook suoi: la
 *  larghezza del proprio contenitore, osservata come fa la tabella del form. */
function TabContentTable({ rows, pageType, onAction, onChange, onGridChange }: {
  rows: UIRow[];
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}): React.ReactElement {
  const { density } = useDensity();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [hostWidth, setHostWidth] = React.useState(0);
  React.useEffect(() => {
    const host = tableRef.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect.width;
      setHostWidth(box || hostContentWidth(host));
    });
    ro.observe(host);
    setHostWidth(hostContentWidth(host));
    return () => ro.disconnect();
  }, []);
  const ruler = buildRuler(rows, hostWidth, density);
  return (
    <table ref={tableRef} className="layout-table" style={layoutTableStyle(ruler, true)}>
      <tbody>
        {rulerRowFor(ruler)}
        {rows.map((cRow, cri) => (
          <RowRenderer key={cRow.id || `tc_${cri}`} row={cRow} pageType={pageType} formCols={ruler.formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
        ))}
      </tbody>
    </table>
  );
}

/** Barra dei tab + contenuto del tab di un'area a due zone.
 *
 *  Estratto dal ramo split di `DetailFormView` perche' lo usa anche il tab
 *  ANNIDATO (vedi `NestedTabSplit`): un secondo gruppo di tab dentro il
 *  pannello di un tab deve avere la stessa barra ferma fuori dall'area che
 *  scorre, non una barra che scorre via insieme ai campi.
 *
 *  Il pulsante di ingrandimento lo passa solo il chiamante ESTERNO: e' lo zoom
 *  dell'AREA e ce n'e' uno solo per ambito (`PANEL_ZOOM_ID`), quindi ripeterlo
 *  sulla barra annidata darebbe due pulsanti che fanno la stessa cosa. */
function SplitTabPanel({ control, pageType, showBar, extraRight, onTabChange, onAction, onChange, onGridChange }: {
  control: UIControl;
  pageType?: number;
  /** false mentre lo zoom di una griglia tiene collassato tutto cio' che sta
   *  sopra di essa: li' la barra sparisce con la testata. */
  showBar: boolean;
  extraRight?: React.ReactNode;
  onTabChange?: () => void;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}): React.ReactElement {
  const selected = control.tabs?.find((t) => t.selected) ?? control.tabs?.[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      {showBar && (
        <div className="tab-sticky-wrapper">
          <Tabs
            activeKey={selected?.name}
            onChange={(key) => {
              onTabChange?.();
              onAction('ChangeTab', { navpath: control.navpath as string, option1: control.controlName as string, option2: key });
            }}
            items={(control.tabs || []).map((tab) => ({
              key: tab.name,
              label: renderTabLabel(tab, onAction),
            }))}
            tabBarExtraContent={extraRight ? { right: extraRight } : undefined}
          />
        </div>
      )}
      {control.contentRows && (
        <InTabPanelContext.Provider value={true}>
        <div className="tab-content view-body-embedded" style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Same as the non-split tab path: the tab label names this content, so
              a heading repeating it is dropped (TabLabelContext). */}
          <TabLabelContext.Provider value={selected?.prompt}>
            <TabContentBody
              rows={control.contentRows as UIRow[]}
              pageType={pageType}
              onAction={onAction}
              onChange={onChange}
              onGridChange={onGridChange}
            />
          </TabLabelContext.Provider>
        </div>
        </InTabPanelContext.Provider>
      )}
    </div>
  );
}

/** Righe di campi seguite, in coda, da un controllo Tab: la forma di una vista
 *  che dentro un tab ne apre altri (SXADV-5812). `null` se manca uno dei due
 *  pezzi — un wrapper fatto del solo Tab non ha campi da cui staccare la barra,
 *  e una vista che finisce con una griglia non e' questo caso. */
function nestedTabSplit(rows: UIRow[]): { formRows: UIRow[]; bottomRows: UIRow[] } | null {
  let splitIdx = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (isBottomPanelRow(rows[i])) splitIdx = i;
    else if (!isRowVisible(rows[i])) continue; // una riga nascosta in coda non chiude la corsa
    else break;
  }
  if (splitIdx <= 0 || splitIdx >= rows.length) return null;
  const bottomRows = rows.slice(splitIdx);
  if (!bottomRows.some((r) => r.cells.some((c) => c.control?.type === 'tab'))) return null;
  const formRows = rows.slice(0, splitIdx);
  if (!formRows.some(isRowVisible)) return null;
  return { formRows, bottomRows };
}

/** Quanto puo' prendersi, al massimo, l'area dei campi di un tab annidato prima
 *  di mettersi a scorrere: meta' dell'altezza, cosi' i sotto-tab non nascono
 *  gia' schiacciati. Sotto quella soglia i campi occupano la loro altezza vera
 *  e il resto va tutto ai sotto-tab. */
const NESTED_FORM_MAX_PCT = 50;

/** Un tab dentro il pannello di un tab (SXADV-5812).
 *
 *  In `anVrAttivitaDetail` ("Attivita'" dell'Anagrafica Unica), in
 *  `articoliVariantiDistinta` e in un'altra dozzina di viste il contenuto di un
 *  tab e' una manciata di campi e, in coda, un SECONDO controllo Tab. CORE
 *  appiattisce la vista embedded di un tab nelle righe del tab stesso
 *  (EmbeddedViewUIControl le rende "attraverso il layout del padre"), quindi
 *  quei sotto-tab arrivano qui come una riga come le altre e finiscono resi in
 *  linea, DOPO i campi e dentro la stessa area che scorre: la barra scorre via
 *  con loro, e i sotto-tab — che in React l'utente si aspetta fermi e sempre
 *  visibili, come quelli di pagina — diventano scomodi da compilare.
 *
 *  Qui il contenuto del tab si divide come fa la pagina: i campi in alto in
 *  un'area propria che scorre, i sotto-tab sotto con la barra ferma, e in mezzo
 *  la stessa maniglia di ridimensionamento. Le due zone sono figlie DIRETTE di
 *  `.tab-content`, che e' gia' una colonna flex ad altezza definita, quindi
 *  nessuna misura in pixel. Lasciando la riga del Tab dov'era — nella cella
 *  della layout-table — la catena flex si sarebbe interrotta e sarebbe servito
 *  misurare, come fanno le griglie embedded (`fillCapHeight`). */
const NestedTabSplit: React.FC<{
  formRows: UIRow[];
  bottomRows: UIRow[];
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}> = ({ formRows, bottomRows, pageType, onAction, onChange, onGridChange }) => {
  const [manualPct, setManualPct] = React.useState<number | null>(null);
  const [resizing, setResizing] = React.useState(false);

  const onResizerMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const resizer = e.currentTarget as HTMLElement;
    const container = resizer.parentElement;
    const formEl = resizer.previousElementSibling as HTMLElement | null;
    if (!container || !formEl) return;
    // Altezza del BOX DI CONTENUTO: e' quella contro cui si risolvono le
    // percentuali dei figli, e `.tab-content` di padding ne ha.
    const cs = getComputedStyle(container);
    const height = container.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    if (height <= 0) return;
    // Si parte dall'altezza VERA dell'area campi, non da una percentuale
    // nominale: finche' nessuno ha trascinato quell'area sta al suo contenuto
    // (sotto il tetto), e ripartire dal tetto farebbe saltare la maniglia.
    const startPct = (formEl.getBoundingClientRect().height / height) * 100;
    const startY = e.clientY;
    setResizing(true);
    const onMove = (ev: MouseEvent) => {
      const deltaPct = ((ev.clientY - startY) / height) * 100;
      setManualPct(Math.min(85, Math.max(10, startPct + deltaPct)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return (
    <>
      <div
        className={`view-split-form view-nested-form${resizing ? ' view-split-form--resizing' : ''}`}
        style={manualPct != null
          ? { flex: `0 0 ${manualPct}%`, maxHeight: 'none' }
          : { maxHeight: `${NESTED_FORM_MAX_PCT}%` }}
      >
        <TabContentTable
          rows={formRows}
          pageType={pageType}
          onAction={onAction}
          onChange={onChange}
          onGridChange={onGridChange}
        />
      </div>
      <div
        className="view-split-resizer view-nested-resizer"
        onMouseDown={onResizerMouseDown}
        title="Trascina per ridimensionare"
      />
      <div className="view-split-bottom view-nested-bottom">
        {bottomRows.map((row, ri) => {
          const tabCell = row.cells.find((c) => c.control?.type === 'tab');
          if (tabCell?.control) {
            return (
              <SplitTabPanel
                key={row.id || `ntb_${ri}`}
                control={tabCell.control}
                pageType={pageType}
                showBar
                onAction={onAction}
                onChange={onChange}
                onGridChange={onGridChange}
              />
            );
          }
          return (
            <BottomPanelRow key={row.id || `ntb_${ri}`} row={row} pageType={pageType} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
          );
        })}
      </div>
    </>
  );
};

/** Il contenuto di un tab: una tabella sola, oppure — quando in coda c'e' un
 *  altro Tab — le due zone di `NestedTabSplit`. La scelta sta qui e non dentro
 *  `TabContentTable` perche' quella ha hook suoi (il righello si misura): un
 *  ritorno anticipato al cambio di tab ne cambierebbe l'ordine. Componenti
 *  diversi, invece, React li monta e smonta puliti. */
function TabContentBody({ rows, pageType, onAction, onChange, onGridChange }: {
  rows: UIRow[];
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}): React.ReactElement {
  const split = nestedTabSplit(rows);
  if (!split) {
    return <TabContentTable rows={rows} pageType={pageType} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />;
  }
  return (
    <NestedTabSplit
      formRows={split.formRows}
      bottomRows={split.bottomRows}
      pageType={pageType}
      onAction={onAction}
      onChange={onChange}
      onGridChange={onGridChange}
    />
  );
}

interface ViewRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
  onEditRow?: (navpath: string | null) => void;
  /** When true, this is a nested/embedded view — don't apply the split layout */
  embedded?: boolean;
  /** When true, an embedded list should fill available vertical space with
   *  its own scroll (tab panels), not expand to fit all rows. */
  fillHeight?: boolean;
}

// Remembered testata/rows split, per view and per tab. Shell renders a single
// ViewRenderer per tab with no key, so navigating detail -> back reuses the same
// fiber: plain state would not be "reset", it would be inherited from the view
// just left (the child detail's caret sits in its testata, so coming back the
// parent's rows collapse to 22% and look gone). Keyed like ListRenderer's
// lastSelectedByView so both survive the same navigation (SXADV-5544).
type SplitState = { zone: 'form' | 'bottom' | null; manualPct: number | null };
const splitByView = new Map<string, SplitState>();

// Session ID context — used by remote combos to call the server
export const SidContext = React.createContext<string>('S1');

// The tab toolbar setter, for a renderer that drives a viewstate of its own.
// TreeRenderer loads its right pane with LocateAndNavigate, which makes the
// pane's record the session's current viewstate: the toolbar rendered with the
// TREE is stale from that moment on (its Add still carries the tree's path and
// comes back NoSession), so the pane hands its own toolbar up to the tab.
export const PaneToolbarContext = React.createContext<((toolbar: ToolbarItem[]) => void) | null>(null);

// View path context — used by controls to send navpath with commands
export const PathContext = React.createContext<string | undefined>(undefined);

// The tab's "row being edited" setter (Shell.handleEditRow → editNavpathRef).
// Provided once by Shell so a deeply-embedded listEdit panel can set the edit
// navpath on selection (so Save/reload post navpath = that row) without
// threading the callback through every RowRenderer/renderContainerControl.
export const EditRowContext = React.createContext<((navpath: string | null) => void) | undefined>(undefined);

// "Was the Nuovo/Add toolbar action just dispatched?" — read-and-clear function
// provided by Shell (pendingAddRef). Lets a listEdit/multiEdit list distinguish
// "server just marked a row as the edit path because it was added" from "this
// row happens to always be in the edit path" (true for virtually every row of
// a multiEdit list — see CORE ToolViewState.isInEditPath), so ListRenderer only
// auto-opens the edit panel right after a real Add, never on an ordinary
// load/refresh that happens to touch the same row.
export const PendingAddContext = React.createContext<(() => boolean) | undefined>(undefined);

// Propagates the "fill available vertical space" signal down to embedded
// lists. Set by tab content so nested grids use internal scroll instead of
// AG Grid's autoHeight.
export const FillHeightContext = React.createContext<boolean>(false);

// The Shell is already showing the current view's title as the closing
// (non-clickable) breadcrumb, so the view itself must not repeat it as a heading
// row — that duplicate cost a full row of the editing area (SXADV-5742). A
// context rather than a prop because three different renderers emit the heading
// (ViewRenderer, ListRenderer, TreeRenderer) at varying depths. EMBEDDED views
// ignore it: their title names a section inside the page ("Righe fattura"), not
// the page, so it is not the thing the breadcrumb is showing.
export const TitleInBreadcrumbContext = React.createContext<boolean>(false);

// Label of the tab whose content is being rendered, for the subtree inside it.
// A tab's label already names its content, so a view inside it must not repeat
// that name as a heading. CORE drops the title of a view sitting DIRECTLY in a
// tab (ToolViewState.getTitle, "SPORCO TRUCCO ... dentro ad un Tab", keyed on the
// tab-list view name ending in "Tab"), but the chain is often
// tab → wrapper view → real view: the wrapper is the direct child, so the view
// that actually carries the title is one level too deep and the rule misses it —
// that is why the documents tab showed "Righe fattura" twice
// (docDetailTab → docRigheWrapperDetail → docRigheCliList). This catches the
// repetition wherever it sits in the tab's subtree, by matching the text.
// Deliberately only a DUPLICATE is dropped: a heading that says something the tab
// label doesn't is information, and a wrapper holding two grids keeps both of its
// section titles.
export const TabLabelContext = React.createContext<string | undefined>(undefined);

/** True nel pannello inferiore di una vista a due aree (`.view-split-bottom`).
 *  È lì che lo zoom griglia (SXADV-5737) ha senso: c'è una testata sopra da
 *  collassare, e sono i tab di dettaglio a soffrire dell'alta numerosità righi.
 *  Su una lista a tutta pagina non c'è niente da guadagnare — la vista È la
 *  griglia — e in una vista senza split la griglia sta dentro la tabella di
 *  layout, dove "nascondere il resto" vuol dire nascondere righe di form. */
export const SplitAreaContext = React.createContext<boolean>(false);

/** True per il contenuto di un tab del pannello inferiore. Serve a decidere
 *  DOVE vive il comando di ingrandimento: con una barra tab presente lo porta
 *  lei (ingrandisce l'area e la barra resta, così si continua a cambiare tab),
 *  e la griglia dentro al tab non ripete un secondo pulsante a quaranta pixel
 *  di distanza che fa quasi la stessa cosa. Senza barra tab il pulsante resta
 *  alla griglia, che è l'unico posto dove metterlo (SXADV-5651). */
export const InTabPanelContext = React.createContext<boolean>(false);

/** Normalized comparison against the enclosing tab's label — true when this
 *  heading would just repeat it. */
export function useIsTabLabelEcho(title?: string): boolean {
  const tabLabel = React.useContext(TabLabelContext);
  if (!title || !tabLabel) return false;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
  return norm(title) === norm(tabLabel);
}

// View name context — used only for diagnostics (e.g. unknown-control-type warnings)
export const ViewNameContext = React.createContext<string | undefined>(undefined);

// Live access to the current tab's form-field values. Shell exposes a
// ref-backed getter so consumers (e.g. OlapCubeRenderer) can read the
// latest form snapshot at request time without re-rendering on every
// keystroke. Default is an empty getter for views/tests rendered outside
// the Shell.
export const FormValuesContext = React.createContext<() => Record<string, string | string[]>>(() => ({}));

/** Input-like widgets that always render a visible UI (input/select/
 *  checkbox/textarea) even when disabled or empty — if the server keeps
 *  them editable the cell is kept alive; if read-only they need a value. */
const INPUT_TYPES = new Set<string>([
  'text', 'number', 'money', 'date', 'time', 'timestamp', 'durata',
  'password', 'textarea', 'htmlarea', 'htmlFormat',
  'combo', 'multiselect', 'checkbox', 'boolean',
  'barcode', 'expbuilder',
  'alternateKey', 'colorPalette',
  'toggleVisibilityFilter', 'visibilityFilter',
  // File pickers (FileUploadUIControl / UploadButtonUIControl) are form
  // inputs, not buttons: they render their own chooser button and carry no
  // `prompt` on the descriptor — the label ("Nome File:") lives in the
  // sibling PROMPT cell, since both controls have hasPrompt()==true. Under
  // the BUTTON_TYPES rule (prompt-or-icon required) they produced "no
  // output", so isRowVisible() suppressed the whole row and every
  // "carica da file" screen lost its file chooser (SXADV-5672.1).
  'upload', 'uploadButton',
]);

/** Button-like widgets that render their prompt/icon regardless of value. */
const BUTTON_TYPES = new Set<string>([
  'button', 'action', 'windowButton',
  'navigateView', 'navigateViewButton',
  'add', 'lookup', 'download',
]);

/** Structural composites that always render their scaffolding. */
const STRUCTURAL_TYPES = new Set<string>([
  'actionBar', 'buttonBar', 'tab', 'embeddedView', 'detailView',
  'warning', 'workflowStatus', 'olapCube',
]);

/** Array/object fields whose non-empty presence means the control has
 *  real content to show (custom entrasp + CORE list-ish controls). */
const STRUCTURED_FIELDS = [
  'items', 'files', 'segments', 'options', 'rows', 'contentRows', 'tabs',
  'groups', 'scadenze', 'demands', 'resources', 'cells',
  'contacts', 'variants', 'privileges', 'profiles',
  'vehicles', 'days', 'activities', 'sections', 'assignments',
  'columns', 'listRows', 'forGroup',
] as const;

function hasScalarContent(ctl: UIControl): boolean {
  const v = ctl.value;
  if (v !== undefined && v !== null && v !== '') return true;
  if (ctl.displayValue) return true;
  const bag = ctl as unknown as Record<string, unknown>;
  if (bag.href || bag.src) return true;
  return false;
}

function hasStructuredContent(ctl: UIControl): boolean {
  const bag = ctl as unknown as Record<string, unknown>;
  for (const k of STRUCTURED_FIELDS) {
    const x = bag[k];
    if (Array.isArray(x) ? x.length > 0 : !!x) return true;
  }
  return false;
}

/** A contatti control produces output only when at least one contact carries
 *  displayable content (a name or any phone/mobile/fax/email). The server may
 *  emit a placeholder contact (only flagDefault set, empty name, no numbers)
 *  which legacy rendered as nothing — treat that as empty. */
function contattiHasContent(ctl: UIControl): boolean {
  const contacts = (ctl as unknown as Record<string, unknown>).contacts;
  if (!Array.isArray(contacts) || contacts.length === 0) return false;
  return contacts.some((c) => {
    const o = c as Record<string, unknown>;
    return !!(o.name || o.phone || o.phone2 || o.mobile || o.mobile2
      || o.fax || o.fax2 || o.email || o.email2);
  });
}

/** Will this control actually produce visible output, or is it an empty
 *  shell (span with no text, etc.)? Different control families have
 *  different rules. */
function controlProducesOutput(ctl: UIControl): boolean {
  if (ctl.visible === false) return false;
  const type = ctl.type ?? '';
  if (INPUT_TYPES.has(type)) {
    // A field the server kept visible always renders its labeled widget —
    // empty or not, editable or read-only — exactly as the legacy ExtJS
    // detail did. Fields that must disappear when empty already arrive with
    // visible:false from the server (their isVisible tests the value, e.g.
    // documentoArchDoc.barcode / notaTestata), so a value-based gate here only
    // wrongly swallowed read-only empty fields: on a confirmed (all read-only)
    // document the whole Codice SDI…Tipo bollo block vanished (SXADV-5543).
    return true;
  }
  if (type === 'contatti') {
    // Legacy omits the Contatti block entirely when no contact carries real
    // content; a placeholder contact (empty name, no phone/email) produces no
    // output. Mirror that so an empty Contatti row doesn't linger (SXADV-5543).
    return contattiHasContent(ctl);
  }
  if (BUTTON_TYPES.has(type)) {
    // A button is visible output only if it carries a prompt or an icon.
    // `action`/`command` alone make the click target wired but invisible
    // (e.g. antd Button with no children renders an empty capsule) —
    // those rows must still collapse.
    return !!(ctl.prompt || ctl.icon);
  }
  if (STRUCTURAL_TYPES.has(type)) {
    return true;
  }
  // Display-only (url/html/highlight/hint/path/attachments/imageFormat/
  // popupUrl/...) or app-specific custom: need real content to be worth
  // a row.
  return hasScalarContent(ctl) || !!ctl.prompt || hasStructuredContent(ctl);
}

/** Is there anything in this row worth rendering? The server now emits the
 *  full template on every response (two-phase pipeline) and marks
 *  conditionally-hidden fields with `visible: false` on the cell and/or
 *  `visible: false` on the control. If every content-bearing cell resolves
 *  to hidden OR to empty content (non-editable fields with no value), the
 *  `<tr>` is suppressed so there's no blank gap in the layout — matching
 *  the legacy HTML behavior where invisible/empty cells weren't emitted.
 *
 *  PROMPT cells alone don't justify keeping a row alive — they're labels
 *  for CONTENT cells, so if all CONTENT is hidden the prompts go too. */
function isRowVisible(row: UIRow): boolean {
  return row.cells.some((cell) => {
    if (cell.visible === false) return false;
    switch (cell.elementType) {
      case ELTYPE_PROMPT:
        return false;
      case ELTYPE_CONTENT:
      case ELTYPE_SELECTOR:
      case ELTYPE_CONTAINER:
      case ELTYPE_FILLER: {
        const ctl = cell.control;
        if (!ctl) return false;
        return controlProducesOutput(ctl);
      }
      case ELTYPE_SECTION_HEADER:
        return !!(cell.text || cell.prompt);
      default:
        return true;
    }
  });
}

/** Check if a row contains a tab, embeddedView, or detailView control */
function isBottomPanelRow(row: UIRow): boolean {
  return row.cells.some((cell) => {
    const type = cell.control?.type;
    return type === 'tab' || type === 'embeddedView' || type === 'detailView';
  });
}

/** Check if a row contains an actionBar control */
function isActionBarRow(row: UIRow): boolean {
  return row.cells.some((cell) => cell.control?.type === 'actionBar');
}

/** Inline embedded views (EmbeddedViewUIControl, e.g. anagraficheVrEmbQuery in a
 *  query form) are emitted differently by mode: FULL renders their child fields
 *  as flat sibling rows in the parent form, but METADATA nests them under a
 *  sectionContent container cell carrying `rows` (+ `scope` for hydration). The
 *  renderer only draws top-level rows, so under the always-METADATA query
 *  pipeline the embedded fields silently disappeared on every reload/clear.
 *  hydrate() has already resolved the nested rows (names/values
 *  keyed by scope) — here we just lift them up to the parent stream so they
 *  render inline exactly as FULL mode does. FULL responses carry no such cell,
 *  so this is a no-op there. Recurses for embeds nested inside embeds.
 *
 *  A `content="this"` embedded view at the top of a detail (e.g. the whole
 *  testata of anagraficheUnDetail wrapped in `anagraficheUnTestaDetail`) is
 *  emitted the same way — a lone CONTAINER cell carrying `rows` — but WITHOUT a
 *  `scope` (it binds to the same BO, so its fields live in the parent scope and
 *  hydrate() already filled them via the parent scope). The CONTAINER render
 *  case only draws `cell.control`, so such a control-less container renders a
 *  blank <td> and the entire testata vanished (SXADV-5487). Lift these too:
 *  match any lone cell that nests `rows` and has no control of its own. */
function flattenInlineEmbeds(rows: UIRow[]): UIRow[] {
  let changed = false;
  const out: UIRow[] = [];
  for (const row of rows) {
    const embed = row.cells.find((c) => Array.isArray(c.rows) && (c.scope != null || c.control == null));
    if (embed && row.cells.length === 1 && embed.rows) {
      // A conditionally-hidden embedded view still ships its full template
      // with visible:false on the container cell (hydrate() has resolved it).
      // Lifting its inner rows regardless of that flag rendered the block
      // anyway: e.g. documentiDetail carries two anagraficheIndirizzo embeds
      // (indCliente + indFornitori); on a sales invoice only the first is
      // visible, but both were lifted so the customer address showed twice
      // (SXADV-5543). Drop the hidden one — don't lift its rows.
      if (embed.visible !== false) out.push(...flattenInlineEmbeds(embed.rows));
      changed = true;
    } else {
      out.push(row);
    }
  }
  return changed ? out : rows;
}

/** Build a tab label node, adding a configure icon when configuring mode is active */
function renderTabLabel(
  tab: { prompt: string; configureIcon?: { included: boolean; itemId: string } },
  onAction: (action: string, params?: Record<string, string>) => void,
): React.ReactNode {
  if (!tab.configureIcon) return tab.prompt;
  const ci = tab.configureIcon;
  const Icon = ci.included ? CheckCircleFilled : CloseCircleFilled;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {tab.prompt}
      <Icon
        className={`configure-icon ${ci.included ? 'configure-on' : 'configure-off'}`}
        title={ci.included ? 'Tab incluso - clicca per escludere' : 'Tab escluso - clicca per includere'}
        onClick={(e) => {
          e.stopPropagation();
          onAction('ToggleItem', { navpath: ci.itemId });
        }}
      />
    </span>
  );
}

/**
 * A listEdit list is rendered read-only in AG Grid; editing happens in a bottom
 * EditPanel. INSTANT: the list ships a cacheable panel FORM template
 * (`ui.panelTemplate`) plus per-record edit data (`row.editData`); selecting a
 * record hydrates the panel client-side — no Post round-trip. The panel edits
 * the record in the stable React tree, where antd controls work (unlike inside
 * AG Grid's remounted full-width rows). Non-editable lists render the grid alone.
 * Own component so its hooks don't sit behind ViewRenderer's early returns.
 */
const ListView: React.FC<ViewRendererProps> = (props) => {
  const { ui, onAction, onChange } = props;
  const consumePendingAdd = React.useContext(PendingAddContext);
  // Field editing always happens in the bottom panel now, multiEdit or not — a
  // multiEdit list additionally keeps its selection checkbox interactive in-grid
  // (ListRenderer handles that separately) and its page-wide post for bulk
  // listActions/Save (see CORE ToolViewState.postData/postChildren: a
  // row-targeted navpath posts just that row, a bare navpath keeps the
  // page-wide walk).
  const isListEdit = !!ui.listEdit;
  // From context (not props): embedded lists are rendered by renderContainerControl,
  // which doesn't thread onEditRow through. Shell provides it once at the top.
  const setEditRow = React.useContext(EditRowContext);
  const [hidden, setHidden] = React.useState(false);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const [records, setRecords] = React.useState<ListRecord[]>([]);

  const recordPaths = React.useMemo(() => records.map((r) => r.path), [records]);
  const editDataByPath = React.useMemo(() => {
    const m = new Map<string, RowEditData | undefined>();
    for (const r of records) m.set(r.path, r.editData);
    return m;
  }, [records]);

  const onSelectRecord = React.useCallback((path: string) => {
    setHidden(false);
    setSelectedPath(path);
    // Set the tab's edit navpath so Save/reload post with navpath = this row —
    // without it the server has no edit path and drops the row's field edits
    // (Shell.handleAction injects editNavpathRef as navpath when omitted).
    setEditRow?.(path);
    // INSTANT: no Post — the panel hydrates from the row's onboard editData.
  }, [setEditRow]);

  // The panel's Elimina follows the SELECTED record: the right to delete is a
  // per-row property (deletable="?expr" evaluated on the row's BO, the BO's own
  // workflow rules), which is why the server sends it per row. Undefined from a
  // server that predates it — EditPanel then falls back to the grid-wide flag.
  const selectedCanDelete = React.useMemo(
    () => (selectedPath ? records.find((r) => r.path === selectedPath)?.canDelete : undefined),
    [records, selectedPath],
  );

  // Selezione appesa nel vuoto: se la riga selezionata non e' piu' fra quelle
  // della lista (cancellata, oppure sparita per un Refresh/una ricerca), si
  // azzera anche il navpath di riga — altrimenti resterebbe puntato a un record
  // che non c'e' piu' e i post successivi (Salva, ricarica di un campo) lo
  // manderebbero al server. Rete di sicurezza: la cancellazione dal pannello
  // chiude gia' il pannello da sola.
  React.useEffect(() => {
    if (selectedPath && records.length > 0 && !recordPaths.includes(selectedPath)) {
      setSelectedPath(null);
      setEditRow?.(null);
    }
  }, [recordPaths, records.length, selectedPath, setEditRow]);

  // Step to the previous/next record from the panel — pure client-side reselection.
  const currentIndex = selectedPath ? recordPaths.indexOf(selectedPath) : -1;
  const navigateRecord = React.useCallback((delta: number) => {
    setSelectedPath((cur) => {
      const idx = cur ? recordPaths.indexOf(cur) : -1;
      const next = idx >= 0 ? recordPaths[idx + delta] : undefined;
      if (next) { setEditRow?.(next); return next; }
      return cur;
    });
  }, [recordPaths, setEditRow]);

  // The panel FORM template is cacheable (sid-free, keyed by panelTemplateKey).
  // The server ships it once and omits it on later list renders (advertised via
  // the panelKeys request param) to save payload — cache it when present, reuse
  // the cached copy when the response carries only the key.
  React.useEffect(() => {
    if (ui.panelTemplate && ui.panelTemplateKey) putPanelTemplate(ui.panelTemplateKey, ui.panelTemplate);
  }, [ui.panelTemplate, ui.panelTemplateKey]);

  // Hydrate the cached panel FORM template with the selected record's edit data.
  // scopePaths root ("") is overridden with the selected row's path so nav/reload
  // descriptors and the wire-form composition target this record.
  const panelTemplate = ui.panelTemplate ?? (ui.panelTemplateKey ? getPanelTemplate(ui.panelTemplateKey) : undefined);
  const hydratedPanel = React.useMemo<UITree | null>(() => {
    if (!panelTemplate || !selectedPath) return null;
    const editData = editDataByPath.get(selectedPath);
    if (!editData) return null;
    const scopePaths = { ...(panelTemplate.scopePaths ?? {}), '': selectedPath };
    return hydrate(
      { rows: panelTemplate.rows } as UITree,
      editData.values, editData.dynProps, panelTemplate.bindings, scopePaths,
    );
  }, [panelTemplate, selectedPath, editDataByPath]);
  // The panel is hydrated client-side, so the tab's dataVersion doesn't move
  // when the user picks another record: compose it with the panel tree's own
  // version so the panel's fields adopt the newly selected record's values
  // even where they match what the user had typed on the previous one.
  const panelDataVersion = useNestedDataVersion(hydratedPanel);

  // The panel is stacked in-flow BELOW the grid (not an overlay), so the grid
  // stays fully visible above it. Only wrap in the flex split when the panel
  // actually shows — otherwise render the grid alone so its height context is
  // unchanged. `panelShown` tells the grid to re-measure the height it fills, so
  // it gives up exactly the panel's space and takes it back when the panel closes.
  const showPanel = isListEdit && !hidden && !!hydratedPanel;
  return (
    <>
      <ListRenderer
        ui={ui}
        onAction={onAction}
        onChange={onChange}
        onGridChange={props.onGridChange}
        onEditRow={props.onEditRow}
        onSelectRecord={isListEdit ? onSelectRecord : undefined}
        onRecordPaths={isListEdit ? setRecords : undefined}
        pendingAdd={isListEdit ? consumePendingAdd : undefined}
        embedded={props.embedded}
        panelShown={showPanel}
      />
      {showPanel && hydratedPanel && (
        <DataVersionContext.Provider value={panelDataVersion}>
        <EditPanel
          panel={hydratedPanel}
          listUi={ui}
          rowPath={selectedPath ?? undefined}
          canDelete={selectedCanDelete}
          onChange={onChange}
          onAction={onAction}
          onClose={() => { setHidden(true); setEditRow?.(null); }}
          onNavigate={navigateRecord}
          hasPrev={currentIndex > 0}
          hasNext={currentIndex >= 0 && currentIndex < recordPaths.length - 1}
        />
        </DataVersionContext.Provider>
      )}
    </>
  );
};

/** Rete di sicurezza per lo zoom griglia: se lo zoom è acceso ma nessuna griglia
 *  lo rivendica — può capitare tornando indietro su un tab diverso da quello
 *  zoomato — non c'è pulsante da premere né Esc registrata dalla griglia, e la
 *  testata resterebbe collassata con la barra dei tab nascosta e nessun modo di
 *  riaprirla. Componente separato, montato solo quando lo zoom è acceso, così i
 *  suoi hook non pesano sul conteggio di ViewRenderer. Priorità più bassa della
 *  griglia, che quando c'è deve vincere lei. */
const ZoomEscapeFallback: React.FC = () => {
  const { setZoomedGridId } = useUiMode();
  useHotkey('Escape', () => setZoomedGridId(null), { priority: HotkeyPriority.gridZoomFallback });
  return null;
};

const ViewRenderer: React.FC<ViewRendererProps> = ({ ui, onAction, onChange, onGridChange, onEditRow, embedded, fillHeight: fillHeightProp }) => {
  const fillHeightCtx = React.useContext(FillHeightContext);
  const fillHeight = fillHeightProp ?? fillHeightCtx;
  if (!ui) return null;

  // Tree views
  if (ui.viewType === 'tree' && ui.treeNodes) {
    return (
      <ViewNameContext.Provider value={ui.viewName}>
      <PathContext.Provider value={ui.path}>
        <TreeRenderer ui={ui} onAction={onAction} onChange={onChange} />
      </PathContext.Provider>
      </ViewNameContext.Provider>
    );
  }

  if (!ui.rows) return null;

  // Lift inline embedded-view fields (nested under sectionContent cells in
  // METADATA mode) up to sibling rows so they render like FULL mode.
  const flatRows = flattenInlineEmbeds(ui.rows);
  if (flatRows !== ui.rows) ui = { ...ui, rows: flatRows };

  const pageType = ui.pageType; // 0=QUERY, 1=LIST, 2=DETAIL
  if (pageType === 1) {
    return (
      <FillHeightContext.Provider value={fillHeight}>
      <ViewNameContext.Provider value={ui.viewName}>
      <PathContext.Provider value={ui.path}>
        <ListView ui={ui} onAction={onAction} onChange={onChange} onGridChange={onGridChange} onEditRow={onEditRow} embedded={embedded} fillHeight={fillHeight} />
      </PathContext.Provider>
      </ViewNameContext.Provider>
      </FillHeightContext.Provider>
    );
  }

  /* Il ramo testata/dettaglio sta in un componente a sé (sotto): è l'unico del
     gruppo a chiamare hook, e ViewRenderer da qui in giù non ne chiama più.
     Prima stavano tutti in questa funzione, sotto i return anticipati, e
     reggevano solo perché i rami che escono prima non ne chiamano NEMMENO uno:
     al primo useRef/useMemo aggiunto qui sopra la pagina diventava bianca
     — "Rendered fewer hooks than expected" — passando da una query alla sua
     lista dei risultati, che stanno sullo stesso fiber (Shell non dà key a
     ViewRenderer). Separati, l'invariante regge da sola: qui si possono
     aggiungere hook, purché sopra i return anticipati. */
  return (
    <DetailFormView
      ui={ui}
      pageType={pageType}
      onAction={onAction}
      onChange={onChange}
      onGridChange={onGridChange}
      embedded={embedded}
      fillHeight={fillHeight}
    />
  );
};

/** Query e dettaglio: la testata a griglia di campi e, sotto, l'eventuale area
 *  a tab. Vedi la nota in ViewRenderer per il motivo per cui è un componente
 *  separato e non un ramo della stessa funzione. */
const DetailFormView: React.FC<Omit<ViewRendererProps, 'onEditRow' | 'fillHeight'> & {
  pageType: number | undefined;
  fillHeight: boolean;
}> = ({ ui, pageType, onAction, onChange, onGridChange, embedded, fillHeight }) => {
  // Suppressed only for the page-level view: an embedded view's title names a
  // section, which the breadcrumb is not showing (see TitleInBreadcrumbContext).
  const titleInBreadcrumb = React.useContext(TitleInBreadcrumbContext) && !embedded;
  // Inside a tab, a heading that just repeats the tab label is dropped.
  const titleEchoesTab = useIsTabLabelEcho(ui.title);
  const splitSid = React.useContext(SidContext);
  /* Zoom su una griglia (SXADV-5737): la vista collassa tutto ciò che sta sopra
     la griglia — testata e barra dei tab — lasciando il pannello inferiore da
     solo. Non è un overlay: stesso nodo DOM, stesso albero React, quindi AG Grid
     non si rimonta e non perde scroll, selezione né riga in editing. L'uscita
     da tastiera sta in `ZoomEscapeFallback`, montato solo quando serve. */
  const zoomStore = React.useContext(UiModeStoreContext);
  const zoomScope = React.useContext(ZoomScopeContext);
  /* Corpo del carattere scelto dall'utente (SXADV-5745): cambiandolo cambia la
     larghezza delle etichette e il righello va rimisurato. */
  const { density } = useDensity();
  /* Un solo slot di zoom per ambito, con due rivendicanti possibili: una
     griglia (id = suo `viewName`/`path`) oppure l'area inferiore intera
     (`PANEL_ZOOM_ID`, SXADV-5651). Per la testata non fa differenza — in
     entrambi i casi si collassa — mentre la barra dei tab sopravvive solo
     allo zoom d'area: è lì che sta il pulsante per uscirne, e in un tab a
     campi (non a griglia) senza barra non si cambierebbe più tab. */
  const zoomedId = zoomStore.zoomByScope[zoomScope] ?? null;
  const zoomed = zoomedId != null;
  const panelZoom = zoomedId === PANEL_ZOOM_ID;

  // Find last header-item row index (rows containing controls with group or forGroup)
  const lastHeaderRowIdx = (() => {
    let last = -1;
    for (let i = 0; i < ui.rows.length; i++) {
      const row = ui.rows[i];
      for (const cell of row.cells) {
        if (cell.control?.forGroup || cell.control?.group) {
          last = i;
          break;
        }
      }
    }
    return last;
  })();

  // For top-level detail pages, split rows into form rows and bottom panel rows
  // Bottom panel = trailing rows that contain tab/embeddedView/detailView
  let formRows = ui.rows;
  let bottomRows: UIRow[] = [];
  let actionBarRows: UIRow[] = [];

  if (!embedded && pageType === 2) {
    // Find where the bottom panel starts: scan from the end
    let splitIdx = ui.rows.length;
    for (let i = ui.rows.length - 1; i >= 0; i--) {
      if (isBottomPanelRow(ui.rows[i])) {
        splitIdx = i;
      } else {
        break; // Stop at first non-panel row from the bottom
      }
    }
    if (splitIdx < ui.rows.length) {
      formRows = ui.rows.slice(0, splitIdx);
      bottomRows = ui.rows.slice(splitIdx);
    }
    // Extract actionBar rows from form rows so they stay fixed above the scroll area
    actionBarRows = formRows.filter(isActionBarRow);
    formRows = formRows.filter((r) => !isActionBarRow(r));
  }

  const hasOlapCube = viewHasOlapCube(ui);

  // Width the table has to live in, tracked so the ruler follows window resize,
  // browser zoom and sidebar drags.
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [hostWidth, setHostWidth] = React.useState(0);
  const hasBottomPanel = bottomRows.length > 0;
  React.useEffect(() => {
    const host = tableRef.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect.width;
      setHostWidth(box || hostContentWidth(host));
    });
    ro.observe(host);
    setHostWidth(hostContentWidth(host));
    return () => ro.disconnect();
  }, [hasBottomPanel]);

  // Il righello di QUESTA tabella, misurato sulle sue righe. Nel layout split la
  // tabella del form e quella del contenuto di un tab sono due elementi
  // distinti e ognuna misura le proprie (vedi TabContentTable).
  const ruler = buildRuler(ui.rows, hostWidth, density);
  const formCols = ruler.formCols;
  const tableStyle = layoutTableStyle(ruler, embedded);
  const rulerRow = rulerRowFor(ruler);
  const edgeScroll = useEdgeScrollReveal();

  // Split layout: form (top) / bottom panel (tabs, embedded views).
  // The user can drag the resizer between them to change how much space
  // each gets — useful when the bottom panel contains a grid they want
  // to see more rows of.
  // The split ratio adapts to where the user is working: the area holding
  // keyboard focus expands — the testata (form) when the caret is on a header
  // field, the tab/bottom panel when the caret is inside a tab (or on the tab
  // bar). A manual drag on the resizer overrides this until focus next crosses
  // between the two areas.
  const NEUTRAL_PCT = 50;
  const FORM_FOCUS_PCT = 78;
  const BOTTOM_FOCUS_PCT = 22;
  const [focusZone, setFocusZone] = React.useState<'form' | 'bottom' | null>(null);
  const focusZoneRef = React.useRef<'form' | 'bottom' | null>(null);
  // Specchio di `focusZone` per i gestori di eventi (setZone confronta la zona
  // corrente senza rientrare nel render). Si aggiorna QUI, dopo il commit, e non
  // durante il render: scrivere una ref mentre si renderizza e' proprio cio' che
  // rende il render non ripetibile, e i due punti che lo facevano — cambio di
  // view e apertura di un nuovo record — ora passano dallo stato.
  React.useEffect(() => { focusZoneRef.current = focusZone; }, [focusZone]);
  const [manualPct, setManualPct] = React.useState<number | null>(null);
  const [resizing, setResizing] = React.useState(false);
  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);

  // The split belongs to the view, not to this fiber. When the rendered view
  // changes under us (navigation, breadcrumb back), swap the state over to that
  // view's remembered split — restoring what the user left, and never inheriting
  // the previous view's. Done during render rather than in an effect so the very
  // first paint of the restored view is already at the right ratio.
  const splitKey = `${splitSid}|${ui.viewName ?? ui.path ?? ''}`;
  const [prevSplitKey, setPrevSplitKey] = React.useState(splitKey);
  if (prevSplitKey !== splitKey) {
    setPrevSplitKey(splitKey);
    const saved = splitByView.get(splitKey);
    setFocusZone(saved?.zone ?? null);
    setManualPct(saved?.manualPct ?? null);
  }
  React.useEffect(() => {
    splitByView.set(splitKey, { zone: focusZone, manualPct });
  }, [splitKey, focusZone, manualPct]);

  // A brand-new record (server insert state) opens with the testata expanded.
  // At the neutral 50/50 the header fields — the very ones the user came here to
  // fill in — sit half-hidden under the tab panel until a click expands them;
  // that click is pure ceremony, since focusing any header field expands the
  // area anyway. Do it up front instead (SXADV-5691).
  //
  // Applied once per new record, keyed on (insert state + viewstate path): a
  // data-only reload of the same record must not undo a tab the user has since
  // opened, while "Nuovo" on a view whose viewstate is reused (path unchanged,
  // insert state flipping false -> true) still triggers it.
  const newRecordKey = ui.newRecord ? `${splitSid}|${ui.path ?? ''}` : null;
  // Seeded with `undefined` (not the current key) so a tab that mounts straight
  // onto a new record — the common "Nuovo" case — still applies it.
  const [prevNewRecordKey, setPrevNewRecordKey] = React.useState<string | null | undefined>(undefined);
  if (prevNewRecordKey !== newRecordKey) {
    setPrevNewRecordKey(newRecordKey);
    if (newRecordKey) {
      setFocusZone('form');
      setManualPct(null);
    }
  }

  // A manual drag (manualPct) wins; otherwise the focused zone sets the target.
  const formFlexBasisPct =
    manualPct != null
      ? manualPct
      : focusZone === 'form'
        ? FORM_FOCUS_PCT
        : focusZone === 'bottom'
          ? BOTTOM_FOCUS_PCT
          : NEUTRAL_PCT;

  // Interacting inside .view-split-form (testata) or .view-split-bottom (tab bar
  // + tab content) drives the adaptive split. Both keyboard focus AND a mouse
  // click activate the zone, so clicking anywhere in an area (a grid, a label,
  // empty space — things that don't take focus) still expands it. Interaction
  // elsewhere (action bar, toolbar, resizer) keeps the last zone. Crossing zones
  // drops any manual drag override so the auto target takes over again; staying
  // in a zone preserves a drag.
  const setZone = React.useCallback((zone: 'form' | 'bottom') => {
    if (focusZoneRef.current === zone) return;
    focusZoneRef.current = zone;
    setFocusZone(zone);
    setManualPct(null);
  }, []);
  const zoneOf = React.useCallback((target: EventTarget | null): 'form' | 'bottom' | null => {
    const t = target as HTMLElement | null;
    if (!t) return null;
    if (t.closest('.view-split-bottom')) return 'bottom';
    if (t.closest('.view-split-form')) return 'form';
    return null;
  }, []);

  // A pointer settles the zone on CLICK — never on pointerdown, nor on the focus
  // that pointerdown hands its target. Resizing the split moves everything in
  // both areas (up to a third of the view's height, over the 150ms transition),
  // so if the press itself resizes, the element slides out from under the cursor
  // and mouseup lands elsewhere: the browser then fires no click on it at all.
  // The action was swallowed and the user had to click a second time, the first
  // click having only resized the areas — reported on "Nuovo" inside a tab, but
  // it hit every button and link in either area whenever that click was the one
  // that changed zone (SXADV-5820). The tab bar hit this first and got the same
  // cure; see revealBottom. Keyboard focus still activates immediately — nothing
  // moves out from under a caret that arrived by Tab.
  const pointerDrivenRef = React.useRef(false);
  const onSplitPointerDown = React.useCallback(() => {
    pointerDrivenRef.current = true;
    // Not every press ends in a click (a drag released outside its element
    // doesn't), so clear the flag once the click would have fired — otherwise a
    // later keyboard focus would be taken for a pointer one and ignored. The
    // timeout runs after the click, which is dispatched right after pointerup.
    window.addEventListener(
      'pointerup',
      () => { window.setTimeout(() => { pointerDrivenRef.current = false; }, 0); },
      { once: true, capture: true },
    );
  }, []);
  const onSplitFocus = React.useCallback((e: React.FocusEvent) => {
    if (pointerDrivenRef.current) return;
    const t = e.target as HTMLElement | null;
    // Focus on the tab bar doesn't move the split: picking a tab does, through
    // revealBottom below.
    if (t?.closest('.ant-tabs-nav')) return;
    const zone = zoneOf(t);
    if (zone) setZone(zone);
  }, [setZone, zoneOf]);

  // Picking a tab is a request to look at that tab's rows, so give them the room
  // — otherwise the tab highlights while its content stays pinned at 22% and the
  // user has to hunt for it. Covers re-clicking the active tab too, which fires
  // no onChange.
  const revealBottom = React.useCallback(() => {
    focusZoneRef.current = 'bottom';
    setFocusZone('bottom');
    // Drop a manual drag only when it leaves the rows more cramped than the focus
    // target would: a drag that already gave them more room is the user's choice.
    setManualPct((cur) => (cur != null && cur > BOTTOM_FOCUS_PCT ? null : cur));
  }, []);
  const onSplitClick = React.useCallback((e: React.MouseEvent) => {
    pointerDrivenRef.current = false;
    const t = e.target as HTMLElement | null;
    const zone = zoneOf(t);
    if (!zone) return;
    // The tab bar has its own rule (it keeps a roomier manual drag).
    const tabNav = zone === 'bottom' && !!t?.closest('.ant-tabs-nav');
    // Resize on the NEXT task, never inside the click's own dispatch. This is a
    // capture-phase handler, so React flushes the state change — and the
    // re-render it causes — before the event has even reached its target: AG
    // Grid then never fires rowClicked for that click, and the first click on a
    // grid inside an area only resized the areas (the cell took focus, but no
    // row selection and no edit panel — the user had to click a second time).
    // Same swallowed first click as SXADV-5820, one layer in: there the press
    // itself moved the button, here the re-render lands mid-dispatch. Deferring
    // by a task lets every handler downstream of us see the click first; the
    // 150ms transition starting a task later is invisible.
    window.setTimeout(() => { if (tabNav) revealBottom(); else setZone(zone); }, 0);
  }, [revealBottom, setZone, zoneOf]);

  const onResizerMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = splitContainerRef.current;
    if (!container) return;
    const startY = e.clientY;
    const rect = container.getBoundingClientRect();
    const startPct = formFlexBasisPct;
    setResizing(true);
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const deltaPct = (dy / rect.height) * 100;
      const next = Math.min(90, Math.max(10, startPct + deltaPct));
      setManualPct(next);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setResizing(false);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [formFlexBasisPct]);

  // If every form row is invisible (e.g. all items above the tab use
  // isVisible="?!newUI"), don't reserve vertical space for an empty form area —
  // collapse the top half so the bottom panel (Tab/embeddedView) takes
  // everything below the action bar.
  const hasVisibleFormContent = formRows.some(isRowVisible);

  // Split layout: form scrolls, bottom panel always visible
  if (bottomRows.length > 0) {
    return (
      <FillHeightContext.Provider value={fillHeight}>
      <ViewNameContext.Provider value={ui.viewName}>
      <PathContext.Provider value={ui.path}>
      <div className="view-container" ref={splitContainerRef} onFocusCapture={onSplitFocus} onPointerDownCapture={onSplitPointerDown} onClickCapture={onSplitClick}>
        {zoomed && !embedded && <ZoomEscapeFallback />}
        {ui.title && !hasOlapCube && !titleInBreadcrumb && !titleEchoesTab && <div className="view-title">{ui.title}</div>}
        {actionBarRows.length > 0 && (
          <div className="action-bar-sticky">
            {actionBarRows.map((row, ri) => (
              <RowRenderer key={row.id || `ab_${ri}`} row={row} pageType={pageType} onAction={onAction} onChange={onChange} onGridChange={onGridChange} asDiv />
            ))}
          </div>
        )}
        {hasVisibleFormContent && !zoomed && (
          <>
            <div
              className={`view-split-form${resizing ? ' view-split-form--resizing' : ''}`}
              onMouseMove={edgeScroll.onMouseMove}
              onMouseLeave={edgeScroll.onMouseLeave}
              style={{ flex: `0 0 ${formFlexBasisPct}%`, maxHeight: 'none' }}
            >
              <table ref={tableRef} className="layout-table" style={tableStyle}>
                <tbody>
                  {rulerRow}
                  {formRows.map((row, ri) => (
                    <React.Fragment key={row.id || ri}>
                      <RowRenderer row={row} pageType={pageType} formCols={formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
                      {ri === lastHeaderRowIdx && (
                        <tr className="header-separator-row">
                          <td colSpan={formCols || 100}>
                            <div className="header-items-separator" />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="view-split-resizer"
              onMouseDown={onResizerMouseDown}
              title="Trascina per ridimensionare"
            />
          </>
        )}
        <div className="view-split-bottom">
          <SplitAreaContext.Provider value={true}>
          {bottomRows.map((row, ri) => {
            // Tab rows: render tab bar + content rows in a table sharing the master grid
            const tabCell = row.cells.find((c) => c.control?.type === 'tab');
            if (tabCell?.control) {
              return (
                <SplitTabPanel
                  key={row.id || `bp_${ri}`}
                  control={tabCell.control}
                  pageType={pageType}
                  /* Con lo zoom di una GRIGLIA sparisce anche la barra dei tab: si
                     resta sul tab corrente finché non si esce (Esc), e la griglia
                     zoomata mostra il proprio titolo, normalmente soppresso perché
                     ripete l'etichetta del tab. Con lo zoom dell'AREA la barra
                     resta: è il contenuto del tab a prendersi lo schermo, qualunque
                     esso sia, e cambiare tab deve continuare a funzionare. */
                  showBar={!zoomed || panelZoom}
                  extraRight={(
                    <Tooltip title={panelZoom ? 'Riduci la sezione (Esc)' : 'Ingrandisci la sezione'} placement="bottom">
                      <Button
                        size="small"
                        type={panelZoom ? 'primary' : 'default'}
                        icon={panelZoom ? <CompressOutlined /> : <ExpandOutlined />}
                        aria-label={panelZoom ? 'Riduci la sezione' : 'Ingrandisci la sezione'}
                        aria-pressed={panelZoom}
                        onClick={() => zoomStore.setZoomForScope(zoomScope, panelZoom ? null : PANEL_ZOOM_ID)}
                      />
                    </Tooltip>
                  )}
                  onTabChange={revealBottom}
                  onAction={onAction}
                  onChange={onChange}
                  onGridChange={onGridChange}
                />
              );
            }
            // Non-tab bottom panel rows
            return (
              <BottomPanelRow key={row.id || `bp_${ri}`} row={row} pageType={pageType} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
            );
          })}
          </SplitAreaContext.Provider>
        </div>
      </div>
      </PathContext.Provider>
      </ViewNameContext.Provider>
      </FillHeightContext.Provider>
    );
  }

  // No split: single view. Top-level pages keep the scrollable view-body.
  // Embedded views are transparent — an embedded "wrapper" view (just
  // dispatchers pointing to an inner list) shouldn't introduce its own
  // scroll container. The inner grid or the parent handles scrolling.
  const bodyClassName = embedded ? 'view-body view-body-embedded' : 'view-body';
  const bodyProps = embedded
    ? { className: bodyClassName }
    : {
        className: bodyClassName,
        onMouseMove: edgeScroll.onMouseMove,
        onMouseLeave: edgeScroll.onMouseLeave,
      };
  return (
    <FillHeightContext.Provider value={fillHeight}>
    <ViewNameContext.Provider value={ui.viewName}>
    <PathContext.Provider value={ui.path}>
    <div className="view-container">
      {ui.title && !hasOlapCube && !titleInBreadcrumb && !titleEchoesTab && <div className="view-title">{ui.title}</div>}
      <div {...bodyProps}>
        <table ref={tableRef} className="layout-table" style={tableStyle}>
          <tbody>
            {rulerRow}
            {ui.rows.map((row, ri) => (
              <React.Fragment key={row.id || ri}>
                <RowRenderer row={row} pageType={pageType} formCols={formCols} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
                {ri === lastHeaderRowIdx && (
                  <tr className="header-separator-row">
                    <td colSpan={formCols || 100}>
                      <div className="header-items-separator" />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </PathContext.Provider>
    </ViewNameContext.Provider>
    </FillHeightContext.Provider>
  );
};

/** Renders bottom panel rows (tabs, embedded views) outside the table */
const BottomPanelRow: React.FC<{
  row: UIRow;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}> = ({ row, onAction, onChange, onGridChange }) => {
  return (
    <>
      {row.cells.map((cell, ci) => {
        if (!cell.control) return null;
        return (
          <div key={cell.id || ci} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {renderContainerControl(cell.control, onAction, onChange, onGridChange)}
          </div>
        );
      })}
    </>
  );
};

/** Indice della cella "banda di sezione" di una riga, o -1 se non lo e'.
 *
 *  E' la riga che intesta una sezione del form: un solo Hint con una delle
 *  classi legacy `section_header*` (fondo azzurro, testo centrato), a volte
 *  preceduto da una cella di prompt vuota che fa da rientro.
 *
 *  Serve per allargarla a tutta la tabella (SXADV-5809). La banda dichiara nel
 *  XML un `size` scritto a mano che non e' calcolato sulle righe che intesta e
 *  quasi mai coincide: su titolariEffettiviDetail la banda dice `size="100"`
 *  (20 colonne) mentre la riga "Ditta" ne usa 24, cosi' la banda finiva 211px
 *  prima dei campi che dovrebbe contenere; su datiCciaaEmbDetail e
 *  anVrAttivitaDetail lo stesso, di 2-4 colonne. Nessun autore di view intende
 *  "la banda copre 20 delle 24 colonne": e' un numero approssimato a mano. */
function sectionBandIndex(row: UIRow): number {
  let band = -1;
  for (let i = 0; i < row.cells.length; i++) {
    const cell = row.cells[i];
    const cls = (cell.control?.cls as string | undefined) || cell.cls || '';
    if (cell.control?.type === 'hint' && /(^|\s)section_header/.test(cls)) {
      if (band >= 0) return -1; // due bande sulla stessa riga: non e' un titolo di sezione
      band = i;
      continue;
    }
    // Tutto il resto puo' essere solo riempitivo: un prompt senza testo.
    const isEmptyPrompt = cell.elementType === ELTYPE_PROMPT
      && !(cell.prompt || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!isEmptyPrompt) return -1;
  }
  return band;
}

const RowRenderer: React.FC<{
  row: UIRow;
  pageType?: number;
  formCols?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
  asDiv?: boolean;
}> = ({ row, pageType, formCols, onAction, onChange, onGridChange, asDiv }) => {
  if (!isRowVisible(row)) return null;
  if (asDiv) {
    // Render outside table context (e.g. sticky action bar)
    return (
      <div id={row.id} className={row.cls || ''}>
        {row.cells.map((cell, ci) => {
          if (!cell.control) return null;
          return (
            <ControlRenderer key={cell.id || ci} control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
          );
        })}
      </div>
    );
  }
  // Detect which CONTENT cells have no preceding PROMPT (companion fields)
  const noPrecedingPrompt = new Set<number>();
  for (let i = 0; i < row.cells.length; i++) {
    if (row.cells[i].elementType === ELTYPE_CONTENT) {
      const prev = i > 0 ? row.cells[i - 1] : null;
      if (!prev || prev.elementType !== ELTYPE_PROMPT) {
        noPrecedingPrompt.add(i);
      }
    }
  }

  // La banda di sezione prende tutta la larghezza rimasta: mai meno di quanto
  // dichiara (si allarga soltanto), mai piu' della tabella.
  const bandIdx = formCols ? sectionBandIndex(row) : -1;
  let bandColSpan: number | undefined;
  if (bandIdx >= 0 && formCols) {
    const others = row.cells.reduce((sum, c, i) => i === bandIdx ? sum : sum + (c.colspan || 1), 0);
    bandColSpan = Math.max(row.cells[bandIdx].colspan || 1, formCols - others);
  }

  return (
    <tr id={row.id} className={row.cls || ''}>
      {row.cells.map((cell, ci) => (
        <CellRenderer key={cell.id || ci} cell={cell} companion={noPrecedingPrompt.has(ci)} pageType={pageType} formCols={formCols} colSpanOverride={ci === bandIdx ? bandColSpan : undefined} onAction={onAction} onChange={onChange} onGridChange={onGridChange} />
      ))}
    </tr>
  );
};

const CellRenderer: React.FC<{
  cell: UICell;
  companion?: boolean;
  pageType?: number;
  formCols?: number;
  /** Colspan imposto dalla riga (banda di sezione allargata, SXADV-5809). */
  colSpanOverride?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
  onGridChange?: (name: string, values: string[]) => void;
}> = ({ cell, companion, pageType, formCols, colSpanOverride, onAction, onChange, onGridChange }) => {
  // Two-phase pipeline: the template carries a `visible` slot for every
  // conditionally-shown cell. When `hydrate()` resolves it to false, we skip
  // the cell entirely — matching the legacy FULL-mode behavior where hidden
  // cells were simply omitted from the wire.
  if (cell.visible === false) return null;
  // For container/section-header/filler cells, clamp colspan to formCols so
  // sub-view colspans don't inflate the auto-layout table width
  const isFullWidthCell = cell.elementType === ELTYPE_CONTAINER
    || cell.elementType === ELTYPE_SECTION_HEADER
    || cell.elementType === ELTYPE_FILLER;
  const colSpan = colSpanOverride ?? (isFullWidthCell && formCols ? formCols : cell.colspan);

  const tdProps: React.TdHTMLAttributes<HTMLTableCellElement> = {
    id: cell.id,
    colSpan,
    rowSpan: cell.rowspan,
    className: cell.cls || '',
  };
  if (cell.style) {
    tdProps.style = parseInlineStyle(cell.style);
  }
  // Field hint (ViewItem hint="...") → native hover tooltip. Text/number inputs
  // forward the control-level `title`, but antd DatePicker/Select drop it, so
  // hints silently failed on those. Setting it on the content cell makes the
  // hover explanation work uniformly for every control type.
  const cellHint = cell.control?.hint as string | undefined;
  if (cellHint) tdProps.title = cellHint;

  switch (cell.elementType) {
    case ELTYPE_PROMPT:
      return (
        <td {...tdProps} className={`prompt-cell ${cell.promptCls || ''} ${cell.cls || ''}`}
          dangerouslySetInnerHTML={cell.prompt ? { __html: fixServerHtml(cell.prompt) } : undefined}
        />
      );

    case ELTYPE_CONTENT: {
      const isCompact = cell.control?.type === 'boolean' || cell.control?.type === 'checkbox';
      if (isCompact) {
        tdProps.colSpan = 1;
        tdProps.style = { ...tdProps.style, width: '1%' };
      }
      const docIcon = cell.control?.docIcon;
      const configureIcon = cell.control?.configureIcon;
      // `has-side-icons` toglie il clipping alla cella: in una cella stretta
      // (una checkbox ne occupa una sola, ~24px) l'icona finirebbe oltre il
      // bordo e l'`overflow:hidden` la mangerebbe — vedi global.css.
      const hasSideIcons = !!(docIcon || configureIcon);
      const cellClass = `content-cell ${companion ? 'companion-cell' : ''} ${hasSideIcons ? 'has-side-icons' : ''} ${cell.cls || ''}`;
      return (
        <td {...tdProps} className={cellClass}>
          {cell.control ? (
            <>
              <span style={hasSideIcons ? { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', width: '100%' } : { display: 'block', width: '100%' }}>
                <ControlRenderer control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
                {docIcon && (
                  <BookOutlined
                    className={`doc-icon ${docIcon.hasHelp ? 'doc-on' : 'doc-off'}`}
                    title={docIcon.hasHelp ? 'Modifica documentazione' : 'Aggiungi documentazione'}
                    onClick={() => onAction('NavigateHelp', { navpath: `${docIcon.viewName}|${docIcon.itemId}` })}
                  />
                )}
                {configureIcon && (
                  configureIcon.included
                    ? <CheckCircleFilled
                        className="configure-icon configure-on"
                        title="Elemento incluso - clicca per escludere"
                        onClick={() => onAction('ToggleItem', { navpath: configureIcon.itemId })}
                      />
                    : <CloseCircleFilled
                        className="configure-icon configure-off"
                        title="Elemento escluso - clicca per includere"
                        onClick={() => onAction('ToggleItem', { navpath: configureIcon.itemId })}
                      />
                )}
              </span>
            </>
          ) : null}
        </td>
      );
    }

    case ELTYPE_CONTAINER:
      return (
        <td {...tdProps} className={`container-cell ${cell.cls || ''}`}>
          {cell.control && renderContainerControl(cell.control, onAction, onChange, onGridChange)}
        </td>
      );

    case ELTYPE_SECTION_HEADER:
      return (
        <td {...tdProps} className={`section-header ${cell.cls || ''}`}>
          {cell.text || cell.prompt}
        </td>
      );

    case ELTYPE_SELECTOR:
      return (
        <td {...tdProps} className={`selector-cell ${cell.cls || ''}`}>
          {cell.control ? (
            <ControlRenderer control={cell.control} pageType={pageType} onAction={onAction} onChange={onChange} />
          ) : null}
        </td>
      );

    case ELTYPE_FILLER:
      if (cell.control) {
        return (
          <td {...tdProps} className={`container-cell ${cell.cls || ''}`}>
            {renderContainerControl(cell.control, onAction, onChange, onGridChange)}
          </td>
        );
      }
      return null;

    default:
      return <td {...tdProps} />;
  }
};

function renderContainerControl(
  control: UIControl,
  onAction: (action: string, params?: Record<string, string>) => void,
  onChange: (name: string, value: unknown) => void,
  onGridChange?: (name: string, values: string[]) => void
): React.ReactNode {
  switch (control.type) {
    case 'tab': {
      const selectedTab = control.tabs?.find((t) => t.selected) ?? control.tabs?.[0];
      const activeTab = selectedTab?.name;
      return (
        <div className="tab-container">
          <div className="tab-sticky-wrapper">
            <Tabs
              activeKey={activeTab}
              onChange={(key) => onAction('ChangeTab', { navpath: control.navpath as string, option1: control.controlName as string, option2: key })}
              items={(control.tabs || []).map((tab) => ({
                key: tab.name,
                label: renderTabLabel(tab, onAction),
              }))}
            />
          </div>
          {control.contentRows && (
            <div className="tab-content" style={{ overflow: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {/* The tab label names this content: a heading inside that repeats it
                  is dropped, however deep the wrapper chain (see TabLabelContext). */}
              <TabLabelContext.Provider value={selectedTab?.prompt}>
                <ViewRenderer
                  ui={{
                    rows: control.contentRows,
                    viewName: control.contentViewName,
                    totalCols: control.totalCols as number | undefined,
                    totalWidth: control.totalWidth as number | undefined,
                  }}
                  onAction={onAction}
                  onChange={onChange}
                  onGridChange={onGridChange}
                  embedded
                  fillHeight
                />
              </TabLabelContext.Provider>
            </div>
          )}
        </div>
      );
    }

    case 'embeddedView':
    case 'detailView': {
      // The server merges the full child UITree into the control object
      const rows = (control.rows ?? control.contentRows) as UIRow[] | undefined;
      if (rows) {
        const isHorizontal = control.layoutType === 'horizontal';
        const embeddedHeader = control.header as UITree['header'];
        const embeddedFooter = control.footer as UITree['footer'];
        const embeddedUi: UITree = {
          rows,
          viewName: (control.viewName ?? control.contentViewName) as string,
          pageType: isHorizontal ? 1 : (control.pageType as number | undefined),
          totalCols: control.totalCols as number | undefined,
          // totalWidth is needed alongside totalCols so ListRenderer can size
          // columns by their server colspan proportion (perUnit = totalWidth /
          // totalCols). Without it, columns that declare no `size` — e.g. List /
          // CodeTable / GenericList combos — collapse to their header width.
          totalWidth: control.totalWidth as number | undefined,
          // Derive path from header or footer (server puts it there for embedded views)
          path: embeddedHeader?.path || embeddedFooter?.path || (control.path as string | undefined),
          header: embeddedHeader,
          headers: control.headers as UITree['headers'],
          columns: control.columns as UITree['columns'],
          continuationHeaders: control.continuationHeaders as UITree['continuationHeaders'],
          footer: embeddedFooter,
          // Add / XLS / print bar rendered above the grid (SXADV-5693). Only
          // embedded lists get it, and this is the only path that builds their
          // UITree — omit it here and the bar silently never renders.
          gridActions: control.gridActions as UITree['gridActions'],
          multiEdit: control.multiEdit as boolean | undefined,
          listEdit: control.listEdit as boolean | undefined,
          inlineEdit: control.inlineEdit as boolean | undefined,
          // Detail-view binding: drives the selector navigate column and the
          // panel content choice (list structure vs detail form).
          hasDetailView: control.hasDetailView as boolean | undefined,
          detailViewName: control.detailViewName as string | undefined,
          // Instant edit panel: the cacheable panel FORM template + key. Without
          // these the embedded ListView can't hydrate the panel on row selection
          // (rows already carry per-record editData via `rows` above).
          panelTemplate: control.panelTemplate as UITree['panelTemplate'],
          panelTemplateKey: control.panelTemplateKey as string | undefined,
          // ...e, per una lista dichiarata `selector="false"`, l'identita' di
          // riga che il selettore non puo' dare (SXADV-5796.3b). Senza questa
          // copia il click su una riga non seleziona nulla e il pannello non si
          // apre mai — vale per le liste embedded, cioe' quasi tutte.
          panelSelector: control.panelSelector as UITree['panelSelector'],
          // Server-side pagination state for the embedded grid, updated in place
          // by the detailPageOnly slim response (Shell). When present with
          // totalPages > 1, ListRenderer shows an interactive pager.
          paging: control.paging as UITree['paging'],
        };
        return <ViewRenderer ui={embeddedUi} onAction={onAction} onChange={onChange} onGridChange={onGridChange} embedded />;
      }
      return null;
    }

    default:
      return <ControlRenderer control={control} onAction={onAction} onChange={onChange} />;
  }
}

function parseInlineStyle(styleStr: string): React.CSSProperties {
  const style: Record<string, string> = {};
  styleStr.split(';').forEach((rule) => {
    const [prop, val] = rule.split(':').map((s) => s.trim());
    if (prop && val) {
      const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      style[camelProp] = val;
    }
  });
  return style;
}

export default ViewRenderer;
