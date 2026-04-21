import { useCallback } from 'react';
import type { UIControl } from '../types/ui';

export function javaToDayjsFormat(fmt: string | undefined): string | undefined {
  if (!fmt) return undefined;
  return fmt.replace(/dd/g, 'DD').replace(/yyyy/g, 'YYYY').replace(/yy/g, 'YY');
}

export function decodeHtmlEntities(s: string): string {
  const el = document.createElement('span');
  el.innerHTML = s;
  return el.textContent || s;
}

export function getFieldName(control: UIControl): string {
  return control.name || control.id || '';
}

export function getTextMaxWidth(control: UIControl): number {
  return control.size ? Math.min(control.size * 8 + 16, 500) : 500;
}

export interface CommonInputProps {
  id?: string;
  title?: string;
  disabled: boolean;
  status?: 'error';
}

export function useCommonProps(control: UIControl): CommonInputProps {
  const { id, hint, mandatory, value, disabled, editable } = control;
  const isDisabled = !!disabled || editable === false;
  return {
    id,
    title: hint,
    disabled: isDisabled,
    status: mandatory && !value ? 'error' as const : undefined,
  };
}

/** Returns a change handler that updates the field value and fires a server
 *  reload when the control carries `reload: true`. */
export function useControlChange(
  control: UIControl,
  onChange: (name: string, value: unknown) => void,
  onAction: (action: string, params?: Record<string, string>) => void,
): (value: unknown) => void {
  const fieldName = getFieldName(control);
  const reload = control.reload;
  const command = (control.command as string) || 'Post';
  const navpath = (control.navpath as string) || '';
  const option1 = (control.option1 as string) || '';
  return useCallback(
    (val: unknown) => {
      onChange(fieldName, val);
      if (reload) {
        // Field-triggered reloads don't need a fresh toolbar — state
        // that actually affects toolbar buttons (Save dirty, etc.)
        // updates on the next explicit action. Save bandwidth by asking
        // the server to skip toolbar emission.
        onAction(command, { navpath, option1, skipToolbar: '1' });
      }
    },
    [fieldName, reload, command, navpath, option1, onChange, onAction],
  );
}
