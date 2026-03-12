import React from 'react';
import type { CustomControlProps } from '../customControls';
import { WorkflowPill } from '../ControlRenderer';

const WorkflowStatusControl: React.FC<CustomControlProps> = ({ control }) => {
  const states = control.states as Array<{value: string; text: string}> | undefined;
  const rawValue = (control.value ?? '') as string;
  const decoded = states?.find(s => s.value === rawValue)?.text;
  const text = decoded ?? (control.displayValue as string) ?? rawValue;
  if (!text) return null;
  return <WorkflowPill state={text} />;
};

export default WorkflowStatusControl;
