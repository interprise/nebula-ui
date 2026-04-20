import { DatePicker, TimePicker, Input } from 'antd';
import dayjs from 'dayjs';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, javaToDayjsFormat } from '../helpers';

export const DateControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const dateFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY';
  return (
    <DatePicker
      {...commonProps}
      value={control.value ? dayjs(control.value as string, dateFmt) : null}
      format={dateFmt}
      style={{ minWidth: 96 }}
      onChange={(_d, dateStr) => handleChange(dateStr)}
    />
  );
};

export const TimeControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  return (
    <TimePicker
      {...commonProps}
      value={control.value ? dayjs(control.value as string, 'HH:mm') : null}
      format="HH:mm"
      style={{ minWidth: 95 }}
      onChange={(_t, timeStr) => handleChange(timeStr)}
    />
  );
};

export const TimestampControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const tsFmt = javaToDayjsFormat(control.format) || 'DD/MM/YYYY HH:mm';
  return (
    <DatePicker
      {...commonProps}
      showTime
      value={control.value ? dayjs(control.value as string, tsFmt) : null}
      format={tsFmt}
      style={{ minWidth: 170 }}
      onChange={(_d, dateStr) => handleChange(dateStr)}
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
