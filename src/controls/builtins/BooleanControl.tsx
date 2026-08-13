import React from 'react';
import { Checkbox } from 'antd';
import type { ControlComponent } from '../types';
import type { UIControl } from '../../types/ui';
import { useControlChange, useSyncedState } from '../helpers';

/** Boolean/checkbox needs local state because Shell's handleFieldChange only
 *  mutates a ref (no re-render). On QUERY pages non-mandatory booleans are tri-state. */
const BooleanInner: React.FC<{
  control: UIControl;
  isQuery: boolean;
  isDisabled: boolean;
  handleChange: (val: unknown) => void;
}> = ({ control, isQuery, isDisabled, handleChange }) => {
  const serverVal = control.value;
  const toBool = (v: unknown) => v === true || v === 'true' || v === '1';
  const toNull = (v: unknown) => v === null || v === undefined || v === '';

  // useSyncedState (not a bare useState + effect) so a server payload that
  // re-sends the same value still overrides a local toggle (SXADV-5014.1).
  const [localVal, setLocalVal] = useSyncedState<unknown>(serverVal);

  const boolVal = toBool(localVal);
  const isNull = toNull(localVal);
  const isMandatory = !!control.mandatory;

  if (isQuery && !isMandatory) {
    const handleTriState = () => {
      let next: unknown;
      if (isNull) next = true;
      else if (boolVal) next = false;
      else next = null;
      setLocalVal(next);
      handleChange(next);
    };
    return (
      <Checkbox
        id={control.id}
        className="query-tristate"
        checked={!isNull && boolVal}
        indeterminate={isNull}
        disabled={isDisabled}
        onChange={handleTriState}
      />
    );
  }

  return (
    <Checkbox
      id={control.id}
      checked={boolVal}
      disabled={isDisabled}
      onChange={(e) => {
        setLocalVal(e.target.checked);
        handleChange(e.target.checked);
      }}
    />
  );
};

const BooleanControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const isDisabled = !!control.disabled || control.editable === false;
  const handleChange = useControlChange(control, onChange, onAction);
  return (
    <BooleanInner
      control={control}
      isQuery={pageType === 0}
      isDisabled={isDisabled}
      handleChange={handleChange}
    />
  );
};

export default BooleanControl;
