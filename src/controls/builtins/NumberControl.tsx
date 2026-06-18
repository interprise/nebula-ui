import React, { useState } from 'react';
import { InputNumber } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useCommitReload, useSyncedState, decodeHtmlEntities } from '../helpers';
import type { CommonInputProps } from '../helpers';

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
  const [local, setLocal] = useSyncedState(value);
  const symbol = currencySymbol !== undefined ? decodeHtmlEntities(String(currencySymbol || '€')) : undefined;
  const showPrefix = symbol && !focused && local != null && local !== '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <InputNumber
        {...commonProps}
        value={local as number}
        precision={decimals}
        prefix={showPrefix ? symbol : undefined}
        placeholder={symbol || undefined}
        style={{ width }}
        onFocus={() => setFocused(true)}
        // Commit the `reload` round-trip once, on blur — not per keystroke,
        // which raced the server recalc and snapped the value back.
        onBlur={() => { setFocused(false); commit(); }}
        onPressEnter={commit}
        onChange={(v) => { setLocal(v); store(v); }}
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

export const NumberControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  return (
    <MoneyInput
      commonProps={commonProps}
      value={control.value}
      decimals={control.decimals}
      unitSuffix={control.unitSuffix}
      width={control.size ? control.size * 9 + 34 : 125}
      store={store}
      commit={commit}
    />
  );
};

export const MoneyControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const { store, commit } = useCommitReload(control, onChange, onAction);
  return (
    <MoneyInput
      commonProps={commonProps}
      value={control.value}
      decimals={control.decimals}
      currencySymbol={control.currencySymbol as string}
      unitSuffix={control.unitSuffix}
      width={control.size ? control.size * 9 + 34 : 125}
      store={store}
      commit={commit}
    />
  );
};
