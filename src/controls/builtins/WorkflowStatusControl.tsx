import type { ControlComponent } from '../types';
import { WorkflowPill } from '../WorkflowPill';

const WorkflowStatusControl: ControlComponent = ({ control }) => {
  const states = control.states as Array<{ value: string; text: string }> | undefined;
  const rawValue = (control.value ?? '') as string;
  const decoded = states?.find(s => s.value === rawValue)?.text;
  const text = decoded ?? (control.displayValue as string) ?? rawValue;
  if (!text) return null;
  return <WorkflowPill state={text} />;
};

export default WorkflowStatusControl;
