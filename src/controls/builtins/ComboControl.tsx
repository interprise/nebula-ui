import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Select } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import type { UIControl } from '../../types/ui';
import { useCommonProps, useControlChange, getTextMaxWidth, comboWidthForSize, useSelectKeys, useSyncedState, useSelectOpen, getFieldName } from '../helpers';
import type { CommonInputProps } from '../helpers';
import { withPostDecorations } from '../decorations';
import { SidContext, PathContext } from '../../components/ViewRenderer';
import * as api from '../../services/api';

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
  const handleChange = useCallback((val: unknown) => {
    setSelected((val as string) || undefined);
    if (!val) setOpen(false); // clearing (× or Canc) closes the list
    onChange(val);
  }, [onChange, setSelected, setOpen]);

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
    setOpen(true); // typing opens the list
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchOptions(query), 300);
  }, [fetchOptions, setOpen]);

  // Open the list, seeding the options with an unfiltered fetch on first open.
  // Shared by the trigger-arrow click and the Ctrl+Space keyboard shortcut.
  const openList = useCallback(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      fetchOptions('');
    }
    setOpen(true);
  }, [fetchOptions, setOpen]);

  // Trigger-arrow click: the only mouse gesture that opens the list.
  // preventDefault keeps focus from bouncing; stopPropagation blocks antd's own
  // open-on-click.
  const toggleFromTrigger = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) setOpen(false);
    else openList();
  }, [open, openList, setOpen]);

  // Esc = undo: restore the server baseline (`value`) locally + into formValues,
  // no reload. `selected` re-syncs from the server on the next real round-trip.
  const restore = useCallback((val: string | undefined) => {
    setSelected(val);
    rawOnChange(getFieldName(control), val ?? '');
  }, [control, rawOnChange, setSelected]);
  const closeList = useCallback(() => setOpen(false), [setOpen]);
  const onKeyDown = useSelectKeys(selected, value, handleChange, restore, closeList, openList);

  return (
    <Select
      {...commonProps}
      value={selected}
      open={open}
      showSearch
      defaultActiveFirstOption={false}
      filterOption={false}
      // Same as the local combo: don't clip the option popup to a narrow
      // size-derived trigger width — let it size to its content.
      popupMatchSelectWidth={false}
      suffixIcon={<DownOutlined className="combo-chevron" onMouseDown={toggleFromTrigger} />}
      loading={fetching}
      notFoundContent={fetching ? 'Caricamento...' : (hasFetched ? 'Nessun risultato' : null)}
      onDropdownVisibleChange={onOpenChange}
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
  const handleSelectChange = useCallback((val: unknown) => {
    setSelected((val as string) || undefined);
    if (!val) setOpen(false); // clearing (× or Canc) closes the list
    handleChange(val);
  }, [handleChange, setSelected, setOpen]);
  const openList = useCallback(() => setOpen(true), [setOpen]);
  const toggleFromTrigger = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(prev => !prev);
  }, [setOpen]);
  // Esc = undo: restore the server baseline (`control.value`) locally + into
  // formValues, no reload.
  const restore = useCallback((val: string | undefined) => {
    setSelected(val);
    onChange(getFieldName(control), val ?? '');
  }, [control, onChange, setSelected]);
  const closeList = useCallback(() => setOpen(false), [setOpen]);
  const onKeyDown = useSelectKeys(selected, control.value, handleSelectChange, restore, closeList, openList);
  const textMaxWidth = getTextMaxWidth(control);
  // Width handling (SXADV-5461.1). antd Select is a <div> with no intrinsic
  // width, so `width:100%` alone collapses it to ~1 char inside an auto-layout
  // table column or a flex slot (unlike a text <input>, which has a default
  // intrinsic width). When the ViewItem declares a `size`, honor it like the
  // legacy UI: render the combo at its size-derived width instead of stretching
  // to (or collapsing within) the cell. Without a size, fill the cell but floor
  // the width so it can't collapse.
  const widthStyle: React.CSSProperties = control.size != null
    ? { width: comboWidthForSize(control.size), maxWidth: '100%', flexShrink: 0 }
    : { width: '100%', maxWidth: textMaxWidth, minWidth: 160 };

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
      value={selected}
      open={open}
      showSearch
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
      onSearch={() => setOpen(true)}
      onDropdownVisibleChange={onOpenChange}
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
