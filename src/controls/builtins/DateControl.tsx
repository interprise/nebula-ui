import { useEffect, useRef, useState } from 'react';
import { DatePicker, TimePicker, Input } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, javaToDayjsFormat } from '../helpers';

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
  return (
    <DatePicker
      {...commonProps}
      value={value}
      format={dateFmt}
      style={{ minWidth: 96 }}
      onChange={(d, dateStr) => {
        setValue(d);
        handleChange(dateStr);
      }}
    />
  );
};

export const TimeControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const [value, setValue] = useLocalDayjs(control.value, 'HH:mm');
  return (
    <TimePicker
      {...commonProps}
      value={value}
      format="HH:mm"
      style={{ minWidth: 95 }}
      onChange={(t, timeStr) => {
        setValue(t);
        handleChange(timeStr);
      }}
    />
  );
};

export const TimestampControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const tsFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY HH:mm';
  const [value, setValue] = useLocalDayjs(control.value, tsFmt);
  return (
    <DatePicker
      {...commonProps}
      showTime
      value={value}
      format={tsFmt}
      style={{ minWidth: 170 }}
      onChange={(d, dateStr) => {
        setValue(d);
        handleChange(dateStr);
      }}
    />
  );
};

export const DurataControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  return (
    <Input
      {...commonProps}
      value={control.value as string}
      placeholder={control.format}
      onChange={(e) => handleChange(e.target.value)}
    />
  );
};
