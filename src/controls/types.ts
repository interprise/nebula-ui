import React from 'react';
import type { UIControl } from '../types/ui';

export interface ControlComponentProps {
  control: UIControl;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}

export type ControlComponent = React.FC<ControlComponentProps>;
