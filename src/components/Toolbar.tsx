import React from 'react';
import { Button, Dropdown, Space, Tooltip, Modal } from 'antd';
import {
  DownOutlined,
  ReloadOutlined,
  HourglassOutlined,
  StepBackwardOutlined,
  LeftOutlined,
  RightOutlined,
  StepForwardOutlined,
  ShrinkOutlined,
  ArrowsAltOutlined,
  SaveOutlined,
  PlusCircleOutlined,
  PlayCircleOutlined,
  UndoOutlined,
  PlusOutlined,
  DeleteOutlined,
  PrinterOutlined,
  MailOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  ClearOutlined,
  BarChartOutlined,
  FileAddOutlined,
  EditOutlined,
  SettingOutlined,
  BookOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
  TeamOutlined,
  FormOutlined,
  UserSwitchOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ToolbarItem } from '../types/ui';

const iconMap: Record<string, React.ReactNode> = {
  'control_repeat_blue.png': <ReloadOutlined />,
  'hourglass.png': <HourglassOutlined />,
  'resultset_first.png': <StepBackwardOutlined />,
  'resultset_previous.png': <LeftOutlined />,
  'resultset_next.png': <RightOutlined />,
  'resultset_last.png': <StepForwardOutlined />,
  'arrow_in.png': <ShrinkOutlined />,
  'arrow_out.png': <ArrowsAltOutlined />,
  'database_save.png': <SaveOutlined />,
  'database_add.png': <PlusCircleOutlined />,
  'database_go.png': <PlayCircleOutlined />,
  'thumb_down.png': <UndoOutlined />,
  'add.png': <PlusOutlined />,
  'delete.png': <DeleteOutlined />,
  'printer.png': <PrinterOutlined />,
  'email.png': <MailOutlined />,
  'page_excel.png': <FileExcelOutlined />,
  'page_white_excel.png': <DownloadOutlined />,
  'page_white_text.png': <FileTextOutlined />,
  'application_form_delete.png': <ClearOutlined />,
  'report.png': <BarChartOutlined />,
  'report_add.png': <FileAddOutlined />,
  'report_edit.png': <EditOutlined />,
  'report_delete.png': <DeleteOutlined />,
  'cog.png': <SettingOutlined />,
  'book_edit.png': <BookOutlined />,
  'help.png': <QuestionCircleOutlined />,
  'group_edit.png': <TeamOutlined />,
  'application_form_edit.png': <FormOutlined />,
  'user_suit.png': <UserOutlined />,
  'user_go.png': <UserSwitchOutlined />,
};

/**
 * Parse legacy ExtJS handler strings into action + params.
 * Patterns:
 *   doAction.createCallback('ACTION')
 *   doAction.createCallback('ACTION', 'PARAM')
 *   doAction2.createCallback('ACTION', 'PARAM')
 *   doAction3.createCallback('ACTION', 'PARAM1', 'PARAM2')
 */
function parseHandler(handler: string): { action: string; params?: Record<string, string>; showInWindow?: boolean } {
  // EntrAsp.UI.Shell.showInWindow.createCallback('COMMAND', 'PARAM')
  const winMatch = handler.match(/^EntrAsp\.UI\.Shell\.showInWindow\.createCallback\(([^)]+)\)$/);
  if (winMatch) {
    const args = winMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    const params: Record<string, string> = {};
    if (args[1]) params.viewName = args[1];
    return { action: args[0], params, showInWindow: true };
  }
  // doActionAndMenu.createCallback('ACTION') — calls controller2 then reloads menu
  const menuMatch = handler.match(/^doActionAndMenu\.createCallback\(([^)]+)\)$/);
  if (menuMatch) {
    const args = menuMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    return { action: args[0], params: { _reloadMenu: 'true' } };
  }
  const m = handler.match(/^doAction[23]?\.createCallback\(([^)]+)\)$/);
  if (m) {
    const args = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
    const action = args[0];
    const params: Record<string, string> = {};
    if (handler.startsWith('doAction3')) {
      if (args[1]) params.navpath = args[1];
      if (args[2]) params.option1 = args[2];
    } else if (handler.startsWith('doAction2')) {
      if (args[1]) params.navpath = args[1];
    } else {
      if (args[1]) params.navpath = args[1];
    }
    return { action, params: Object.keys(params).length > 0 ? params : undefined };
  }
  // Fallback: treat the whole string as an action name
  return { action: handler };
}

