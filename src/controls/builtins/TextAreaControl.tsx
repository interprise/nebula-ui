import { useLayoutEffect, useRef, useState } from 'react';
import { Input } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { textareaFitRows } from './textareaFitRows';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedValue } from '../helpers';
import { withPostDecorations } from '../decorations';

const TextAreaControl: ControlComponent = ({ control, pageType, onChange, onAction }) => {
  const { store, commit } = useCommitReload(control, onChange, onAction);
  // Controlled + re-synced from control.value, like every other text control.
  // An uncontrolled `defaultValue` is only read at mount, and the control's
  // React key is the field id (stable across records), so React reused the
  // same instance on record navigation and the field kept showing the previous
  // record's text (SXADV-5527). useSyncedValue re-applies control.value when a
  // server round-trip (record navigation, reload) changes it.
  const [value, setValue] = useSyncedValue(control.value);
  const commonProps = useCommonProps(control, value); // SXADV-5754.2
  const minRows = control.rows || 3;
  const contentLines = value.split('\n').length;
  const [fittedRows, setFittedRows] = useState(0);
  const rows = Math.max(minRows, Math.min(contentLines + 1, 30), fittedRows);
  // Campo unico di un tab (SQL Generato, tab SQL dei Profili): le righe si misurano
  // sul testo a capo, altrimenti un SQL senza ritorni restava in tre righe in un tab
  // vuoto (SXADV-5859.g). Altrove il layout non cambia. Si misura col ref del campo:
  // antd non inoltra `rows` come stato, e in un tab nascosto l'altezza e' zero.
  const fieldRef = useRef<TextAreaRef>(null);
  useLayoutEffect(() => {
    const el = fieldRef.current?.resizableTextArea?.textArea;
    if (!el) return undefined;
    const measure = () => {
      const panel = el.closest('.split-tab-panel');
      if (el.clientWidth === 0) return; // tab nascosto: si misura quando riappare
      if (!panel || panel.querySelector('.ag-root-wrapper')
        || Array.from(panel.querySelectorAll('input, textarea, select')).filter((f) => f.getClientRects().length > 0).length !== 1) {
        setFittedRows(0);
        return;
      }
      const css = getComputedStyle(el);
      // Accorciare il campo limiterebbe lo scorrimento del tab: si rimette, prima del disegno.
      const scroller = el.closest('.tab-content');
      const scrollTop = scroller?.scrollTop ?? 0;
      const saved = el.rows;
      el.rows = 1;
      const next = textareaFitRows(el.scrollHeight, parseFloat(css.lineHeight), parseFloat(css.paddingTop) + parseFloat(css.paddingBottom));
      el.rows = saved;
      if (scroller) scroller.scrollTop = scrollTop;
      setFittedRows(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);
  return withPostDecorations(
    <Input.TextArea
      ref={fieldRef}
      {...commonProps}
      value={value}
      rows={rows}
      style={{ width: '100%', maxHeight: '50vh', resize: 'vertical', ...commonProps.style }}
      onChange={(e) => {
        setValue(e.target.value);
        store(e.target.value);
      }}
      onBlur={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default TextAreaControl;
