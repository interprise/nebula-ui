import React, { useState } from 'react';
import { InputNumber } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedState, decodeHtmlEntities } from '../helpers';
import type { CommonInputProps } from '../helpers';
import { withPostDecorations } from '../decorations';

/** The server sends `decimals` (total decimal places parsed from the format
 *  mask) plus the raw `format`. antd InputNumber's `precision` PADS to a fixed
 *  number of decimals — right for money masks with mandatory zeros
 *  (`#,##0.00` → `1.234,00`) but wrong for masks whose fractional part is all
 *  optional `#`: `####.#` must show a whole protocol number as `5755`, not
 *  `5755.0` (SXADV-5543 #1), exactly as the legacy DecimalFormat did. Pad only
 *  when the mask has a mandatory `0` after the decimal point; when no mask was
 *  sent keep `decimals` so the money default is preserved. */
function displayPrecision(format: unknown, decimals: number | undefined): number | undefined {
  if (typeof format === 'string') {
    const dot = format.indexOf('.');
    const hasMandatory = dot >= 0 && format.slice(dot + 1).includes('0');
    if (!hasMandatory) return undefined;
  }
  return decimals;
}

/** The server sends numbers in Italian format ("1.260,00" — '.' thousands,
 *  ',' decimal). antd InputNumber's default decimal separator is '.', so a raw
 *  "225,00" gets its comma stripped → 22500. Parse to a real number for the
 *  widget, and format back to Italian on the way out so the server round-trips
 *  the same format it sent. */
function toNumber(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}
function toItalian(v: number | null | undefined, decimals: number | undefined): string {
  if (v == null) return '';
  return v.toLocaleString('it-IT', {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 20,
  });
}

/** Shared input for number/money — shows currency prefix only when blurred and value non-empty. */
const MoneyInput: React.FC<{
  commonProps: CommonInputProps;
  value: unknown;
  decimals?: number;
  currencySymbol?: string;
  unitSuffix?: unknown;
  width: number;
  store: (val: unknown) => void;
  commit: () => void;
}> = ({ commonProps, value, decimals, currencySymbol, unitSuffix, width, store, commit }) => {
  const [focused, setFocused] = useState(false);
  // Hold the edited value locally: store() writes to a ref without setState,
  // so a controlled `value` prop would revert keystrokes — and the
  // blur-driven re-render below (setFocused) would re-apply the stale server
  // value, mangling what was typed and blocking clears. Re-sync only on a
  // real server round-trip. (SXADV-5494)
  const [local, setLocal] = useSyncedState<number | null>(toNumber(value));
  const symbol = currencySymbol !== undefined ? decodeHtmlEntities(String(currencySymbol || '€')) : undefined;
  const showPrefix = symbol && !focused && local != null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <InputNumber
        {...commonProps}
        value={local}
        precision={decimals}
        // Server sends/expects Italian: comma is the decimal separator.
        decimalSeparator=","
        prefix={showPrefix ? symbol : undefined}
        placeholder={symbol || undefined}
        style={{ width }}
        onFocus={() => setFocused(true)}
        // Commit the `reload` round-trip once, on blur — not per keystroke,
        // which raced the server recalc and snapped the value back.
        onBlur={() => { setFocused(false); commit(); }}
        onPressEnter={commit}
        // antd gives a JS number; store it back in Italian format so the server
        // parses it correctly (else "225.5" reads as thousands → 2255).
        onChange={(v) => { setLocal(v as number | null); store(toItalian(v as number | null, decimals)); }}
        // rc-input-number does NOT fire onChange when the field is emptied —
        // it just reverts to the prior value on blur. onInput gives us the raw
        // string, so we catch the clear ourselves: store null and drop local to
        // null so the value doesn't snap back and the blur commit posts it.
        onInput={(text) => {
          if (text === '' || text == null) { setLocal(null); store(null); }
        }}
      />
      {!!unitSuffix && (
        <span className="unit-suffix">{String(unitSuffix)}</span>
      )}
    </span>
  );
};

export const NumberControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  return withPostDecorations(
    <MoneyInput
      commonProps={commonProps}
      value={control.value}
      decimals={displayPrecision(control.format, control.decimals)}
      unitSuffix={control.unitSuffix}
      width={control.size ? control.size * 9 + 34 : 125}
      store={store}
      commit={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};

export const MoneyControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  return withPostDecorations(
    <MoneyInput
      commonProps={commonProps}
      value={control.value}
      decimals={displayPrecision(control.format, control.decimals)}
      currencySymbol={control.currencySymbol as string}
      unitSuffix={control.unitSuffix}
      width={control.size ? control.size * 9 + 34 : 125}
      store={store}
      commit={commit}
    />,
    control,
    pageType,
    onAction,
    onChange,
  );
};
