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
  // Pill stays on the left, vertically centered, and never wraps. Actions are
  // in their own flex-wrap group so when they overflow they wrap aligned after
  // the pill (not under it).
  //
  // Vertical density (SXADV-5742): full `default` buttons cost ~24px + an 8px
  // gap per row, so a workflow with three rows of actions burned ~90px of the
  // editing area against ~55px for the same three rows of legacy links. Only
  // the highlighted action — the one the workflow is steering the user towards
  // — keeps a filled button; the rest render as links, which is both what the
  // legacy UI did and roughly half the height. The `action-link` / `action-btn`
  // classes carry the compaction (see global.css) so a row wraps to ~20px.
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
            <div style={{ display: 'flex', columnGap: 6, rowGap: 2, alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              {actions.map((act) => (
                <Button
                  key={act.index}
                  size="small"
                  className={act.highlight ? 'action-btn' : 'action-link'}
                  type={act.highlight ? 'primary' : 'link'}
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
  // A bar made only of navigation links (the anagrafica link-action band) keeps
  // the legacy single-row behaviour: captions wrap instead of the band wrapping
  // (SXADV-5746.1, see global.css). Bars of real buttons — which can't wrap
  // their own label — keep wrapping the band itself.
  const linksOnly = buttons.every((b) => b.type === 'navigateView');
  return (
    // Layout lives in global.css so the band can behave like the legacy
    // <tr>-of-<td>s it replaces.
    <div className={linksOnly ? 'button-bar button-bar-links' : 'button-bar'}>
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
