import React from 'react';
import type { UIControl } from '../types/ui';

/**
 * Props passed to custom control renderers.
 */
export interface CustomControlProps {
  control: UIControl;
  pageType?: number; // 0=QUERY, 1=LIST, 2=DETAIL
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}

type CustomControlComponent = React.FC<CustomControlProps>;

const registry = new Map<string, CustomControlComponent>();

/**
 * Register a custom control renderer for a given type.
 * Call this at app startup before rendering.
 */
export function registerControl(type: string, component: CustomControlComponent): void {
  registry.set(type, component);
}

/**
 * Look up a custom control renderer by type.
 */
export function getCustomControl(type: string): CustomControlComponent | undefined {
  return registry.get(type);
}
