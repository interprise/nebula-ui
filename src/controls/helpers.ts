import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
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

/** Autocomplete a partially-typed Italian date, restoring the flexible input
 *  the classic (ExtJS) line accepted but the antd DatePicker's strict
 *  single-format parse dropped (SXADV-5469). Missing month/year are filled
 *  from *today*; a 2-digit year uses dayjs's own century pivot.
 *
 *  Accepted forms (separators: `/ - .` or space), `dateFmt` = display format
 *  (`DD/MM/YYYY`):
 *    - `1`/`2` digits or one token        → day only, current month + year
 *    - `4` digits or `dd/mm`              → dd/mm, current year
 *    - `6` digits or `dd/mm/yy`           → 2-digit year (dayjs pivot)
 *    - `8` digits or `dd/mm/yyyy`         → full date
 *    - `3`/`5`/`7` bare digits            → rejected (matches legacy)
 *  Returns a validated `Dayjs`, or `null` when the input can't be completed
 *  into a real calendar date. */
export function parseFlexibleDate(raw: string, dateFmt = 'DD/MM/YYYY'): Dayjs | null {
  const s = (raw ?? '').trim();
  if (!s) return null;

  // Already a well-formed value in the display format — keep it as-is.
  const strict = dayjs(s, dateFmt, true);
  if (strict.isValid()) return strict;

  const now = dayjs();
  let day: string;
  let month: string;
  let year: string | undefined;

  if (/[^0-9]/.test(s)) {
    const parts = s.split(/[^0-9]+/).filter((p) => p.length > 0);
    if (parts.length === 0) return null;
    [day, month, year] = [parts[0], parts[1] ?? String(now.month() + 1), parts[2]];
  } else {
    switch (s.length) {
      case 1:
      case 2:
        [day, month, year] = [s, String(now.month() + 1), undefined];
        break;
      case 4:
        [day, month, year] = [s.slice(0, 2), s.slice(2, 4), undefined];
        break;
      case 6:
        [day, month, year] = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 6)];
        break;
      case 8:
        [day, month, year] = [s.slice(0, 2), s.slice(2, 4), s.slice(4, 8)];
        break;
      default:
        return null; // 3, 5, 7, or > 8 bare digits
    }
  }

  if (!year) year = String(now.year());

  const dd = day.padStart(2, '0');
  const mm = month.padStart(2, '0');
  // Parse against the matching year width so dayjs applies its 2-digit pivot.
  const yearFmt = year.length <= 2 ? 'YY' : 'YYYY';
  const yyyy = year.padStart(yearFmt === 'YY' ? 2 : 4, '0');
  const parsed = dayjs(`${dd}/${mm}/${yyyy}`, `DD/MM/${yearFmt}`, true);
  return parsed.isValid() ? parsed : null;
}

/** Blur handler for antd `DatePicker` that restores flexible date entry. Used
 *  with `preserveInvalidOnBlur` so the picker keeps (rather than wipes) the raw
 *  typed text on focus-out: this handler then reads it and, when the picker's
 *  own strict parse would have rejected it, autocompletes via
 *  {@link parseFlexibleDate} and commits the result. Single display format is
 *  kept (not a format array) so the picker never commits mid-typing. Supports
 *  timestamp formats by splitting off a trailing time token. */
export function useFlexibleDateBlur(
  fmt: string,
  commit: (value: Dayjs | null, valueStr: string) => void,
): (e: FocusEvent<HTMLElement>) => void {
  return useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const raw = (e.target as HTMLInputElement).value?.trim();
      if (!raw) return;
      // The picker already accepts a well-formed value; don't double-commit.
      if (dayjs(raw, fmt, true).isValid()) return;

      const hasTime = /[Hh]/.test(fmt);
      const dateFmt = hasTime ? fmt.split(/\s+/)[0] : fmt;
      let datePart = raw;
      let timePart = '';
      if (hasTime) {
        const m = raw.match(/^(\S+)\s+(.+)$/);
        if (m) [, datePart, timePart] = m;
      }

      let d = parseFlexibleDate(datePart, dateFmt);
      if (!d) return;
      if (hasTime) {
        const t = timePart
          ? dayjs(timePart, ['HH:mm', 'HHmm', 'H:mm', 'HH.mm'], true)
          : null;
        d = d.hour(t?.isValid() ? t.hour() : 0).minute(t?.isValid() ? t.minute() : 0);
      }
      commit(d, d.format(fmt));
    },
    [fmt, commit],
  );
}

export function decodeHtmlEntities(s: string): string {
  const el = document.createElement('span');
  el.innerHTML = s;
  return el.textContent || s;
}

export function getFieldName(control: UIControl): string {
  return control.name || control.id || '';
}

/** Wire-form name for a query field's negation ("$not") flag. The server reads
 *  it as `controlName + "$not" + "." + viewstateId` (the `$not` infix sits
 *  BEFORE the viewstate-id suffix — see UIControl.getControlName(item,vs,"$not")).
 *  The hydrated field name is `controlName.viewstateId`, so we must insert
 *  `$not` before the trailing `.viewstateId`, not append it at the end
 *  (SXADV-5465). Falls back to a plain suffix when the name has no binding. */
export function negationFieldName(wireName: string): string {
  const i = wireName.lastIndexOf('.');
  return i >= 0
    ? wireName.slice(0, i) + '$not' + wireName.slice(i)
    : wireName + '$not';
}

export function getTextMaxWidth(control: UIControl): number {
  return control.size ? Math.min(control.size * 8 + 16, 500) : 500;
}

/** Parse a server-sent inline CSS string (e.g. contentStyle="text-align:center;")
 *  into a React style object. Mirrors ViewRenderer's cell-style parser. */
export function parseInlineStyle(styleStr?: string): CSSProperties | undefined {
  if (!styleStr) return undefined;
  const style: Record<string, string> = {};
  styleStr.split(';').forEach((rule) => {
    const idx = rule.indexOf(':');
    if (idx < 0) return;
    const prop = rule.slice(0, idx).trim();
    const val = rule.slice(idx + 1).trim();
    if (!prop || !val) return;
    const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    style[camel] = val;
  });
  return style as CSSProperties;
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
