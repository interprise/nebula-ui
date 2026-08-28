import { useRef, type ComponentRef } from 'react';
import { DatePicker, TimePicker, Input } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, useCommitReload, useSyncedDerived, useSyncedValue, javaToDayjsFormat, useFlexibleDateBlur, useRestorePickerFocus } from '../helpers';
import { withPostDecorations } from '../decorations';

/** Field changes flow through `handleFieldChange` in Shell, which writes to
 *  a ref without setState — controlled inputs that re-apply their `value`
 *  prop after user interaction (DatePicker, TimePicker) therefore visually
 *  revert because the prop hasn't moved. We hold the picked value in local
 *  state, parsed out of the server's formatted string.
 *
 *  Re-syncing on a *changed* `control.value` alone is not enough: a date the
 *  user typed into an empty field never reached the server as a value of this
 *  control (no `reload`, so no round-trip), so the brand-new record that
 *  "Salva+" answers with is null exactly where the field was null before —
 *  prop unmoved, stale date left on screen (SXADV-5810, the same shape
 *  SXADV-5014.1 fixed for text and combos; the fields that DID clear were the
 *  ones a server round-trip had filled in). `useSyncedDerived` therefore
 *  re-syncs on the DataVersionContext bump too, i.e. whenever the form was
 *  re-rendered from a server payload. */
function useLocalDayjs(controlValue: unknown, fmt: string): [Dayjs | null, (v: Dayjs | null) => void] {
  return useSyncedDerived(controlValue, (v) => (v ? dayjs(v as string, fmt) : null));
}

export const DateControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const dateFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY';
  const [value, setValue] = useLocalDayjs(control.value, dateFmt);
  const pickerRef = useRef<ComponentRef<typeof DatePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  const commit = (d: Dayjs | null, dateStr: string) => {
    setValue(d);
    handleChange(dateStr);
  };
  const onBlur = useFlexibleDateBlur(dateFmt, commit, value);
  return withPostDecorations(
    <DatePicker
      {...commonProps}
      ref={pickerRef}
      value={value}
      format={dateFmt}
      placeholder=""
      style={{ minWidth: 96 }}
      preserveInvalidOnBlur
      onChange={(d, dateStr) => { commit(d, dateStr as string); restorePickerFocus(); }}
      onBlur={onBlur}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export const TimeControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const [value, setValue] = useLocalDayjs(control.value, 'HH:mm');
  const pickerRef = useRef<ComponentRef<typeof TimePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  return withPostDecorations(
    <TimePicker
      {...commonProps}
      ref={pickerRef}
      value={value}
      format="HH:mm"
      placeholder=""
      style={{ minWidth: 95 }}
      onChange={(t, timeStr) => {
        setValue(t);
        handleChange(timeStr);
        restorePickerFocus();
      }}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export const TimestampControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const tsFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY HH:mm';
  const [value, setValue] = useLocalDayjs(control.value, tsFmt);
  const pickerRef = useRef<ComponentRef<typeof DatePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  const commit = (d: Dayjs | null, dateStr: string) => {
    setValue(d);
    handleChange(dateStr);
  };
  const onBlur = useFlexibleDateBlur(tsFmt, commit, value);
  return withPostDecorations(
    <DatePicker
      {...commonProps}
      ref={pickerRef}
      showTime
      value={value}
      format={tsFmt}
      placeholder=""
      style={{ minWidth: 170 }}
      preserveInvalidOnBlur
      onChange={(d, dateStr) => { commit(d, dateStr as string); restorePickerFocus(); }}
      onBlur={onBlur}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export const DurataControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  return withPostDecorations(
    <Input
      {...commonProps}
      value={value}
      placeholder={control.format}
      onChange={(e) => { setValue(e.target.value); store(e.target.value); }}
      onBlur={commit}
      onPressEnter={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};
