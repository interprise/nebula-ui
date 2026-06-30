import React from 'react';
import { Checkbox } from 'antd';
import {
  PlusOutlined,
  LinkOutlined,
  StarFilled,
  OrderedListOutlined,
  FileSearchOutlined,
} from '@ant-design/icons';
import type { UIControl } from '../types/ui';
import { useSyncedState, negationFieldName } from './helpers';

/** Query "not" negation toggle. The raw `onChange` (Shell.handleFieldChange)
 *  writes to a ref without setState, so a controlled `checked={control.
 *  negationValue}` would never update — the box appeared unclickable
 *  (SXADV-5465.1). Hold the checked state locally and re-sync only when the
 *  server actually changes negationValue, mirroring the input controls. */
const NegationCheckbox: React.FC<{
  control: UIControl;
  fieldName: string;
  onChange?: (name: string, value: unknown) => void;
}> = ({ control, fieldName, onChange }) => {
  const [checked, setChecked] = useSyncedState(!!control.negationValue);
  return (
    <span className="negation-box">
      <span className="negation-label">not</span>
      <Checkbox
        checked={checked}
        onChange={(e) => {
          setChecked(e.target.checked);
          onChange?.(negationFieldName(fieldName), e.target.checked ? '1' : '');
        }}
      />
    </span>
  );
};

/** Wraps a control with post-decoration icons/widgets matching the Java addPostDecoration() output. */
export const withPostDecorations = (
  element: React.ReactNode,
  control: UIControl,
  pageType: number | undefined,
  onAction: (action: string, params?: Record<string, string>) => void,
  onChange?: (name: string, value: unknown) => void,
): React.ReactNode => {
  const navDesc = control.navigateView as { command: string; navpath: string; controlName: string } | undefined;
  const addDesc = control.navigateAdd as { command: string; navpath: string; controlName: string } | undefined;
  // Server emits nav/add descriptors structurally (when the field's type
  // supports them); the client decides visibility based on whether the
  // field has a value. Show nav only when there's something to navigate
  // to; show add only when the slot is empty (user would create a new
  // target).
  const hasValue = control.value != null && control.value !== '';
  const nav = navDesc && hasValue ? navDesc : undefined;
  const add = addDesc && !hasValue ? addDesc : undefined;
  const hasLookup = control.editable && control.lookupViewName && control.navigateLookupCommand;
  const isMandatoryIcon = control.mandatory && control.editable
    && control.type !== 'boolean' && control.type !== 'checkbox';
  const hasNegation = control.negation && pageType === 0;
  const postPrompt = control.postPrompt;

  const hasDecorations = nav || add || hasLookup || isMandatoryIcon || hasNegation || postPrompt;
  if (!hasDecorations) return element;

  const fieldName = control.name || control.id || '';
  return (
    <span className="post-decorations">
      {hasNegation && (
        <NegationCheckbox control={control} fieldName={fieldName} onChange={onChange} />
      )}
      {element}
      {postPrompt && <span className="post-prompt">{postPrompt}</span>}
      {isMandatoryIcon && (
        control.mandatoryIcon === 'sequence'
          ? <OrderedListOutlined className="mandatory-icon" title="Obbligatorio (sequenza)" />
          : <StarFilled className="mandatory-icon" title="Obbligatorio" />
      )}
      {nav && (
        <LinkOutlined
          className="nav-icon"
          title="Apri dettaglio"
          onClick={() => onAction(nav.command, { navpath: nav.navpath, option1: nav.controlName })}
        />
      )}
      {hasLookup && (
        <FileSearchOutlined
          className="lookup-icon"
          title="Ricerca"
          onClick={() => onAction(control.navigateLookupCommand!, { option1: fieldName })}
        />
      )}
      {add && (
        <PlusOutlined
          className="add-icon"
          title="Nuovo"
          onClick={() => onAction(add.command, { navpath: add.navpath, option1: add.controlName })}
        />
      )}
    </span>
  );
};
