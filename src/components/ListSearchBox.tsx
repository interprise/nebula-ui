import React, { useCallback, useRef, useState } from 'react';
import { Button, Input } from 'antd';
import { DownOutlined, LoadingOutlined, SearchOutlined, UpOutlined } from '@ant-design/icons';
import { useFeedback } from '../hooks/feedback';
import {
  EMPTY_SEARCH,
  MAX_CONTINUATIONS,
  locateParams,
  notFoundMessage,
  readLocated,
  searchKey,
  stoppedMessage,
  type SearchMemory,
} from './listSearch';

interface ListSearchBoxProps {
  /** Il percorso della lista, il navpath della ricerca. */
  listPath: string;
  /** Manda LocateRow al server e restituisce la risposta. */
  locate: (params: Record<string, string>) => unknown;
  /** Il server ha trovato il rigo a questa posizione e ha portato la lista sulla sua pagina. */
  onFound: (position: number) => void;
}

const STEP_STYLE: React.CSSProperties = { width: 18, minWidth: 18, height: 18 };

/**
 * Il campo «Cerca» di una lista (SXADV-4569). Invio cerca il prossimo rigo che
 * contiene il testo, e a fine lista riprende dall'inizio; la ricerca la fa il
 * server su tutte le pagine (vedi listSearch.ts).
 */
const ListSearchBox: React.FC<ListSearchBoxProps> = ({ listPath, locate, onFound }) => {
  const feedback = useFeedback();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const memoryRef = useRef<SearchMemory>(EMPTY_SEARCH);
  const busyRef = useRef(false);

  const run = useCallback(async (backward = false) => {
    const key = searchKey(text);
    if (!key || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      let params = locateParams(listPath, key, memoryRef.current, undefined, backward);
      let stoppedAt = -1;
      // Una lista enorme si guarda a giri: il server si ferma al tetto di tempo
      // e dice da dove ripartire.
      for (let round = 0; round <= MAX_CONTINUATIONS; round++) {
        const result = readLocated(await locate(params));
        // Nessuna risposta (richiesta rifiutata, errore gia' mostrato): stop.
        if (!result) return;
        if (result.more) {
          stoppedAt = result.position;
          params = locateParams(listPath, key, memoryRef.current, result, backward);
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
  }, [text, listPath, locate, onFound, feedback]);

  return (
    <Input
      className="list-search"
      size="small"
      allowClear
      placeholder="Cerca"
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
        </span>
      )}
      style={{ width: 240 }}
    />
  );
};

export default ListSearchBox;
