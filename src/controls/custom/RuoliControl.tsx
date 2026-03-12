import React from 'react';
import { Tooltip } from 'antd';
import {
  DollarOutlined,
  CalculatorOutlined,
  FormOutlined,
  InboxOutlined,
  MailOutlined,
  CarOutlined,
  UserOutlined,
  SendOutlined,
  BankOutlined,
  BookOutlined,
  TeamOutlined,
  StarOutlined,
} from '@ant-design/icons';
import type { CustomControlProps } from '../customControls';

interface RoleFlags {
  cli?: boolean;
  for?: boolean;
  ctb?: boolean;
  ordCli?: boolean;
  destCli?: boolean;
  destSpedFatt?: boolean;
  offerte?: boolean;
  contatto?: boolean;
  prospect?: boolean;
  ordFor?: boolean;
  destFor?: boolean;
  age?: boolean;
  risorsa?: boolean;
  vettore?: boolean;
  ban?: boolean;
}

interface RoleDef {
  key: string;
  flag: boolean;
  label: string;
  icon: React.ReactNode;
  ruolo: string;
}

const RuoliControl: React.FC<CustomControlProps> = ({ control, onAction }) => {
  const roles = (control.value as RoleFlags) || {};
  const editable = control.editable !== false;
  const path = (control.path as string) || '';

  const handleToggle = (ruolo: string, exists: boolean) => {
    if (!editable) return;
    onAction(exists ? 'RuoliRemove' : 'RuoliAdd', { navpath: path, option1: ruolo });
  };

  // Detail view: editable role picker
  if (editable && path) {
    const cliRoles: RoleDef[] = [
      { key: 'cli', flag: !!roles.cli, label: 'Fatture di vendita', icon: <DollarOutlined />, ruolo: 'CLI' },
      { key: 'offerte', flag: !!(roles.cli || roles.contatto || roles.prospect) && !!roles.offerte, label: 'Preventivi di vendita', icon: <CalculatorOutlined />, ruolo: 'OFFERTE' },
      { key: 'ordCli', flag: !!(roles.cli || roles.prospect) && !!roles.ordCli, label: 'Ordini di vendita', icon: <FormOutlined />, ruolo: 'ORDINI_CLI' },
      { key: 'destCli', flag: !!roles.cli && !!roles.destCli, label: 'DDT di vendita', icon: <InboxOutlined />, ruolo: 'DDT_CLI' },
      { key: 'destSpedFatt', flag: !!roles.cli && !!roles.destSpedFatt, label: 'Spedizione fatture', icon: <MailOutlined />, ruolo: 'DEST_SPED_FATT' },
    ];
    const forRoles: RoleDef[] = [
      { key: 'for', flag: !!roles.for, label: 'Fatture di acquisto', icon: <DollarOutlined />, ruolo: 'FOR' },
      { key: 'ordFor', flag: !!roles.for && !!roles.ordFor, label: 'Ordini di acquisto', icon: <FormOutlined />, ruolo: 'ORDINI_FOR' },
      { key: 'destFor', flag: !!roles.for && !!roles.destFor, label: 'Magazzino spedizione', icon: <InboxOutlined />, ruolo: 'DDT_FOR' },
      { key: 'age', flag: !!roles.age, label: 'Agente', icon: <CarOutlined />, ruolo: 'AGE' },
      { key: 'risorsa', flag: !!roles.risorsa, label: 'Risorsa', icon: <UserOutlined />, ruolo: 'RISORSA' },
      { key: 'vettore', flag: !!roles.vettore, label: 'Vettore', icon: <SendOutlined />, ruolo: 'VETTORE' },
      { key: 'ban', flag: !!roles.ban, label: 'Banca', icon: <BankOutlined />, ruolo: 'BANCA' },
    ];

    return (
      <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
        {roles.ctb && (
          <Tooltip title="Anagrafe contabile">
            <span
              style={{ cursor: 'pointer' }}
              onClick={() => handleToggle('CTB', true)}
            >
              <BookOutlined style={{ color: '#1677ff' }} />
            </span>
          </Tooltip>
        )}
        {!roles.ctb && editable && (
          <Tooltip title="Aggiungi anagrafe contabile">
            <span
              style={{ cursor: 'pointer', opacity: 0.4 }}
              onClick={() => handleToggle('CTB', false)}
            >
              <BookOutlined />
            </span>
          </Tooltip>
        )}
        <RoleGroup title="Clienti" roles={cliRoles} onToggle={handleToggle} />
        <RoleGroup title="Fornitori" roles={forRoles} onToggle={handleToggle} />
      </div>
    );
  }

  // List view: compact read-only summary
  return <RuoliSummary roles={roles} />;
};

const RoleGroup: React.FC<{
  title: string;
  roles: RoleDef[];
  onToggle: (ruolo: string, exists: boolean) => void;
}> = ({ title, roles, onToggle }) => {
  const activeRoles = roles.filter(r => r.flag);
  const inactiveRoles = roles.filter(r => !r.flag);
  if (activeRoles.length === 0 && inactiveRoles.length === 0) return null;

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 11, color: '#666', marginBottom: 2 }}>{title}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {activeRoles.map(r => (
          <Tooltip key={r.key} title={r.label}>
            <span
              style={{ cursor: 'pointer', color: '#1677ff' }}
              onClick={() => onToggle(r.ruolo, true)}
            >
              {r.icon}
            </span>
          </Tooltip>
        ))}
        {inactiveRoles.map(r => (
          <Tooltip key={r.key} title={`Aggiungi: ${r.label}`}>
            <span
              style={{ cursor: 'pointer', opacity: 0.3 }}
              onClick={() => onToggle(r.ruolo, false)}
            >
              {r.icon}
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

const RuoliSummary: React.FC<{ roles: RoleFlags }> = ({ roles }) => {
  const items: { label: string; icon: React.ReactNode }[] = [];
  if (roles.ctb) items.push({ label: 'Contabilità', icon: <BookOutlined /> });
  if (roles.cli) items.push({ label: 'Cliente', icon: <TeamOutlined /> });
  if (roles.for) items.push({ label: 'Fornitore', icon: <DollarOutlined /> });
  if (roles.age) items.push({ label: 'Agente', icon: <CarOutlined /> });
  if (roles.vettore) items.push({ label: 'Vettore', icon: <SendOutlined /> });
  if (roles.ban) items.push({ label: 'Banca', icon: <BankOutlined /> });
  if (roles.contatto) items.push({ label: 'Contatto', icon: <StarOutlined /> });
  if (roles.prospect) items.push({ label: 'Prospect', icon: <StarOutlined /> });

  if (items.length === 0) return <span style={{ color: '#999' }}>—</span>;

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {items.map((item, i) => (
        <Tooltip key={i} title={item.label}>
          <span style={{ color: '#1677ff' }}>{item.icon}</span>
        </Tooltip>
      ))}
    </span>
  );
};

export default RuoliControl;
