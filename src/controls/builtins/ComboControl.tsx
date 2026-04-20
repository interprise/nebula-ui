import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import type { ControlComponent } from '../types';
import type { UIControl } from '../../types/ui';
import { useCommonProps, useControlChange, getTextMaxWidth } from '../helpers';
import type { CommonInputProps } from '../helpers';
import { withPostDecorations } from '../decorations';
import { SidContext } from '../../components/ViewRenderer';
import * as api from '../../services/api';

/** Remote combo (ListUIControl) — fetches options from the server as the user types. */
const RemoteCombo: React.FC<{
  control: UIControl;
  commonProps: CommonInputProps;
  value: unknown;
  maxWidth?: number;
  onChange: (val: unknown) => void;
}> = ({ control, commonProps, value, maxWidth, onChange }) => {
  const sid = useContext(SidContext);
  const displayText = control.displayText as string | undefined;
  const navpath = control.navpath as string;
  const controlName = control.controlName as string || control.name || '';

  const [options, setOptions] = useState<{ value: string; label: string }[]>(
    value ? [{ value: value as string, label: displayText || (value as string) }] : []
  );
  const [fetching, setFetching] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (value) {
      setOptions(prev => {
        const exists = prev.some(o => o.value === value);
        if (exists) return prev;
        return [{ value: value as string, label: displayText || (value as string) }, ...prev];
      });
    }
  }, [value, displayText]);

  const loadedRef = useRef(false);

  const fetchOptions = useCallback(async (query: string) => {
    setFetching(true);
    try {
      const results = await api.fetchComboOptions(navpath, controlName, query, sid);
      setOptions(results.map(r => ({ value: r.value, label: r.text })));
    } catch {
      // keep existing options on error
    } finally {
      setFetching(false);
      setHasFetched(true);
    }
  }, [navpath, controlName, sid]);

  const handleSearch = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(query), 300);
  }, [fetchOptions]);

  const handleDropdownOpen = useCallback((open: boolean) => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      fetchOptions('');
    }
  }, [fetchOptions]);

  return (
    <Select
      {...commonProps}
      value={value as string || undefined}
      showSearch
      filterOption={false}
      loading={fetching}
      notFoundContent={fetching ? 'Caricamento...' : (hasFetched ? 'Nessun risultato' : null)}
      onDropdownVisibleChange={handleDropdownOpen}
      style={{ width: '100%', ...(maxWidth && { maxWidth }) }}
      options={options}
      onSearch={handleSearch}
      onChange={onChange}
    />
  );
};

const ComboControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const textMaxWidth = getTextMaxWidth(control);

  if (control.remote) {
    return withPostDecorations(
      <RemoteCombo
        control={control}
        commonProps={commonProps}
        value={control.value}
        maxWidth={textMaxWidth}
        onChange={handleChange}
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
      value={(control.value as string) || undefined}
      showSearch
      optionFilterProp="label"
      allowClear
      style={{ width: '100%', maxWidth: textMaxWidth }}
      onChange={handleChange}
      options={(control.options || []).map((o) => ({ value: o.value, label: o.text }))}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export default ComboControl;
