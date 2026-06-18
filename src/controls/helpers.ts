import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIControl } from '../types/ui';
import { captureFocusBeforeReload } from '../services/focusRestore';

/** Field changes flow through `handleFieldChange` in Shell, which writes to a
 *  ref WITHOUT setState. A plain controlled `<Input value={control.value}>`
 *  therefore reverts the user's keystrokes whenever `control.value` holds a
 *  fixed non-empty string (e.g. a saved record): React keeps re-applying the
 *  unchanged value prop. (It "works" during insert only because the value is
 *  then undefined, making the input effectively uncontrolled.) We hold the
 *  typed text in local state and re-sync only when the upstream
 *  `control.value` actually changes via a server round-trip — the same
 *  approach DateControl's `useLocalDayjs` uses. */
export function useSyncedState<T>(controlValue: T): [T, (v: T) => void] {
  const [local, setLocal] = useState<T>(controlValue);
  const lastSeenRef = useRef<T>(controlValue);
  useEffect(() => {
    if (controlValue !== lastSeenRef.current) {
      lastSeenRef.current = controlValue;
      setLocal(controlValue);
    }
  }, [controlValue]);
  return [local, setLocal];
}

/** String-coerced variant for text inputs (cleared value is `''`, never
 *  `null` — which antd would treat as uncontrolled). */
export function useSyncedValue(controlValue: unknown): [string, (v: string) => void] {
  return useSyncedState(controlValue == null ? '' : String(controlValue));
}

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
        // Snapshot focus before the reload fires. For Tab-out reloads
        // the browser has already moved focus to the next tabIndex
        // field, so document.activeElement IS the target we want after
        // re-render. For checkbox toggles the activeElement is the
        // checkbox itself, so focus stays put. Either way, restoring
        // from the snapshot matches user intent.
        captureFocusBeforeReload();
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

/** Like {@link useControlChange} but for free-typing inputs (text, number,
 *  money, …): the value is stored on every keystroke, yet the `reload`
 *  round-trip fires only on COMMIT (blur / Enter) — never per keystroke.
 *
 *  Legacy HTML `<input onchange>` fired on blur, so a `reload` field posted
 *  once with the final value. antd `Input`/`InputNumber` fire `onChange` on
 *  every keystroke; firing the reload there posted a Post per digit, whose
 *  responses re-rendered over the half-typed value — intermediate amounts
 *  ("più/meno zeri"), values snapping back to the server's, and clears that
 *  wouldn't stick (SXADV-5494). Returns a `store` handler for onChange and a
 *  `commit` handler for onBlur/onPressEnter. */
export function useCommitReload(
  control: UIControl,
  onChange: (name: string, value: unknown) => void,
  onAction: (action: string, params?: Record<string, string>) => void,
): { store: (value: unknown) => void; commit: () => void } {
  const fieldName = getFieldName(control);
  const reload = control.reload;
  const command = (control.command as string) || 'Post';
  const navpath = (control.navpath as string) || '';
  const option1 = (control.option1 as string) || '';
  const dirtyRef = useRef(false);
  const store = useCallback(
    (val: unknown) => {
      onChange(fieldName, val);
      dirtyRef.current = true;
    },
    [fieldName, onChange],
  );
  const commit = useCallback(() => {
    if (!reload || !dirtyRef.current) return;
    dirtyRef.current = false;
    captureFocusBeforeReload();
    onAction(command, { navpath, option1, skipToolbar: '1' });
  }, [reload, command, navpath, option1, onAction]);
  return { store, commit };
}
