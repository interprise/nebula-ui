import React from 'react';
import { Button } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, SettingFilled, RightCircleFilled } from '@ant-design/icons';
import type { ControlComponent } from '../types';
import type { UIControl } from '../../types/ui';
import { WorkflowPill } from '../WorkflowPill';
import ControlRenderer from '../ControlRenderer';

type BpmAction = { label: string; selection: string; hint?: string };
type BpmStep = {
  stepId: string;
  processInstanceId: string;
  active: boolean;
  processStart?: boolean;
  statusText?: string;
  kind?: 'userAction' | 'decision';
  notificationText?: string;
  notifiedUsers?: string[];
  actions?: BpmAction[];
};

const BpmBar: React.FC<{
  steps: BpmStep[];
  path: string;
  onAction: (action: string, params?: Record<string, string>) => void;
}> = ({ steps, path, onAction }) => {
  if (!steps.length) return null;
  return (
    <div className="bpm-bar">
      {steps.map((step) => (
        <div key={step.stepId} className="bpm-row">
          {step.processStart && (
            <div className="bpm-process-header">
              <SettingFilled className="bpm-cog" />
              {step.statusText && <span className="bpm-status">{step.statusText}</span>}
            </div>
          )}
          <div className="bpm-step">
            {(step.notifiedUsers?.length || step.notificationText) && (
              <span className={step.active ? 'bpm-notif bpm-notif-active' : 'bpm-notif'}>
                {!step.active && step.notifiedUsers?.length ? (
                  <span className="bpm-users">{step.notifiedUsers.join(', ')}: </span>
                ) : null}
                {step.notificationText}
              </span>
            )}
            {step.active && step.actions?.length ? (
              <span className="bpm-actions">
                {step.actions.map((a, i) => (
                  <Button
                    key={i}
                    size="small"
                    type="default"
                    title={a.hint}
                    onClick={() =>
                      onAction('bpm.Action', {
                        navpath: path,
                        option1: step.stepId,
                        option2: a.selection,
                      })
                    }
                  >
                    {a.label}
                    <RightCircleFilled style={{ marginLeft: 4 }} />
                  </Button>
                ))}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
};

export const ActionBarControl: ControlComponent = ({ control, onAction }) => {
  const actions = control.actions as Array<{ index: number; prompt: string; highlight?: boolean; hint?: string }> | undefined;
  const wfState = control.workflowState as string | undefined;
  const prevState = control.prevWorkflowState as string | undefined;
  const actionPath = control.path as string;
  const bpmSteps = control.bpm as BpmStep[] | undefined;
  if (!actions?.length && !wfState && !bpmSteps?.length) return null;
  // Pill stays on the left, vertically centered, and never wraps. Buttons
  // are in their own flex-wrap group so when they overflow they wrap
  // aligned after the pill (not under it).
  const hasWorkflowRow = !!wfState || !!actions?.length;
  return (
    <div className="action-bar-wrap">
      {hasWorkflowRow && (
        <div className="action-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {wfState && (
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <WorkflowPill state={wfState} prevState={prevState} />
            </div>
          )}
          {actions?.length ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              {actions.map((act) => (
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
          ) : null}
        </div>
      )}
      {bpmSteps?.length ? <BpmBar steps={bpmSteps} path={actionPath} onAction={onAction} /> : null}
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
