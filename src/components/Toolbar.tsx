import React from 'react';
import { Button, Dropdown, Space, Tooltip } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { ToolbarItem } from '../types/ui';

interface ToolbarProps {
  items: ToolbarItem[];
  onAction: (action: string, params?: Record<string, string>) => void;
}

const Toolbar: React.FC<ToolbarProps> = ({ items, onAction }) => {
  if (!items || items.length === 0) return null;

  return (
    <div className="toolbar">
      <Space wrap size="small">
        {items.map((item) => {
          if (item.menu && item.menu.length > 0) {
            return (
              <Dropdown
                key={item.id}
                menu={{
                  items: item.menu.map((sub) => ({
                    key: sub.id,
                    label: sub.text,
                    disabled: sub.disabled,
                    onClick: () => sub.handler && onAction(sub.handler),
                  })),
                }}
              >
                <Button disabled={item.disabled} size="small">
                  {item.icon && (
                    <img
                      src={`/entrasp/images/${item.icon}`}
                      width={16}
                      height={16}
                      style={{ marginRight: 4 }}
                    />
                  )}
                  {item.text} <DownOutlined />
                </Button>
              </Dropdown>
            );
          }

          const btn = (
            <Button
              key={item.id}
              disabled={item.disabled}
              size="small"
              onClick={() => item.handler && onAction(item.handler)}
              icon={
                item.icon ? (
                  <img src={`/entrasp/images/${item.icon}`} width={16} height={16} />
                ) : undefined
              }
            >
              {item.text}
            </Button>
          );

          if (item.keys) {
            return (
              <Tooltip key={item.id} title={`${item.shift ? 'Shift+' : ''}${item.keys}`}>
                {btn}
              </Tooltip>
            );
          }
          return btn;
        })}
      </Space>
    </div>
  );
};

export default Toolbar;
