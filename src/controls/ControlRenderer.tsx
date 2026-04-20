import React, { useCallback, useContext } from 'react';
import { Input } from 'antd';
import type { UIControl } from '../types/ui';
import { PathContext } from '../components/ViewRenderer';
import { getControl } from './registry';
import { useCommonProps, useControlChange, getTextMaxWidth } from './helpers';
import { withPostDecorations } from './decorations';

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

  const doAction = useCallback((action: string, params?: Record<string, string>) => {
    const p = { ...params };
    if (viewPath && !p.navpath) p.navpath = viewPath;
    onAction(action, p);
  }, [onAction, viewPath]);

  const Component = control.type ? getControl(control.type) : undefined;
  if (Component) {
    return <Component control={control} pageType={pageType} onAction={doAction} onChange={onChange} />;
  }
  return <FallbackTextControl control={control} pageType={pageType} onAction={doAction} onChange={onChange} />;
};

export default ControlRenderer;
