import { Select } from 'antd';
import type { ControlComponent } from '../types';
import { WorkflowPill } from '../WorkflowPill';

const WorkflowStatusControl: ControlComponent = ({ control, onChange }) => {
  if (control.visible === false) return null;
  // Query mode: the server emits selectable workflow-state options so the
  // "Stato" filter renders an input dropdown (SXADV-5461.3). Detail/list mode
  // emits displayValue/states for the read-only pill instead.
  const options = control.options as Array<{ value: string; text: string }> | undefined;
  if (options && options.length > 0) {
    return (
      <Select
        id={control.id}
        value={(control.value as string) || undefined}
        onChange={(v) => control.name && onChange(control.name, v)}
        allowClear
        style={{ minWidth: 160 }}
        options={options.map((o) => ({ value: o.value, label: o.text }))}
      />
    );
  }
  const states = control.states as Array<{ value: string; text: string }> | undefined;
  const rawValue = (control.value ?? '') as string;
  const decoded = states?.find(s => s.value === rawValue)?.text;
  const text = decoded ?? (control.displayValue as string) ?? rawValue;
  if (!text) return null;
  return <WorkflowPill state={text} />;
};

export default WorkflowStatusControl;
