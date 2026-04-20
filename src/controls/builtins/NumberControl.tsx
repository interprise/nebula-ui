import React, { useState } from 'react';
import { InputNumber } from 'antd';
import type { ControlComponent } from '../types';
import { useCommonProps, useControlChange, decodeHtmlEntities } from '../helpers';
import type { CommonInputProps } from '../helpers';

/** Shared input for number/money — shows currency prefix only when blurred and value non-empty. */
const MoneyInput: React.FC<{
  commonProps: CommonInputProps;
  value: unknown;
  decimals?: number;
  currencySymbol?: string;
  unitSuffix?: unknown;
  width: number;
  onChange: (val: unknown) => void;
}> = ({ commonProps, value, decimals, currencySymbol, unitSuffix, width, onChange }) => {
  const [focused, setFocused] = useState(false);
  const symbol = currencySymbol !== undefined ? decodeHtmlEntities(String(currencySymbol || '€')) : undefined;
  const showPrefix = symbol && !focused && value != null && value !== '';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <InputNumber
        {...commonProps}
        value={value as number}
        precision={decimals}
        prefix={showPrefix ? symbol : undefined}
        placeholder={symbol || undefined}
        style={{ width }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={onChange}
      />
      {!!unitSuffix && (
        <span className="unit-suffix">{String(unitSuffix)}</span>
      )}
    </span>
  );
};

export const NumberControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  return (
    <MoneyInput
      commonProps={commonProps}
      value={control.value}
      decimals={control.decimals}
      unitSuffix={control.unitSuffix}
      width={control.size ? control.size * 9 + 34 : 125}
      onChange={handleChange}
    />
  );
};

export const MoneyControl: ControlComponent = ({ control, onAction, onChange }) => {
  const commonProps = useCommonProps(control);
  const handleChange = useControlChange(control, onChange, onAction);
  return (
    <MoneyInput
      commonProps={commonProps}
      value={control.value}
      decimals={control.decimals}
      currencySymbol={control.currencySymbol as string}
      unitSuffix={control.unitSuffix}
      width={control.size ? control.size * 9 + 34 : 125}
      onChange={handleChange}
    />
  );
};
