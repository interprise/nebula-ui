import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Input, InputNumber, DatePicker, Select, Checkbox } from 'antd';
import type { ICellEditorParams, ICellRendererParams } from 'ag-grid-community';
import dayjs from 'dayjs';
import { fetchComboOptions } from '../services/api';

// Column metadata from server (attached via cellEditorParams / cellRendererParams)
interface ColMeta {
  type?: string;
  name?: string;
  size?: number;
  maxLength?: number;
  decimals?: number;
  format?: string;
  mandatory?: boolean;
  options?: { value: string; text: string }[];
  codeTableName?: string;
  remote?: boolean;
  controlName?: string;
  reload?: string;
  command?: string;
  option1?: string;
}

/** Text cell editor — wraps Ant Input */
export const TextCellEditor = React.forwardRef(
  (props: ICellEditorParams & { colMeta?: ColMeta }, ref) => {
    const [value, setValue] = useState(props.value ?? '');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, []);

    React.useImperativeHandle(ref, () => ({
      getValue: () => value,
    }));

    return (
      <Input
        ref={inputRef as React.Ref<any>}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={props.colMeta?.maxLength}
        size="small"
        style={{ width: '100%', height: '100%' }}
      />
    );
  }
);
TextCellEditor.displayName = 'TextCellEditor';

/** Number cell editor — wraps Ant InputNumber */
export const NumberCellEditor = React.forwardRef(
  (props: ICellEditorParams & { colMeta?: ColMeta }, ref) => {
    const meta = props.colMeta;
    const precision = meta?.decimals ?? (meta?.type === 'money' ? 2 : undefined);
    const [value, setValue] = useState<number | null>(
      props.value != null && props.value !== '' ? Number(props.value) : null
    );
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, []);

    React.useImperativeHandle(ref, () => ({
      getValue: () => (value != null ? String(value) : ''),
    }));

    return (
      <InputNumber
        ref={inputRef as React.Ref<any>}
        value={value}
        onChange={(v) => setValue(v)}
        precision={precision}
        size="small"
        style={{ width: '100%' }}
      />
    );
  }
);
NumberCellEditor.displayName = 'NumberCellEditor';

/** Date cell editor — wraps Ant DatePicker */
export const DateCellEditor = React.forwardRef(
  (props: ICellEditorParams & { colMeta?: ColMeta }, ref) => {
    const fmt = props.colMeta?.format || 'DD/MM/YYYY';
    const [value, setValue] = useState<dayjs.Dayjs | null>(() => {
      if (!props.value) return null;
      const d = dayjs(props.value, fmt);
      return d.isValid() ? d : null;
    });

    React.useImperativeHandle(ref, () => ({
      getValue: () => (value ? value.format(fmt) : ''),
    }));

    return (
      <DatePicker
        value={value}
        onChange={(d) => setValue(d)}
        format={fmt}
        size="small"
        style={{ width: '100%' }}
        autoFocus
        open
      />
    );
  }
);
DateCellEditor.displayName = 'DateCellEditor';

/** Combo cell editor — Select with static options (CodeTable) */
export const ComboCellEditor = React.forwardRef(
  (props: ICellEditorParams & { colMeta?: ColMeta }, ref) => {
    const [value, setValue] = useState(props.value ?? '');
    const options = props.colMeta?.options || [];

    React.useImperativeHandle(ref, () => ({
      getValue: () => value,
    }));

    return (
      <Select
        value={value}
        onChange={(v) => setValue(v)}
        options={options.map((o) => ({ value: o.value, label: o.text }))}
        size="small"
        style={{ width: '100%' }}
        autoFocus
        defaultOpen
      />
    );
  }
);
ComboCellEditor.displayName = 'ComboCellEditor';

