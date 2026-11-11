import { useCallback, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { Select } from 'antd';
import { DownOutlined } from '@ant-design/icons';

export interface HeaderContextSelectProps {
  value: string | undefined;
  options: { value: string; text: string }[];
  onChange: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
  'aria-label'?: string;
}

const ignoreSearch = () => {};

/** Tasti che aprono la tendina da tastiera: Freccia giu' (anche con Alt, il
 *  gesto dei <select> nativi), Invio e Spazio. */
const isOpenKey = (e: KeyboardEvent) =>
  !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ');

/** Selettore di Azienda / Sede di accesso nella testata (SXADV-6137).
 *
 *  Una `Select` antd v6 non tiene il valore scelto nell'`<input>`: lo scrive
 *  come nodo di testo e ci appoggia sopra un input VUOTO largo quanto la
 *  casella, quindi la descrizione che si legge non si raggiunge col mouse —
 *  niente doppio clic sul codice azienda, niente selezione parziale, niente
 *  CTRL+C. Nel legacy era una combo ExtJS `editable: false`, cioe' un input in
 *  sola lettura che CONTENEVA la descrizione (ui.js, opzioni di `cbAz`/`cbSed`).
 *  Il rimedio dei lookup dei form (SXADV-5641) qui non arrivava: la testata non
 *  passa da ComboControl.
 *
 *  Stesso modello di quei lookup: a tendina CHIUSA la descrizione sta
 *  nell'input (`showSearch` + `searchValue`; `onSearch` la ignora, cosi' battere
 *  un tasto non la cambia) e il clic sul testo serve a selezionarlo, quindi NON
 *  apre la tendina. La aprono la freccia, Freccia giu', Invio e Spazio
 *  (tutti gesti che rc-select gestisce da se'). A
 *  tendina APERTA l'input torna vuoto: con un testo di ricerca rc-select non
 *  trova piu' la voce corrente (cerca le voci il cui valore INIZIA con quel
 *  testo), lascia attiva la prima, e un Tab o un Invio cambiava azienda senza
 *  volerlo. Vuoto, evidenzia e mostra la voce corrente. */
export function HeaderContextSelect({
  value,
  options,
  onChange,
  loading,
  disabled,
  style,
  'aria-label': ariaLabel,
}: HeaderContextSelectProps) {
  const label = useMemo(() => {
    if (value == null || value === '') return '';
    return options.find((o) => o.value === value)?.text ?? value;
  }, [value, options]);
  const [open, setOpen] = useState(false);
  // Disabilitato (cambio di contesto in corso): la tendina si chiude.
  if (open && disabled) setOpen(false);
  // Il gesto che ha chiesto l'apertura: rc-select la chiede da se' anche al
  // mousedown sul testo e a ogni tasto battuto, e qui quei due non devono aprire.
  const gestureRef = useRef<'text' | 'other'>('other');
  const onMouseDownCapture = useCallback((e: MouseEvent<HTMLSpanElement>) => {
    gestureRef.current = (e.target as HTMLElement).tagName === 'INPUT' ? 'text' : 'other';
  }, []);
  const onKeyDownCapture = useCallback((e: KeyboardEvent<HTMLSpanElement>) => {
    gestureRef.current = isOpenKey(e) ? 'other' : 'text';
  }, []);
  const onOpenChange = useCallback((next: boolean) => {
    if (next && gestureRef.current === 'text') return;
    setOpen(next);
  }, []);
  const handleChange = useCallback((v: string) => {
    setOpen(false);
    onChange(v);
  }, [onChange]);
  return (
    <span
      className="header-select-wrap"
      onMouseDownCapture={onMouseDownCapture}
      onKeyDownCapture={onKeyDownCapture}
      // La larghezza (e il restringersi nella testata) la porta il contenitore:
      // e' lui l'elemento flex della riga.
      style={{ display: 'inline-flex', ...style }}
    >
      <Select
        size="small"
        className="header-select"
        value={value}
        onChange={handleChange}
        loading={loading}
        disabled={disabled}
        style={{ width: '100%', minWidth: 0 }}
        options={options}
        fieldNames={{ label: 'text', value: 'value' }}
        open={open}
        onOpenChange={onOpenChange}
        showSearch
        searchValue={open ? '' : label}
        onSearch={ignoreSearch}
        filterOption={false}
        // Con `showSearch` antd mette la lente al posto della freccia a tendina
        // aperta: qui non si cerca, la freccia resta quella della combo. Durante
        // il cambio di contesto lascia posto alla rotella di `loading`, che un
        // `suffixIcon` esplicito altrimenti nasconderebbe.
        suffixIcon={loading ? undefined : <DownOutlined />}
        aria-label={ariaLabel}
      />
    </span>
  );
}