async function invokeHandler(handler: string, onAction: (action: string, params?: Record<string, string>) => void) {
  const { action, params, showInWindow } = parseHandler(handler);
  if (showInWindow) {
    // Call via controller2 and show result in a modal
    const { postAction2 } = await import('../services/api');
    try {
      document.body.style.cursor = 'wait';
      const resp = await postAction2(action, params || {});
      document.body.style.cursor = '';
      const result = resp as unknown as Record<string, unknown>;
      // GetViewHelp returns { items: [{ prompt, help }] }
      const items = result.items as Array<{ prompt: string; help: string }> | undefined;
      if (items && items.length > 0) {
        Modal.info({
          title: 'Aiuto',
          width: 600,
          content: (
            <div style={{ maxHeight: 400, overflow: 'auto' }}>
              {items.map((item, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <strong>{item.prompt}</strong>
                  <div dangerouslySetInnerHTML={{ __html: item.help || '' }} />
                </div>
              ))}
            </div>
          ),
        });
      } else {
        Modal.info({ title: 'Aiuto', content: 'Nessun contenuto di aiuto disponibile.' });
      }
    } catch {
      document.body.style.cursor = '';
    }
    return;
  }
  onAction(action, params);
}

interface ToolbarProps {
  items: ToolbarItem[];
  paging?: { currentPage: number; totalPages: number; totalRows: number; position: number; pageSize: number };
  onAction: (action: string, params?: Record<string, string>) => void;
}

function renderToolbarItem(
  raw: unknown,
  idx: number,
  onAction: (action: string, params?: Record<string, string>) => void,
  paging?: ToolbarProps['paging'],
): React.ReactNode {
  if (typeof raw === 'string') {
    if (raw === '->') return null; // handled by split
    return <span key={idx} style={{ fontSize: 12, color: '#666', lineHeight: '24px' }} dangerouslySetInnerHTML={{ __html: raw }} />;
  }
  const item = raw as ToolbarItem;
  const rawObj = raw as Record<string, unknown>;
  if (rawObj.tag) {
    if (rawObj.tag === 'span') {
      return <span key={idx} style={{ fontSize: 12, color: '#666', lineHeight: '24px' }} dangerouslySetInnerHTML={{ __html: rawObj.html as string || '' }} />;
    }
    if (rawObj.tag === 'input') {
      // Use paging.currentPage if available (updated on pagination), fall back to server value
      const inputValue = paging ? String(paging.currentPage) : (rawObj.value as string);
      return (
        <input
          key={`input_${inputValue}`}
          type="text"
          defaultValue={inputValue}
          size={4}
          style={{ width: 40, fontSize: 12, textAlign: 'center', padding: '1px 4px', border: '1px solid #d9d9d9', borderRadius: 4 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value;
              if (rawObj.onchange) {
                const m = (rawObj.onchange as string).match(/doAction3\('(\w+)',\s*'([^']*)',\s*this\.value\)/);
                if (m) {
                  onAction(m[1], { navpath: m[2], option1: val });
                }
              }
            }
          }}
        />
      );
    }
    return null;
  }
  if (!item.id && !item.handler) return null;

  // Normalize menu: server may send { items: [...] } object or direct array
  const menuItems = item.menu
    ? (Array.isArray(item.menu) ? item.menu : (item.menu as { items: ToolbarItem[] }).items)
    : undefined;

  if (menuItems && menuItems.length > 0) {
    return (
      <Dropdown
        key={item.id || idx}
        menu={{
          items: menuItems.map((sub, si) => ({
            key: sub.id || `sub_${si}`,
            label: sub.text,
            disabled: sub.disabled,
            onClick: () => sub.handler && invokeHandler(sub.handler, onAction),
          })),
        }}
      >
        <Button disabled={item.disabled} size="small">
          {item.icon && iconMap[item.icon]}
          {item.text} <DownOutlined />
        </Button>
      </Dropdown>
    );
  }

  const iconOnly = !item.text && item.icon;
  const tooltipText = item.tooltip || (item.keys ? `${item.shift ? 'Shift+' : ''}${item.keys}` : undefined);

  const btn = (
    <Button
      key={item.id || idx}
      disabled={item.disabled}
      size="small"
      type={item.pressed ? 'primary' : 'default'}
      onClick={() => item.handler && invokeHandler(item.handler, onAction)}
      icon={item.icon ? iconMap[item.icon] : undefined}
    >
      {item.text}
    </Button>
  );

  if (iconOnly || tooltipText) {
    return (
      <Tooltip key={item.id || idx} title={tooltipText}>
        {btn}
      </Tooltip>
    );
  }
  return btn;
}

const Toolbar: React.FC<ToolbarProps> = ({ items, paging, onAction }) => {
  if (!items || items.length === 0) return null;

  const rawItems = items as unknown[];
  const splitIdx = rawItems.indexOf('->');
  const leftItems = splitIdx >= 0 ? rawItems.slice(0, splitIdx) : rawItems;
  const rightItems = splitIdx >= 0 ? rawItems.slice(splitIdx + 1) : [];

  return (
    <div className="toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Space wrap size="small">
        {leftItems.map((raw, idx) => renderToolbarItem(raw, idx, onAction, paging))}
      </Space>
      {rightItems.length > 0 && (
        <Space wrap size="small">
          {rightItems.map((raw, idx) => renderToolbarItem(raw, splitIdx + 1 + idx, onAction, paging))}
        </Space>
      )}
    </div>
  );
};

export default Toolbar;