/** Remote combo cell editor — Select with async search */
export const RemoteComboCellEditor = React.forwardRef(
  (props: ICellEditorParams & { colMeta?: ColMeta; sid?: string }, ref) => {
    const [value, setValue] = useState(props.value ?? '');
    const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const meta = props.colMeta;
    const sid = props.sid || 'S1';
    // Get navpath from the row's view path context
    const navpath = (props as unknown as Record<string, unknown>).navpath as string || '';

    const handleSearch = useCallback(
      async (query: string) => {
        if (!meta?.controlName) return;
        setLoading(true);
        try {
          const results = await fetchComboOptions(navpath, meta.controlName, query, sid);
          setOptions(results.map((r) => ({ value: r.value, label: r.text })));
        } finally {
          setLoading(false);
        }
      },
      [meta?.controlName, navpath, sid]
    );

    // Initial load
    useEffect(() => {
      handleSearch('');
    }, [handleSearch]);

    React.useImperativeHandle(ref, () => ({
      getValue: () => value,
    }));

    return (
      <Select
        showSearch
        value={value}
        onChange={(v) => setValue(v)}
        onSearch={handleSearch}
        options={options}
        loading={loading}
        filterOption={false}
        size="small"
        style={{ width: '100%' }}
        autoFocus
        defaultOpen
      />
    );
  }
);
RemoteComboCellEditor.displayName = 'RemoteComboCellEditor';

/** Boolean cell renderer — clickable Checkbox (not an editor, toggles on click).
 *  Checks editability from row data _editable_{colIdx} flag, not from colDef.editable
 *  (since AG Grid's editable would intercept clicks and open a text editor).
 *  Calls onBooleanChange directly instead of relying on AG Grid's onCellValueChanged
 *  (which doesn't fire for columns with editable=false). */
export const BooleanCellRenderer: React.FC<ICellRendererParams & {
  onBooleanChange?: (fieldName: string, value: string) => void;
}> = (props) => {
  const val = props.value;
  const isChecked = val === 'true' || val === true || val === '1' || val === 'Y' || val === 'S';
  const [checked, setChecked] = useState(isChecked);

  // Sync with external value changes (e.g. grid re-render)
  useEffect(() => { setChecked(isChecked); }, [isChecked]);

  // Derive column index from field name (e.g. "col_4" → 4)
  const field = props.colDef?.field;
  const colIdx = field ? parseInt(field.replace('col_', ''), 10) : NaN;
  const isEditable = !isNaN(colIdx) && !!props.node?.data?.[`_editable_${colIdx}`];

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isEditable) return;
    const newVal = checked ? 'false' : 'true';
    setChecked(!checked);
    // Update AG Grid data directly
    const node = props.node;
    const colId = props.column?.getColId();
    if (node && colId) {
      node.setDataValue(colId, newVal);
    }
    // Notify parent directly (AG Grid won't fire onCellValueChanged for editable=false)
    if (props.onBooleanChange && field) {
      props.onBooleanChange(field, newVal);
    }
  }, [checked, isEditable, props.node, props.column, props.onBooleanChange, field]);

  return (
    <div onClick={handleClick} style={{ cursor: isEditable ? 'pointer' : 'default' }}>
      <Checkbox checked={checked} disabled={!isEditable} />
    </div>
  );
};

/** Maps control type to cell editor component name (registered with AG Grid) */
export function getCellEditorForType(type?: string): string | undefined {
  switch (type) {
    case 'text':
    case 'password':
      return 'textCellEditor';
    case 'number':
    case 'money':
      return 'numberCellEditor';
    case 'date':
      return 'dateCellEditor';
    case 'combo':
      return 'comboCellEditor';
    default:
      return undefined;
  }
}

/** Check if a control type should use a cell renderer instead of editor (e.g. boolean) */
export function isBooleanType(type?: string): boolean {
  return type === 'boolean' || type === 'checkbox';
}

/** Registry of custom cell editor components for AG Grid */
export const cellEditorComponents = {
  textCellEditor: TextCellEditor,
  numberCellEditor: NumberCellEditor,
  dateCellEditor: DateCellEditor,
  comboCellEditor: ComboCellEditor,
  remoteComboCellEditor: RemoteComboCellEditor,
};
