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

/** Wraps a control with post-decoration icons/widgets matching the Java addPostDecoration() output. */
export const withPostDecorations = (
  element: React.ReactNode,
  control: UIControl,
  pageType: number | undefined,
  onAction: (action: string, params?: Record<string, string>) => void,
  onChange?: (name: string, value: unknown) => void,
): React.ReactNode => {
  const nav = control.navigateView as { command: string; navpath: string; controlName: string } | undefined;
  const add = control.navigateAdd as { command: string; navpath: string; controlName: string } | undefined;
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
        <span className="negation-box">
          <span className="negation-label">not</span>
          <Checkbox
            checked={!!control.negationValue}
            onChange={(e) => onChange?.(fieldName + '$not', e.target.checked ? '1' : '')}
          />
        </span>
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
