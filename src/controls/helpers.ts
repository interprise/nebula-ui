import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, FocusEvent, KeyboardEvent, RefObject, SetStateAction } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import type { UIControl } from '../types/ui';
import { captureFocusBeforeReload } from '../services/focusRestore';
import { DataVersionContext } from './dataVersion';

/** Field changes flow through `handleFieldChange` in Shell, which writes to a
 *  ref WITHOUT setState. A plain controlled `<Input value={control.value}>`
 *  therefore reverts the user's keystrokes whenever `control.value` holds a
 *  fixed non-empty string (e.g. a saved record): React keeps re-applying the
 *  unchanged value prop. (It "works" during insert only because the value is
 *  then undefined, making the input effectively uncontrolled.) We hold the
 *  typed text in local state and re-sync only when the upstream
 *  `control.value` actually changes via a server round-trip — the same
 *  approach DateControl's `useLocalDayjs` uses.
 *
 *  A changed value is not the only reason to re-sync: a server payload that
 *  puts the SAME value back on a field the user has edited is still a refresh
 *  and must win over the local text (a brand-new record after "Salva+" is all
 *  nulls, exactly like the template the user typed into — SXADV-5014.1). So we
 *  also re-sync whenever the enclosing `DataVersionContext` changes, i.e. when
 *  the form was re-rendered from a server payload rather than by React. */
export function useSyncedState<T>(controlValue: T): [T, (v: T) => void] {
  const dataVersion = useContext(DataVersionContext);
  const [local, setLocal] = useState<T>(controlValue);
  const lastSeenRef = useRef<{ value: T; version: number }>({ value: controlValue, version: dataVersion });
  useEffect(() => {
    if (controlValue !== lastSeenRef.current.value || dataVersion !== lastSeenRef.current.version) {
      lastSeenRef.current = { value: controlValue, version: dataVersion };
      setLocal(controlValue);
    }
  }, [controlValue, dataVersion]);
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
  currentValue?: Dayjs | null,
): (e: FocusEvent<HTMLElement>) => void {
  return useCallback(
    (e: FocusEvent<HTMLElement>) => {
      const raw = (e.target as HTMLInputElement).value?.trim();
      if (!raw) {
        // Emptied via keyboard (Canc/Backspace). With `preserveInvalidOnBlur`
        // the picker keeps the controlled `value` prop and visually restores
        // the old date on blur, so the clear never sticks (SXADV-5489.1).
        // Commit null to make the keyboard clear persist — but only when there
        // was a value, else every tab-through of an empty date field would
        // fire a spurious change/reload.
        if (currentValue) commit(null, '');
        return;
      }
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
    [fmt, commit, currentValue],
  );
}

/** Return focus to a date/time picker's input after a value is chosen from its
 *  popup. antd closes the panel on a calendar/clock selection but — unlike a
 *  click on the field itself — does NOT return focus to the input (rc-picker's
 *  `triggerConfirm` force-closes the panel without the refocus `onSelectorClick`
 *  does). Focus falls to `<body>`, so the next Tab lands on the page's first
 *  focusable element — the app-bar "Esci" button — instead of the next field
 *  (SXADV-5680). `.focus()` only focuses the input; it does not reopen the panel
 *  (rc-picker opens only on click/keydown), so this is safe.
 *
 *  Guard (see inline note): restore only when focus is "stranded" — on `<body>`
 *  or still on the picker's own dropdown. A real Tab-out has moved focus to a
 *  genuine next field, so it is left alone. NOTE this covers only the case where
 *  the picker stays mounted; a field that fires a server reload on change
 *  remounts the picker (ref becomes null) and is instead handled by
 *  `captureFocusBeforeReload`'s id fallback + `restoreFocus`. */
export function useRestorePickerFocus(
  pickerRef: RefObject<{ focus: () => void } | null>,
): () => void {
  return useCallback(() => {
    requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      // "Stranded" focus after a popup selection: either dropped to <body>, or
      // still held by the picker's own dropdown panel (antd keeps the panel
      // mounted+focused through its close transition, so it isn't <body> yet).
      // A real Tab-out has instead moved focus to a genuine next field — not the
      // dropdown, not <body> — so we leave that alone.
      const stranded =
        !active ||
        active === document.body ||
        active.closest('.ant-picker-dropdown') != null;
      if (stranded) pickerRef.current?.focus();
    });
  }, [pickerRef]);
}

