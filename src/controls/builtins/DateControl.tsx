import { useRef, type ComponentRef } from 'react';
import { DatePicker, TimePicker, Input } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, useCommitReload, useSyncedDerived, useSyncedValue, javaToDayjsFormat, useFlexibleDateBlur, useRestorePickerFocus, usePickerOpen, pickerWidthForFormat } from '../helpers';
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
  const handleChange = useControlChange(control, onChange, onAction);
  const dateFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY';
  const [value, setValue] = useLocalDayjs(control.value, dateFmt);
  // `value` locale: il rosso dell'obbligatorio si spegne appena la data e'
  // scelta, senza aspettare il giro col server (SXADV-5754.2).
  const commonProps = useCommonProps(control, value);
  const pickerRef = useRef<ComponentRef<typeof DatePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  const pickerOpen = usePickerOpen(commonProps.disabled); // SXADV-5740.0: digitare non apre il calendario
  const commit = (d: Dayjs | null, dateStr: string) => {
    setValue(d);
    handleChange(dateStr);
  };
  const [onBlur, resyncKey] = useFlexibleDateBlur(dateFmt, commit, value, () => pickerOpen.onOpenChange(false));
  return withPostDecorations(
    <DatePicker
      {...commonProps}
      key={resyncKey}
      ref={pickerRef}
      {...pickerOpen}
      allowClear={false}
      value={value}
      format={dateFmt}
      placeholder=""
      style={{ minWidth: pickerWidthForFormat(dateFmt, 10), ...commonProps.style }}
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
  const handleChange = useControlChange(control, onChange, onAction);
  const [value, setValue] = useLocalDayjs(control.value, 'HH:mm');
  const commonProps = useCommonProps(control, value); // SXADV-5754.2
  const pickerRef = useRef<ComponentRef<typeof TimePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  const pickerOpen = usePickerOpen(commonProps.disabled); // SXADV-5740.0: digitare non apre il pannello
  const commit = (t: Dayjs | null, timeStr: string) => {
    setValue(t);
    handleChange(timeStr);
  };
  // Lo stesso blur dei campi data: '1030' + Tab diventa 10:30, e Canc + Tab
  // svuota davvero. Per questo la X, che copriva l'icona, non serve piu'.
  const [onBlur, resyncKey] = useFlexibleDateBlur('HH:mm', commit, value, () => pickerOpen.onOpenChange(false));
  return withPostDecorations(
    <TimePicker
      {...commonProps}
      key={resyncKey}
      ref={pickerRef}
      {...pickerOpen}
      allowClear={false}
      value={value}
      format="HH:mm"
      placeholder=""
      style={{ minWidth: pickerWidthForFormat('HH:mm', 5), ...commonProps.style }}
      preserveInvalidOnBlur
      onChange={(t, timeStr) => { commit(t, timeStr as string); restorePickerFocus(); }}
      onBlur={onBlur}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export const TimestampControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const handleChange = useControlChange(control, onChange, onAction);
  const tsFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY HH:mm';
  const [value, setValue] = useLocalDayjs(control.value, tsFmt);
  const commonProps = useCommonProps(control, value); // SXADV-5754.2
  const pickerRef = useRef<ComponentRef<typeof DatePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  const pickerOpen = usePickerOpen(commonProps.disabled); // SXADV-5740.0: digitare non apre il calendario
  const commit = (d: Dayjs | null, dateStr: string) => {
    setValue(d);
    handleChange(dateStr);
  };
  const [onBlur, resyncKey] = useFlexibleDateBlur(tsFmt, commit, value, () => pickerOpen.onOpenChange(false));
  return withPostDecorations(
    <DatePicker
      {...commonProps}
      key={resyncKey}
      ref={pickerRef}
      {...pickerOpen}
      allowClear={false}
      showTime
      value={value}
      format={tsFmt}
      placeholder=""
      style={{ minWidth: pickerWidthForFormat(tsFmt, 16), ...commonProps.style }}
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
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  const commonProps = useCommonProps(control, value); // SXADV-5754.2
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
