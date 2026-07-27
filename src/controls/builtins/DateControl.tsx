import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { DatePicker, TimePicker, Input } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, useCommitReload, useSyncedValue, javaToDayjsFormat, useFlexibleDateBlur, useRestorePickerFocus } from '../helpers';

/** Field changes flow through `handleFieldChange` in Shell, which writes to
 *  a ref without setState — controlled inputs that re-apply their `value`
 *  prop after user interaction (DatePicker, TimePicker) therefore visually
 *  revert because the prop hasn't moved. We hold the picked value in local
 *  state and re-sync only when the upstream `control.value` actually
 *  changes (server round-trip), matching the behavior plain `<Input>` gets
 *  for free thanks to DOM-level value retention. */
function useLocalDayjs(controlValue: unknown, fmt: string): [Dayjs | null, (v: Dayjs | null) => void] {
  const parse = (v: unknown): Dayjs | null => (v ? dayjs(v as string, fmt) : null);
  const [local, setLocal] = useState<Dayjs | null>(() => parse(controlValue));
  const lastSeenRef = useRef<unknown>(controlValue);
  useEffect(() => {
    if (controlValue !== lastSeenRef.current) {
      lastSeenRef.current = controlValue;
      setLocal(parse(controlValue));
    }
    // parse() depends on `fmt` but the format is stable per control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlValue]);
  return [local, setLocal];
}

export const DateControl: ControlComponent = ({ control, onAction, onChange }) => {
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
  return (
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
    />
  );
};

export const TimeControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const [value, setValue] = useLocalDayjs(control.value, 'HH:mm');
  const pickerRef = useRef<ComponentRef<typeof TimePicker>>(null);
  const restorePickerFocus = useRestorePickerFocus(pickerRef);
  return (
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
    />
  );
};

export const TimestampControl: ControlComponent = ({ control, onAction, onChange }) => {
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
  return (
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
    />
  );
};

export const DurataControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  const [value, setValue] = useSyncedValue(control.value);
  return (
    <Input
      {...commonProps}
      value={value}
      placeholder={control.format}
      onChange={(e) => { setValue(e.target.value); store(e.target.value); }}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
};
