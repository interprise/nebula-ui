import React, { useCallback, useContext } from 'react';
import { Input } from 'antd';
import type { UIControl } from '../types/ui';
import { PathContext, ViewNameContext } from '../components/ViewRenderer';
import { getControl } from './registry';
import { useCommonProps, useControlChange, getTextMaxWidth } from './helpers';
import { withPostDecorations } from './decorations';

// Dev-only: track unknown control types we've already warned about so the
// console isn't flooded. Keyed by `${type}@${viewName}`. Exposed on window
// as `__unknownControls` so a walk-through session can dump what's missing.
const warnedUnknownControls = new Set<string>();
interface UnknownControlHit { type: string; viewName?: string; name?: string }
const unknownControlHits: UnknownControlHit[] = [];
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __unknownControls: UnknownControlHit[] }).__unknownControls = unknownControlHits;
}

interface ControlRendererProps {
  control: UIControl;
  pageType?: number;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}

/** Default fallback for unregistered types: a text input with post-decorations.
 *  Matches the legacy `default:` branch of the old switch. */
const FallbackTextControl: React.FC<ControlRendererProps> = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  const textMaxWidth = getTextMaxWidth(control);
  return (
    <>
      {withPostDecorations(
        <Input
          {...commonProps}
          value={control.value as string}
          style={{ width: '100%', maxWidth: textMaxWidth }}
          onChange={(e) => handleChange(e.target.value)}
        />,
        control,
        pageType,
        onAction,
        onChange,
      )}
    </>
  );
};

/** Thin dispatcher: looks up the control component for `control.type` in the
 *  registry, falling back to a plain text input with decorations. Wraps
 *  onAction so every downstream component gets a navpath-qualified action
 *  dispatcher without knowing about PathContext. */
const ControlRenderer: React.FC<ControlRendererProps> = ({ control, pageType, onAction, onChange }) => {
  const viewPath = useContext(PathContext);
  const viewName = useContext(ViewNameContext);

  const doAction = useCallback((action: string, params?: Record<string, string>) => {
    const p = { ...params };
    if (viewPath && !p.navpath) p.navpath = viewPath;
    onAction(action, p);
  }, [onAction, viewPath]);

  const Component = control.type ? getControl(control.type) : undefined;
  if (Component) {
    return <Component control={control} pageType={pageType} onAction={doAction} onChange={onChange} />;
  }
  if (import.meta.env.DEV && control.type) {
    const key = `${control.type}@${viewName ?? '?'}`;
    if (!warnedUnknownControls.has(key)) {
      warnedUnknownControls.add(key);
      const hit: UnknownControlHit = { type: control.type, viewName, name: control.name };
      unknownControlHits.push(hit);
      console.warn('[ControlRenderer] unknown type', hit);
    }
  }
  return <FallbackTextControl control={control} pageType={pageType} onAction={doAction} onChange={onChange} />;
};

export default ControlRenderer;
