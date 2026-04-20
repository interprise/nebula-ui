import React from 'react';
import { Button } from 'antd';
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import type { UIControl } from '../../types/ui';
import { WorkflowPill } from '../WorkflowPill';
import ControlRenderer from '../ControlRenderer';

export const ActionBarControl: ControlComponent = ({ control, onAction }) => {
  const actions = control.actions as Array<{ index: number; prompt: string; highlight?: boolean; hint?: string }> | undefined;
  const wfState = control.workflowState as string | undefined;
  const prevState = control.prevWorkflowState as string | undefined;
  const actionPath = control.path as string;
  if (!actions?.length && !wfState) return null;
  return (
    <div className="action-bar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {wfState && <WorkflowPill state={wfState} prevState={prevState} />}
      {actions?.map((act) => (
        <Button
          key={act.index}
          size="small"
          type={act.highlight ? 'primary' : 'default'}
          title={act.hint}
          onClick={() => onAction('workflow.Action', { navpath: actionPath, option1: String(act.index) })}
        >
          {act.prompt}
        </Button>
      ))}
    </div>
  );
};

export const ButtonBarControl: ControlComponent = ({ control, pageType, onAction, onChange }) => {
  const buttons = control.buttons as Array<Record<string, unknown>> | undefined;
  if (!buttons?.length) return null;
  return (
    <div className="button-bar" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {buttons.map((btn, i) => {
        const btnControl = btn as unknown as UIControl;
        const ci = btnControl.configureIcon;
        const btnEl = (
          <ControlRenderer
            control={btnControl}
            pageType={pageType}
            onAction={onAction}
            onChange={onChange}
          />
        );
        if (!ci) return <React.Fragment key={i}>{btnEl}</React.Fragment>;
        const Icon = ci.included ? CheckCircleFilled : CloseCircleFilled;
        return (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {btnEl}
            <Icon
              className={`configure-icon ${ci.included ? 'configure-on' : 'configure-off'}`}
              title={ci.included ? 'Bottone incluso - clicca per escludere' : 'Bottone escluso - clicca per includere'}
              onClick={() => onAction('ToggleItem', { navpath: ci.itemId })}
            />
          </span>
        );
      })}
    </div>
  );
};
