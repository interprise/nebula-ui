import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import type { UIControl } from '../../types/ui';
import { useCommonProps, useControlChange, getTextMaxWidth, comboWidthForSize, useSelectKeys, useSyncedState, useSelectOpen, useComboTextField, mandatoryStatus, getFieldName } from '../helpers';
import type { CommonInputProps } from '../helpers';
import { withPostDecorations } from '../decorations';
import { SidContext, PathContext } from '../../components/ViewRenderer';
import * as api from '../../services/api';

/** Quante voci per pagina chiede il lookup al server. Non e' piu' un tetto:
 *  scorrendo la tendina si chiede la pagina successiva (SXADV-5642). */
const PAGE_SIZE = 100;

/** Remote combo (ListUIControl) — fetches options from the server as the user types. */
const RemoteCombo: React.FC<{
  control: UIControl;
  commonProps: CommonInputProps;
  value: unknown;
  widthStyle: React.CSSProperties;
  onChange: (val: unknown) => void;
  // Raw Shell onChange (name, value) — updates formValues WITHOUT firing a
  // reload, used by the Esc undo so restoring a value isn't a server action.
  rawOnChange: (name: string, value: unknown) => void;
}> = ({ control, commonProps, value, widthStyle, onChange, rawOnChange }) => {
  const sid = useContext(SidContext);
  // List-data mode (editable cells in a list) ships the current value's label as
  // `displayValue`; the detail-form path ships `displayText`. Accept either so an
  // inline combo shows "DIVISIONE UNICA", not the raw key "CMO|1".
  const displayText = (control.displayText ?? control.displayValue) as string | undefined;
  // The detail-form combo bakes its own navpath; an editable combo inside a list
  // row doesn't (list-data mode omits it), so fall back to the row's path from
  // PathContext — set by the continuation-cell renderer to this record's row.
  const ctxPath = useContext(PathContext);
  const navpath = (control.navpath ?? ctxPath) as string;
  const controlName = control.controlName as string || control.name || '';

  // Hold the selection locally. Shell writes field edits to a ref WITHOUT
  // setState, so a Select bound straight to `control.value` re-renders from the
  // unchanged prop and reverts any local change — most visibly a clear, which
  // just snapped back to the old value (SXADV-5489.2). Local state re-syncs only
  // on a real server round-trip, matching DateControl's `useLocalDayjs`.
  const [selected, setSelected] = useSyncedState<string | undefined>(
    value ? String(value) : undefined
  );
  // Control the dropdown so it opens ONLY on typing or a click of the trigger
  // arrow — never on a plain body/focus click (ExtJS-parity). Paired with
  // `defaultActiveFirstOption={false}` so no option is ever auto-selected on
  // Tab-out without a deliberate pick (SXADV-5489.2).
  const { open, setOpen, onOpenChange } = useSelectOpen();
  // Testo di ricerca corrente e stato aperto/chiuso, in ref perche' servono
  // dentro callback che antd invoca fuori dal ciclo di render (SXADV-5766):
  // il testo distingue una digitazione dalla stringa vuota che antd emette
  // quando la tendina si CHIUDE (chiudendola butta via quanto digitato).
  const searchRef = useRef('');
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);
  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    value ? [{ value: value as string, label: displayText || (value as string) }] : []
  );
  const [fetching, setFetching] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (selected) {
      setOptions(prev => {
        const exists = prev.some(o => o.value === selected);
        if (exists) return prev;
        return [{ value: selected, label: displayText || selected }, ...prev];
      });
    }
  }, [selected, displayText]);

  // Didascalia del valore scelto: e' quella che deve stare NELL'input perche'
  // sia selezionabile e copiabile col mouse (SXADV-5641.1).
  const label = (options.find(o => o.value === selected)?.label
    ?? displayText ?? selected ?? '') as string;
  const { selectRef, search, setSearch, showLabel, onFocus, onBlur, focusInput } =
    useComboTextField(label, open);

  const handleChange = useCallback((val: unknown) => {
    setSelected((val as string) || undefined);
    searchRef.current = ''; // scelta fatta: il testo di ricerca non vale piu'
    // Con `searchValue` controllato il testo di ricerca non se ne va da solo:
    // senza questo, scelta la voce resterebbe scritto quello che si era
    // digitato per trovarla, sopra il nominativo appena scelto.
    showLabel(val ? String(options.find(o => o.value === val)?.label ?? val) : '');
    if (!val) setOpen(false); // clearing (× or Canc) closes the list
    onChange(val);
  }, [onChange, setSelected, setOpen, showLabel, options]);

  const loadedRef = useRef(false);

  // Paginazione della tendina (SXADV-5642). Prima si chiedevano 100 voci e
  // basta: cercando "rossi" fra le anagrafiche l'elenco si fermava a ROSSI
  // DANIELE, e le successive (fino a TORNERIA AUTOMATICA ROSSI) non erano
  // raggiungibili in alcun modo — mentre il legacy, che la tendina la paginava,
  // le mostrava tutte. Il comando lato server (`ListUIControlListCommand`)
  // legge gia' `start`/`limit`: qui si scorre e si chiede la pagina dopo.
  const pageRef = useRef({ query: '', offset: 0, done: false });
  const fetchingRef = useRef(false);

  const fetchOptions = useCallback(async (query: string) => {
    fetchingRef.current = true;
    setFetching(true);
    pageRef.current = { query, offset: 0, done: false };
    try {
      const results = await api.fetchComboOptions(navpath, controlName, query, sid, 0, PAGE_SIZE);
      setOptions(results.map(r => ({ value: r.value, label: r.text })));
      pageRef.current = {
        query,
        offset: results.length,
        done: results.length < PAGE_SIZE,
      };
    } catch {
      // keep existing options on error
    } finally {
      fetchingRef.current = false;
      setFetching(false);
      setHasFetched(true);
    }
  }, [navpath, controlName, sid]);

  /** Pagina successiva, accodata in fondo all'elenco gia' mostrato. */
  const fetchMore = useCallback(async () => {
    const page = pageRef.current;
    if (page.done || fetchingRef.current) return;
    fetchingRef.current = true;
    setFetching(true);
    try {
      const results = await api.fetchComboOptions(
        navpath, controlName, page.query, sid, page.offset, PAGE_SIZE,
      );
      // Su una pagina di QUERY il server antepone la voce "valore mancante" a
      // OGNI pagina: dalla seconda in poi e' un duplicato.
      const rows = results.filter(r => r.value !== 'NULL');
      setOptions(prev => {
        const seen = new Set(prev.map(o => o.value));
        return prev.concat(
          rows.filter(r => !seen.has(r.value)).map(r => ({ value: r.value, label: r.text })),
        );
      });
      pageRef.current = {
        query: page.query,
        offset: page.offset + results.length,
        done: results.length < PAGE_SIZE,
      };
    } catch {
      pageRef.current = { ...pageRef.current, done: true };
    } finally {
      fetchingRef.current = false;
      setFetching(false);
    }
  }, [navpath, controlName, sid]);

  /** Si e' arrivati in fondo alla tendina: carica il resto. */
  const onPopupScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) fetchMore();
  }, [fetchMore]);

  const handleSearch = useCallback((query: string) => {
    searchRef.current = query;
    setSearch(query);
    // Solo una digitazione apre la lista. antd emette onSearch('') anche
    // quando la tendina si chiude: riaprirla li' significava buttare via il
    // codice appena scritto e mostrare l'elenco COMPLETO (SXADV-5766).
    if (query) setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Stessa ragione: niente ricarica dell'elenco intero a tendina chiusa.
      if (!query && !openRef.current) return;
      fetchOptions(query);
    }, 300);
  }, [fetchOptions, setOpen, setSearch]);

  // Open the list, seeding the options with an unfiltered fetch on first open.
  // Shared by the trigger-arrow click and the Ctrl+Space keyboard shortcut.
  const openList = useCallback(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      fetchOptions('');
    }
    // Aprendo, la didascalia esce dall'input: la lista si mostra INTERA, non
    // filtrata su quello che e' gia' scelto (SXADV-5641.1).
    if (!searchRef.current) setSearch('');
    setOpen(true);
  }, [fetchOptions, setOpen, setSearch]);

  // Clic sulla freccia: apre e, come nel legacy, porta anche il fuoco DENTRO il
  // campo. Prima il preventDefault (che serve a non far rimbalzare il fuoco e a
  // togliere ad antd la sua apertura al clic) lasciava il campo senza fuoco, e
  // per scrivere bisognava premere TAB o cliccare di nuovo (SXADV-5641.3).
  const toggleFromTrigger = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusInput();
    if (!open) { openList(); return; }
    // Tendina gia' aperta perche' si sta digitando: la freccia NON la chiude.
    // Chi ha scritto "0010" e apre il lookup vuole vedere i risultati di
    // "0010", e chiudere qui li perderebbe (antd scarta il testo di ricerca
    // insieme alla tendina) — SXADV-5766.
    if (searchRef.current) return;
    setOpen(false);
  }, [open, openList, setOpen, focusInput]);

  // Clic sul CORPO del campo: apre la tendina solo se il campo e' vuoto
  // (SXADV-5641.4). Con un valore dentro il clic serve a mettersi nel testo per
  // selezionarlo, e aprire li' la lista era proprio il difetto corretto a suo
  // tempo (SXADV-5489.2); a campo vuoto invece non c'e' niente da selezionare e
  // il gesto naturale e' "fammi vedere cosa posso scegliere".
  const openIfEmpty = useCallback(() => {
    if (!selected && !open) openList();
  }, [selected, open, openList]);

  // Esc = undo: restore the server baseline (`value`) locally + into formValues,
  // no reload. `selected` re-syncs from the server on the next real round-trip.
  const restore = useCallback((val: string | undefined) => {
    setSelected(val);
    // Anche l'annullamento rimette nell'input la didascalia GIUSTA: senza,
    // resterebbe scritta quella del valore appena annullato.
    showLabel(val ? String(options.find(o => o.value === val)?.label ?? val) : '');
    rawOnChange(getFieldName(control), val ?? '');
  }, [control, rawOnChange, setSelected, showLabel, options]);
  // Chiusura (Esc, clic fuori, scelta): il testo di ricerca se ne va con la
  // tendina, quindi il ref torna vuoto e la freccia riprende a fare da toggle.
  const closeList = useCallback(() => { searchRef.current = ''; setOpen(false); }, [setOpen]);
  const handleOpenChange = useCallback((visible: boolean) => {
    if (!visible) searchRef.current = '';
    onOpenChange(visible);
  }, [onOpenChange]);
  const onKeyDown = useSelectKeys(selected, value, handleChange, restore, closeList, openList, open);

  return (
    <Select
      {...commonProps}
      // Il rosso dell'obbligatorio segue il valore ATTUALE, non quello con cui
      // il server ha disegnato la maschera (SXADV-5754.2).
      status={mandatoryStatus(control, selected ?? '')}
      ref={selectRef}
      value={selected}
      open={open}
      showSearch
      searchValue={search}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseDown={openIfEmpty}
      onPopupScroll={onPopupScroll}
      defaultActiveFirstOption={false}
      filterOption={false}
      // Same as the local combo: don't clip the option popup to a narrow
      // size-derived trigger width — let it size to its content.
      popupMatchSelectWidth={false}
      suffixIcon={<DownOutlined className="combo-chevron" onMouseDown={toggleFromTrigger} />}
      loading={fetching}
      notFoundContent={fetching ? 'Caricamento...' : (hasFetched ? 'Nessun risultato' : null)}
      onDropdownVisibleChange={handleOpenChange}
      onKeyDown={onKeyDown}
      style={widthStyle}
      options={options}
      onSearch={handleSearch}
      onChange={handleChange}
    />
  );
};

const ComboControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  // Local selection state so clears/edits survive Shell's ref-only writes and
  // don't snap back to the stale `control.value` (SXADV-5489.2). Re-syncs on a
  // real server round-trip. Used by the static branch; the remote branch keeps
  // its own copy inside RemoteCombo.
  const [selected, setSelected] = useSyncedState<string | undefined>(
    (control.value as string) || undefined
  );
  // Open only on typing or a trigger-arrow click, never on a body/focus click
  // (ExtJS parity, SXADV-5489.2) — same treatment as the remote branch.
  const { open, setOpen, onOpenChange } = useSelectOpen();
  const staticLabel = ((control.options || []).find(o => o.value === selected)?.text
    ?? control.displayText ?? control.displayValue ?? selected ?? '') as string;
  const { selectRef, search, setSearch, showLabel, onFocus, onBlur, focusInput } =
    useComboTextField(staticLabel, open);
  // Testo digitato nel campo di ricerca (SXADV-5766) — stesso ruolo che ha
  // nel ramo remoto: antd lo scarta insieme alla tendina quando questa si
  // chiude, e la onSearch('') che ne segue la riaprirebbe senza filtro.
  const searchRef = useRef('');
  const handleSelectChange = useCallback((val: unknown) => {
    setSelected((val as string) || undefined);
    searchRef.current = '';
    // Con `searchValue` controllato il testo di ricerca non se ne va da solo:
    // senza questo, scelta la voce resterebbe scritto quello che si era
    // digitato per trovarla.
    showLabel(val ? String((control.options || []).find(o => o.value === val)?.text ?? val) : '');
    if (!val) setOpen(false); // clearing (× or Canc) closes the list
    handleChange(val);
  }, [handleChange, setSelected, setOpen, showLabel, control.options]);
  const openList = useCallback(() => {
    // Come nel ramo remoto: aprendo, la didascalia esce dall'input, altrimenti
    // `optionFilterProp` filtrerebbe l'elenco sulla voce gia' scelta.
    if (!searchRef.current) setSearch('');
    setOpen(true);
  }, [setOpen, setSearch]);
  const toggleFromTrigger = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    focusInput(); // il clic sulla freccia entra anche nel campo (SXADV-5641.3)
    if (!open) { openList(); return; }
    // Lista aperta da una digitazione: la freccia non la chiude, altrimenti
    // il filtro appena scritto sparisce e riappare l'elenco intero.
    if (searchRef.current) return;
    setOpen(false);
  }, [open, setOpen, openList, focusInput]);
  const openIfEmpty = useCallback(() => {
    if (!selected && !open) openList(); // SXADV-5641.4
  }, [selected, open, openList]);
  const handleSearch = useCallback((query: string) => {
    searchRef.current = query;
    setSearch(query);
    if (query) setOpen(true); // solo una digitazione apre la lista
  }, [setOpen, setSearch]);
  const handleOpenChange = useCallback((visible: boolean) => {
    if (!visible) searchRef.current = '';
    onOpenChange(visible);
  }, [onOpenChange]);
  // Esc = undo: restore the server baseline (`control.value`) locally + into
  // formValues, no reload.
  const restore = useCallback((val: string | undefined) => {
    setSelected(val);
    showLabel(val ? String((control.options || []).find(o => o.value === val)?.text ?? val) : '');
    onChange(getFieldName(control), val ?? '');
  }, [control, onChange, setSelected, showLabel]);
  const closeList = useCallback(() => { searchRef.current = ''; setOpen(false); }, [setOpen]);
  const onKeyDown = useSelectKeys(selected, control.value, handleSelectChange, restore, closeList, openList, open);
  const textMaxWidth = getTextMaxWidth(control);
  // Width handling (SXADV-5461.1). antd Select is a <div> with no intrinsic
  // width, so `width:100%` alone collapses it to ~1 char inside an auto-layout
  // table column or a flex slot (unlike a text <input>, which has a default
  // intrinsic width). When the ViewItem declares a `size`, honor it like the
  // legacy UI: render the combo at its size-derived width instead of stretching
  // to (or collapsing within) the cell. Without a size, fill the cell but floor
  // the width so it can't collapse.
  // Niente `flexShrink: 0`: dentro `.post-decorations` il combo divide la cella
  // con le icone che gli stanno a destra (stella dell'obbligatorio, catenella,
  // lente di ricerca), e un elemento che non cede spazio se la prende tutta —
  // le icone finivano oltre il bordo, dove `overflow:hidden` della cella le
  // cancella (SXADV-5874.1, la stessa causa della stella mancante su "Id"). Con
  // la cedevolezza normale il combo restringe di quei pochi pixel e le icone
  // restano visibili; non puo' collassare, perche' flex toglie solo quanto
  // serve a rientrare, e il motivo per cui `flexShrink: 0` era stato messo —
  // il combo che si riduceva a un carattere (SXADV-5461.1) — riguardava
  // l'assenza di una larghezza propria, che qui invece c'e'.
  const widthStyle: React.CSSProperties = control.size != null
    ? { width: comboWidthForSize(control.size), maxWidth: '100%' }
    : { width: '100%', maxWidth: textMaxWidth, minWidth: 160 };

  // Un List/CodeTable NON modificabile non disegna un widget: scrive il proprio
  // testo. E' quello che fa il legacy — `GenericListUIControl` e
  // `CodeTableUIControl` hanno un `renderHTMLReadOnly` che emette
  // `<td|div class="… ea-readonly">descrizione</div>`, cioe' un blocco di testo
  // che VA A CAPO e fa crescere la riga in altezza. Un Select disabilitato no:
  // la sua larghezza e' fissa (derivata dal `size`, o il 100% della cella con un
  // tetto) e quello che non ci sta lo taglia con i puntini. Su Eventi Clienti
  // usciva mutilato tanto "Azienda" (nessun `size`, 37 caratteri in 218px)
  // quanto "Ateco" (`size="50"` per un testo di 74 caratteri, che nel legacy
  // andava su due righe) — SXADV-5874.0 e .4. Vale per QUALSIASI combo in sola
  // lettura, compresi quelli che lo diventano per stato del record (documento
  // confermato), esattamente come nel legacy.
  if (control.editable === false) {
    const fromOptions = (control.options || []).find((o) => o.value === selected)?.text;
    const roText = (control.displayText ?? control.displayValue ?? fromOptions ?? selected ?? '') as string;
    return withPostDecorations(
      // Il non-breaking space tiene in piedi la banda grigia di un campo vuoto:
      // il legacy la disegnava comunque (lo "Stato Giuridico" senza valore e' un
      // riquadro vuoto, non una riga che sparisce) — vedi anche SXADV-5543.
      // A valore vuoto il riquadro si stringerebbe sul solo spazio unificatore
      // e resterebbe un quadratino grigio: il legacy disegnava comunque una
      // banda larga quanto il campo (lo "Stato Giuridico" senza valore), che e'
      // il modo in cui si vede che li' c'e' un campo. Con un valore invece la
      // larghezza la fa il testo, come nella tabella ad auto layout del legacy.
      <span
        className="readonly-value"
        title={roText || undefined}
        style={roText
          ? commonProps.style
          : { width: control.size != null ? comboWidthForSize(control.size) : 160, ...commonProps.style }}
      >
        {roText || ' '}
      </span>,
      control,
      pageType,
      onAction,
      onChange,
    );
  }

  // Remote (server-searched) combo: the detail form flags it with `remote`; an
  // editable combo inside a list row (list-data mode) omits that flag but is
  // still a server-searched List — recognise it by having a controlName and no
  // baked-in static options.
  const isRemote = control.remote || (!!control.controlName && !(control.options && control.options.length));
  if (isRemote) {
    return withPostDecorations(
      <RemoteCombo
        control={control}
        commonProps={commonProps}
        value={control.value}
        widthStyle={widthStyle}
        onChange={handleChange}
        rawOnChange={onChange}
      />,
      control,
      pageType,
      onAction,
      onChange,
    );
  }

  return withPostDecorations(
    <Select
      {...commonProps}
      // Il rosso dell'obbligatorio segue il valore ATTUALE (SXADV-5754.2).
      status={mandatoryStatus(control, selected ?? '')}
      ref={selectRef}
      value={selected}
      open={open}
      showSearch
      searchValue={search}
      onFocus={onFocus}
      onBlur={onBlur}
      onMouseDown={openIfEmpty}
      optionFilterProp="label"
      defaultActiveFirstOption={false}
      // The trigger honors the ViewItem `size` (e.g. size=10 → 96px), but the
      // option text is often wider than the trigger (GenericList recoverable
      // numbers, long code-table labels). Don't pin the popup to the narrow
      // trigger width or options get clipped/truncated — let it size to content
      // (antd floors it at the trigger width). SXADV-5461.1 follow-up.
      popupMatchSelectWidth={false}
      suffixIcon={<DownOutlined className="combo-chevron" onMouseDown={toggleFromTrigger} />}
      style={widthStyle}
      onChange={handleSelectChange}
      onKeyDown={onKeyDown}
      onSearch={handleSearch}
      onDropdownVisibleChange={handleOpenChange}
      options={(() => {
        const opts = (control.options || []).map((o) => ({ value: o.value, label: o.text }));
        // In list-data mode a local combo may ship only value + displayValue,
        // not its full option list — seed the current value so it shows its
        // label instead of the raw key.
        if (selected && !opts.some((o) => o.value === selected) && control.displayValue) {
          opts.unshift({ value: selected, label: String(control.displayValue) });
        }
        return opts;
      })()}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default ComboControl;
