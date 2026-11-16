import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
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

/** Attesa prima di aprire dopo un clic sul testo (SXADV-6236): quanto basta
 *  perche' il secondo clic di un doppio clic la annulli. */
export const CLICK_OPEN_DELAY_MS = 250;

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
 *  un tasto non la cambia). Il clic semplice sul testo apre la tendina, come la
 *  combo legacy (SXADV-6236: aperta solo dalla freccia sembrava rotta), ma con
 *  un breve ritardo, cosi' il doppio clic e il trascinamento selezionano ancora
 *  il testo senza aprire. La aprono anche la freccia, Freccia giu', Invio e
 *  Spazio (gesti che rc-select gestisce da se'). A
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
  // mousedown sul testo e a ogni tasto battuto. Il tasto non deve aprire; il
  // clic sul testo apre, ma solo dopo CLICK_OPEN_DELAY_MS (vedi onClick).
  const gestureRef = useRef<'text' | 'other'>('other');
  // Aperta al mousedown: il clic sul testo a tendina aperta la chiude soltanto.
  const openAtMouseDownRef = useRef(false);
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => cancelPending, [cancelPending]);
  useEffect(() => { if (disabled) cancelPending(); }, [disabled, cancelPending]);
  // Aperta dal timer del clic sul testo (non dalla freccia o dalla tastiera).
  const openedByClickRef = useRef(false);
  // Ogni chiusura (Esc, scelta, blur, clic) azzera l'origine dell'apertura.
  useEffect(() => { if (!open) openedByClickRef.current = false; }, [open]);
  // Mousedown che ha chiuso la tendina per un doppio clic lento: il suo click
  // non deve fare altro.
  const swallowClickRef = useRef(false);
  const onMouseDownCapture = useCallback((e: MouseEvent<HTMLSpanElement>) => {
    // Un secondo clic (doppio clic) annulla l'apertura in attesa.
    cancelPending();
    swallowClickRef.current = false;
    const onText = (e.target as HTMLElement).tagName === 'INPUT';
    gestureRef.current = onText ? 'text' : 'other';
    // Doppio clic piu' lento del ritardo (Windows ammette fino a 500 ms fra i
    // due clic): la tendina si e' gia' aperta e ha svuotato l'input. Il
    // browser lo dice con detail >= 2, secondo il tempo di doppio clic del
    // sistema: si richiude SUBITO, in fase di cattura, cosi' la descrizione e'
    // di nuovo nell'input quando il browser seleziona la parola.
    if (onText && e.detail >= 2 && openRef.current && openedByClickRef.current) {
      openedByClickRef.current = false;
      openRef.current = false;
      flushSync(() => setOpen(false));
      swallowClickRef.current = true;
    }
    openAtMouseDownRef.current = openRef.current;
  }, [cancelPending]);
  const onKeyDownCapture = useCallback((e: KeyboardEvent<HTMLSpanElement>) => {
    cancelPending();
    gestureRef.current = isOpenKey(e) ? 'other' : 'text';
  }, [cancelPending]);
  // Clic semplice sul testo = apre, come la combo legacy (SXADV-6236). Con
  // ritardo: subito, l'input si svuoterebbe sotto il doppio clic che serve a
  // selezionare il codice azienda (SXADV-6137). Non apre se il clic ha lasciato
  // una selezione (trascinamento), se era aperta (quel clic la chiude), se nel
  // frattempo il fuoco e' andato altrove.
  const onClick = useCallback((e: MouseEvent<HTMLSpanElement>) => {
    const target = e.target as HTMLElement;
    // detail 0 = clic senza mouse (element.click(), lettori di schermo): niente
    // mousedown prima, i ref sarebbero quelli dell'ultimo clic vero. Per
    // aprire da tastiera ci sono Freccia giu', Invio e Spazio.
    if (target.tagName !== 'INPUT' || disabled || e.detail === 0) return;
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      return;
    }
    // A tendina aperta il clic sul testo la chiude (rc-select, con la ricerca
    // attiva, al mousedown sull'input la lascerebbe aperta).
    if (openAtMouseDownRef.current) {
      cancelPending();
      setOpen(false);
      return;
    }
    if (e.detail > 1) return;
    const inputEl = target as HTMLInputElement;
    const hasSelection = () => inputEl.selectionStart !== inputEl.selectionEnd;
    if (hasSelection()) return;
    cancelPending();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (hasSelection() || document.activeElement !== inputEl) return;
      gestureRef.current = 'other';
      openedByClickRef.current = true;
      setOpen(true);
    }, CLICK_OPEN_DELAY_MS);
  }, [disabled, cancelPending]);
  const onOpenChange = useCallback((next: boolean) => {
    if (next && gestureRef.current === 'text') return;
    if (!next) cancelPending();
    setOpen(next);
  }, [cancelPending]);
  const handleChange = useCallback((v: string) => {
    cancelPending();
    setOpen(false);
    onChange(v);
  }, [onChange, cancelPending]);
  return (
    <span
      className="header-select-wrap"
      onMouseDownCapture={onMouseDownCapture}
      onKeyDownCapture={onKeyDownCapture}
      onClick={onClick}
      onBlur={cancelPending}
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
