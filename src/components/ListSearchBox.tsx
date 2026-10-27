import React, { useCallback, useRef, useState } from 'react';
import { Button, Input, Select, Tag, type InputRef } from 'antd';
import { CloseOutlined, DownOutlined, FilterOutlined, LoadingOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import type { TextFilter } from '../types/ui';
import { useFeedback } from '../hooks/feedback';
import {
  EMPTY_SEARCH,
  FILTER_DIRTY_MESSAGE,
  FILTER_UNSUPPORTED_MESSAGE,
  MAX_CONTINUATIONS,
  filterLabel,
  filterParams,
  locateParams,
  notFoundMessage,
  readFiltered,
  readLocated,
  searchKey,
  stoppedMessage,
  tooManyMessage,
  type SearchColumn,
  type SearchMemory,
} from './listSearch';

interface ListSearchBoxProps {
  /** Il percorso della lista, il navpath della ricerca. */
  listPath: string;
  /** Manda LocateRow al server e restituisce la risposta. */
  locate: (params: Record<string, string>) => unknown;
  /** Il server ha trovato il rigo a questa posizione e ha portato la lista sulla sua pagina. */
  onFound: (position: number) => void;
  /** Le colonne della tendina «dove cercare»; con meno di due non c'e' tendina. */
  columns?: readonly SearchColumn[];
  /** Manda FilterRows al server e restituisce la risposta; assente = niente filtro. */
  applyFilter?: (params: Record<string, string>) => unknown;
  /** Il filtro attivo sulla lista, come lo dice il server. */
  filter?: TextFilter | null;
}

const STEP_STYLE: React.CSSProperties = { width: 18, minWidth: 18, height: 18 };

/**
 * Il campo «Cerca» di una lista (SXADV-4569). Invio cerca il prossimo rigo che
 * contiene il testo, e a fine lista riprende dall'inizio; la ricerca la fa il
 * server su tutte le pagine (vedi listSearch.ts).
 */
const ListSearchBox: React.FC<ListSearchBoxProps> = ({
  listPath, locate, onFound, columns = [], applyFilter, filter,
}) => {
  const feedback = useFeedback();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  /** La colonna scelta, '' = tutte. */
  const [column, setColumn] = useState('');
  const memoryRef = useRef<SearchMemory>(EMPTY_SEARCH);
  /** La colonna in cui si e' cercato l'ultima volta: un'altra = ricerca nuova. */
  const memoryColumnRef = useRef('');
  const busyRef = useRef(false);
  const inputRef = useRef<InputRef>(null);

  // Una colonna sparita (lista ridisegnata con altre colonne) torna a «tutte»,
  // e resta tale se poi ricompare; la ricerca ricomincia.
  // (Stato corretto durante il render, lo schema di React per lo stato che
  // dipende dalle props.) La memoria non va toccata: e' legata alla colonna.
  const present = !column || columns.some((c) => c.name === column);
  const chosen = present ? column : '';
  const chosenLabel = columns.find((c) => c.name === chosen)?.label;
  if (!present) setColumn('');

  const run = useCallback(async (backward = false) => {
    const key = searchKey(text);
    if (!key || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (memoryColumnRef.current !== chosen) memoryRef.current = EMPTY_SEARCH;
      memoryColumnRef.current = chosen;
      let params = locateParams(listPath, key, memoryRef.current, undefined, backward, chosen);
      let stoppedAt = -1;
      // Una lista enorme si guarda a giri: il server si ferma al tetto di tempo
      // e dice da dove ripartire.
      for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
        const result = readLocated(await locate(params));
        // Nessuna risposta (richiesta rifiutata, errore gia' mostrato): stop.
        if (!result) return;
        if (result.more) {
          stoppedAt = result.position;
          params = locateParams(listPath, key, memoryRef.current, result, backward, chosen);
          continue;
        }
        if (result.found) {
          memoryRef.current = { text: key, lastFound: result.position };
          onFound(result.position);
        } else {
          memoryRef.current = { text: key, lastFound: -1 };
          feedback.info(notFoundMessage(key));
        }
        return;
      }
      // Finiti i giri senza aver chiuso l'elenco: lo si dice, e il prossimo
      // Invio riparte da dove si e' fermato.
      memoryRef.current = { text: key, lastFound: stoppedAt };
      feedback.info(stoppedMessage(key));
    } catch (e) {
      feedback.failure(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [text, chosen, listPath, locate, onFound, feedback]);

  // Il «Cerca» messo a filtro: la lista tiene solo i righi col testo (FilterRows,
  // lato server su tutto l'elenco). Testo vuoto = togli il filtro.
  const runFilter = useCallback(async (remove: boolean) => {
    const key = remove ? '' : searchKey(text);
    if (!applyFilter || busyRef.current || (!remove && !key)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = readFiltered(await applyFilter(filterParams(listPath, key, chosen)));
      if (!result) return;
      // Le posizioni sono cambiate: «trova il successivo» ricomincia.
      memoryRef.current = EMPTY_SEARCH;
      if (result.unsupported) feedback.info(FILTER_UNSUPPORTED_MESSAGE);
      else if (result.dirty) feedback.info(FILTER_DIRTY_MESSAGE);
      else if (result.tooMany !== undefined) feedback.info(tooManyMessage(result.tooMany));
      else if (!remove && result.count === 0) feedback.info(notFoundMessage(key));
    } catch (e) {
      feedback.failure(e);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [text, chosen, listPath, applyFilter, feedback]);
  const filterColumnLabel = filter?.col ? columns.find((c) => c.name === filter.col)?.label ?? filter.col : undefined;

  const input = (
    <Input
      ref={inputRef}
      className="list-search"
      size="small"
      allowClear
      placeholder={chosenLabel ? `Cerca in ${chosenLabel}` : 'Cerca'}
      aria-label="Cerca nella lista"
      aria-keyshortcuts="Enter Shift+Enter"
      value={text}
      onChange={(e) => {
        // Svuotato il campo, la ricerca ricomincia dall'inizio anche con lo stesso testo.
        if (!searchKey(e.target.value)) memoryRef.current = EMPTY_SEARCH;
        setText(e.target.value);
      }}
      // Invio il successivo, Maiusc+Invio il precedente, come il «trova» dei browser.
      onPressEnter={(e) => { e.preventDefault(); e.stopPropagation(); void run(e.shiftKey); }}
      prefix={busy ? <LoadingOutlined /> : <SearchOutlined />}
      suffix={(
        <span className="list-search-steps">
          <Button
            type="text"
            size="small"
            icon={<UpOutlined />}
            title="Precedente (Maiusc+Invio)"
            aria-label="Rigo precedente"
            disabled={busy || !searchKey(text)}
            style={STEP_STYLE}
            // Il fuoco resta nel campo: Invio continua dopo un clic.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void run(true)}
          />
          <Button
            type="text"
            size="small"
            icon={<DownOutlined />}
            title="Successivo (Invio)"
            aria-label="Rigo successivo"
            disabled={busy || !searchKey(text)}
            style={STEP_STYLE}
            // Il fuoco resta nel campo: Invio continua dopo un clic.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void run(false)}
          />
          {applyFilter && (
            <Button
              type="text"
              size="small"
              icon={<FilterOutlined />}
              title="Mostra solo i righi che lo contengono"
              aria-label="Filtra la lista"
              disabled={busy || !searchKey(text)}
              style={STEP_STYLE}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void runFilter(false)}
            />
          )}
        </span>
      )}
      // Nelle bande strette (griglie in un pannello) il campo si stringe
      // invece di spingere la banda oltre il bordo.
      style={{ width: 240, minWidth: 120, flexShrink: 1 }}
    />
  );
  const filterTag = filter && (
    <Tag
      className="list-search-filter"
      color="processing"
      style={{ marginInlineEnd: 0, whiteSpace: 'nowrap' }}
    >
      Filtro: {filterLabel(filter.text, filterColumnLabel)}
      {/* Un pulsante vero, non la x di Tag: si raggiunge col Tab e ha un nome. */}
      <Button
        type="text"
        size="small"
        icon={<CloseOutlined />}
        title="Togli il filtro"
        aria-label="Togli il filtro"
        disabled={busy}
        style={{ ...STEP_STYLE, marginInlineStart: 4 }}
        onClick={() => void runFilter(true)}
      />
    </Tag>
  );
  if (columns.length < 2 && !filterTag) return input;
  return (
    <span className="list-search-group" style={{ display: 'inline-flex', gap: 4, alignItems: 'center', minWidth: 0, flexShrink: 1 }}>
      {columns.length >= 2 && <Select
        className="list-search-column"
        size="small"
        aria-label="Dove cercare"
        value={chosen}
        onChange={(v: string) => {
          // Un'altra colonna e' un'altra ricerca: si ricomincia dall'inizio.
          memoryRef.current = EMPTY_SEARCH;
          setColumn(v);
          // Dopo che la tendina si e' chiusa: rc-select si riprende il fuoco.
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        options={[
          { value: '', label: 'Tutte le colonne' },
          ...columns.map((c) => ({ value: c.name, label: c.label })),
        ]}
        popupMatchSelectWidth={false}
        style={{ width: 150, minWidth: 90, flexShrink: 1 }}
      />}
      {input}
      {filterTag}
    </span>
  );
};

export default ListSearchBox;