/** Controlled-`open` state for an antd `Select` that opens ONLY on a deliberate
 *  gesture — typing, or a click on the trigger arrow — never on a plain
 *  body/focus click. antd opens the dropdown on any click of the selector, but
 *  the legacy (ExtJS) combo dropped its list only from the trigger button or
 *  typeahead; a body click just focused the field (SXADV-5489.2). The returned
 *  `onOpenChange` honors antd's CLOSE requests (click-away, blur, selection) but
 *  ignores its OPEN requests — callers open explicitly via `setOpen`. */
export function useSelectOpen(): {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  onOpenChange: (visible: boolean) => void;
} {
  const [open, setOpen] = useState(false);
  const onOpenChange = useCallback((visible: boolean) => {
    if (!visible) setOpen(false);
  }, []);
  return { open, setOpen, onOpenChange };
}

const norm = (v: unknown): string | undefined =>
  v == null || v === '' ? undefined : String(v);

/** onKeyDown for a single-select antd `Select` (`showSearch`) handling two keys
 *  the legacy line supported but antd doesn't for single-selects (SXADV-5489.2):
 *
 *  - **Canc/Backspace** with an empty search box clears the value from the
 *    keyboard (antd only removes selections on Backspace in `mode="multiple"`).
 *  - **Esc** acts as a field-level undo, restoring `baseline` (the last
 *    server/committed value) — a value the user had just cleared or changed is
 *    otherwise lost. Also closes the dropdown, since `open` is controlled.
 *  - **Ctrl+Space / Ctrl+ArrowDown** opens the list from the keyboard — the
 *    dropdown is controlled to stay shut on focus, so this is the keyboard
 *    equivalent of a trigger-arrow click (same combo as ExpBuilderControl).
 *
 *  `clear`/`restore` receive the value to commit; `close`/`openList` toggle. */
export function useSelectKeys(
  value: unknown,
  baseline: unknown,
  clear: (val: unknown) => void,
  restore: (val: string | undefined) => void,
  close: () => void,
  openList: () => void,
): (e: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (e.ctrlKey && (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowDown')) {
        e.preventDefault();
        e.stopPropagation();
        openList();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        const b = norm(baseline);
        if (b !== norm(value)) restore(b); // undo to the baseline
        return;
      }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      if (value == null || value === '') return;
      // Non-empty search input → the key edits the filter text, don't hijack it.
      if ((e.target as HTMLInputElement).value) return;
      e.preventDefault();
      e.stopPropagation();
      clear(undefined);
    },
    [value, baseline, clear, restore, close, openList],
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
  const { id, hint, mandatory, value, disabled, editable, type } = control;
  const isDisabled = !!disabled || editable === false;
  // Legacy gated the red border (the `nb-md` marker class) on
  // `isMandatoryUI(...) && editable`: a mandatory field the user cannot fill
  // must not be flagged, and booleans — mandatory by construction — were
  // excluded outright. Mirror both here, matching withPostDecorations' star
  // gating. Previously the metadata render path shipped `mandatory` for
  // almost nothing, so an ungated check went unnoticed; now that derived
  // mandatory fields resolve correctly, read-only ones would light up red
  // (e.g. a non-nullable "Id Batch" carrying isEditable="false"). (SXADV-5663)
  const showMandatory = !!mandatory && !isDisabled
    && type !== 'boolean' && type !== 'checkbox';
  return {
    id,
    title: hint,
    disabled: isDisabled,
    status: showMandatory && !value ? 'error' as const : undefined,
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
        // from the snapshot matches user intent. When the change came from a
        // popup that stranded focus (DatePicker calendar), activeElement has no
        // id — fall back to this control's id so focus returns to the field
        // instead of <body> after the re-render (SXADV-5680).
        captureFocusBeforeReload(control.id);
        // Let the reload return the fresh toolbar: it stages an edit, so the
        // server's dirty state changes and Annulla/Salva must reflect it (was
        // skipped for bandwidth, but that left Annulla stuck disabled after an
        // edit in the bottom panel).
        onAction(command, { navpath, option1 });
      }
    },
    [fieldName, reload, command, navpath, option1, onChange, onAction, control.id],
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
    captureFocusBeforeReload(control.id);
    onAction(command, { navpath, option1 });
  }, [reload, command, navpath, option1, onAction, control.id]);
  return { store, commit };
}
