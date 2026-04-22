import React, { useState } from 'react';
import { Button, Table, Checkbox, Input, Select, Space } from 'antd';
import {
  FileOutlined,
  MobileOutlined,
  PhoneOutlined,
  MailOutlined,
  PrinterOutlined,
  StarFilled,
  CaretDownOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import type { ControlComponent } from '../types';
import { triggerDownload } from '../../services/api';

interface AllegatiFile { key: string; fileName: string }

export const AllegatiControl: ControlComponent = ({ control }) => {
  const files = (control.files as AllegatiFile[] | undefined) ?? [];
  if (files.length === 0) return <span className="allegati-empty" style={{ color: '#999' }}>Nessun allegato</span>;
  return (
    <div className="allegati-control" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {files.map((f) => (
        <a
          key={f.key}
          href="#"
          onClick={(e) => {
            e.preventDefault();
            triggerDownload('EmailAllegatoDownload', { option1: f.key }, undefined, f.fileName);
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <FileOutlined /> {f.fileName}
        </a>
      ))}
    </div>
  );
};

export const ArrayControl: ControlComponent = ({ control, onChange }) => {
  const values = (control.values as string[] | undefined) ?? [];
  const editable = control.editable !== false;
  const maxLength = control.maxLength as number | undefined;
  const size = control.size as number | undefined;
  const name = control.name as string | undefined;
  return (
    <div className="array-control" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {values.map((v, i) => (
        <Input
          key={i}
          value={v}
          size="small"
          maxLength={maxLength}
          style={{ width: size ? `${size * 8}px` : undefined, maxWidth: '100%' }}
          disabled={!editable}
          onChange={(e) => {
            if (!name) return;
            const next = [...values];
            next[i] = e.target.value;
            onChange(name, next);
          }}
        />
      ))}
    </div>
  );
};

interface Contatto {
  name: string;
  flagDefault?: boolean;
  flagAmministrazione?: boolean;
  flagTecnico?: boolean;
  flagCommerciale?: boolean;
  flagSpedizione?: boolean;
  phone?: string; phone2?: string;
  mobile?: string; mobile2?: string;
  fax?: string; fax2?: string;
  email?: string; email2?: string;
}

export const ContattiControl: ControlComponent = ({ control }) => {
  const contacts = (control.contacts as Contatto[] | undefined) ?? [];
  if (contacts.length === 0) return <span style={{ color: '#999' }}>Nessun contatto</span>;
  return (
    <Table<Contatto>
      size="small"
      pagination={false}
      rowKey={(_, i) => String(i)}
      dataSource={contacts}
      columns={[
        {
          title: '',
          dataIndex: 'flagDefault',
          width: 24,
          render: (v: boolean) => v ? <StarFilled style={{ color: '#faad14' }} /> : null,
        },
        {
          title: 'Contatto',
          dataIndex: 'name',
          render: (v, row) => (
            <span>
              {v}
              {row.flagAmministrazione && <span title="Amministrazione" style={{ marginLeft: 4 }}>[A]</span>}
              {row.flagTecnico && <span title="Tecnico" style={{ marginLeft: 4 }}>[T]</span>}
              {row.flagCommerciale && <span title="Commerciale" style={{ marginLeft: 4 }}>[C]</span>}
              {row.flagSpedizione && <span title="Spedizione" style={{ marginLeft: 4 }}>[S]</span>}
            </span>
          ),
        },
        {
          title: 'Telefono',
          render: (_, row) => (
            <span>
              {row.phone && <span><PhoneOutlined /> {row.phone}</span>}
              {row.phone2 && <span> / {row.phone2}</span>}
            </span>
          ),
        },
        {
          title: 'Cellulare',
          render: (_, row) => (
            <span>
              {row.mobile && <span><MobileOutlined /> {row.mobile}</span>}
              {row.mobile2 && <span> / {row.mobile2}</span>}
            </span>
          ),
        },
        {
          title: 'Fax',
          render: (_, row) => (
            <span>
              {row.fax && <span><PrinterOutlined /> {row.fax}</span>}
              {row.fax2 && <span> / {row.fax2}</span>}
            </span>
          ),
        },
        {
          title: 'Email',
          render: (_, row) => (
            <span>
              {row.email && <span><MailOutlined /> <a href={`mailto:${row.email}`}>{row.email}</a></span>}
              {row.email2 && <span> / <a href={`mailto:${row.email2}`}>{row.email2}</a></span>}
            </span>
          ),
        },
      ]}
    />
  );
};

const ROLE_LABELS: { key: string; label: string }[] = [
  { key: 'cli', label: 'Cliente' },
  { key: 'for', label: 'Fornitore' },
  { key: 'ctb', label: 'Identità contabile' },
  { key: 'ordCli', label: 'Ordini cliente' },
  { key: 'destCli', label: 'Destinazioni cliente' },
  { key: 'destSpedFatt', label: 'Dest. spedizione fatt.' },
  { key: 'offerte', label: 'Offerte' },
  { key: 'contatto', label: 'Contatto' },
  { key: 'prospect', label: 'Prospect' },
  { key: 'ordFor', label: 'Ordini fornitore' },
  { key: 'destFor', label: 'Destinazioni fornitore' },
  { key: 'age', label: 'Agente' },
  { key: 'risorsa', label: 'Risorsa' },
  { key: 'vettore', label: 'Vettore' },
  { key: 'ban', label: 'Banca' },
];

export const RuoliControl: ControlComponent = ({ control }) => {
  const value = (control.value as Record<string, boolean> | undefined) ?? {};
  return (
    <div className="ruoli-control" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: '4px 16px' }}>
      {ROLE_LABELS.map((r) => (
        <Checkbox key={r.key} checked={!!value[r.key]} disabled>
          {r.label}
        </Checkbox>
      ))}
    </div>
  );
};

interface Variant {
  code: string;
  seq: string;
  description: string;
  value?: string;
  options?: { value: string; text: string }[];
}

export const VariantiControl: ControlComponent = ({ control, onChange }) => {
  const variants = (control.variants as Variant[] | undefined) ?? [];
  const editable = control.editable !== false;
  const name = control.name as string | undefined;
  if (variants.length === 0) return null;
  return (
    <Table<Variant>
      size="small"
      pagination={false}
      rowKey="code"
      dataSource={[...variants].sort((a, b) => Number(a.seq) - Number(b.seq))}
      columns={[
        { title: 'Tipo', dataIndex: 'description' },
        {
          title: 'Valore',
          dataIndex: 'value',
          render: (v, row) => (
            <Select
              size="small"
              value={v}
              disabled={!editable}
              style={{ minWidth: 140 }}
              allowClear
              options={(row.options ?? []).map((o) => ({ value: o.value, label: o.text }))}
              onChange={(next) => name && onChange(`${name}.${row.code}`, next)}
            />
          ),
        },
      ]}
    />
  );
};

interface ReportEntry { value: string; text: string }

export const ReportBarControl: ControlComponent = ({ control, onAction }) => {
  const reports = (control.reports as ReportEntry[] | undefined) ?? [];
  const initial = (control.selected as string | undefined) ?? reports[0]?.value;
  const [selected, setSelected] = useState<string | undefined>(initial);
  if (reports.length === 0) return null;
  return (
    <Space size={4}>
      {reports.length > 1 && (
        <Select
          size="small"
          value={selected}
          style={{ minWidth: 180 }}
          onChange={setSelected}
          options={reports.map((r) => ({ value: r.value, label: r.text }))}
        />
      )}
      <Button
        size="small"
        icon={<PrinterOutlined />}
        title="Stampa PDF"
        onClick={() => selected && onAction('ExecuteBarReport', { option1: selected, option2: 'PDF' })}
      />
      <Button
        size="small"
        icon={<MailOutlined />}
        title="Invia per email"
        onClick={() => selected && onAction('EmailBarReport', { option1: selected, option2: 'PDF' })}
      />
    </Space>
  );
};

interface PrivilegeNode {
  name: string;
  description: string;
  hasChildren: boolean;
  open: boolean;
  level: number;
  navTarget?: string;
  grants: Record<string, { granted: boolean; inherited: boolean }>;
  children?: PrivilegeNode[];
}
interface Profile { name: string; inherited: string[] }

function flatten(nodes: PrivilegeNode[], out: PrivilegeNode[]) {
  for (const n of nodes) {
    out.push(n);
    if (n.open && n.children) flatten(n.children, out);
  }
}

export const GestorePrivilegiControl: ControlComponent = ({ control, onAction }) => {
  const profiles = (control.profiles as Profile[] | undefined) ?? [];
  const tree = (control.privileges as PrivilegeNode[] | undefined) ?? [];
  if (profiles.length === 0 || tree.length === 0) return null;
  const flat: PrivilegeNode[] = [];
  flatten(tree, flat);
  return (
    <Table<PrivilegeNode>
      size="small"
      pagination={false}
      rowKey="name"
      dataSource={flat}
      columns={[
        {
          title: 'Privilegio',
          dataIndex: 'description',
          render: (v, row) => (
            <span style={{ paddingLeft: row.level * 16, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {row.hasChildren ? (
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => onAction('TogglePrivilege', { option1: row.name })}
                >
                  {row.open ? <CaretDownOutlined /> : <CaretRightOutlined />}
                </span>
              ) : (
                <span style={{ width: 14 }} />
              )}
              {v || row.name}
            </span>
          ),
        },
        ...profiles.map((p) => ({
          title: p.name,
          key: p.name,
          width: 80,
          align: 'center' as const,
          render: (_: unknown, row: PrivilegeNode) => {
            const g = row.grants?.[p.name];
            if (!g) return null;
            return (
              <Checkbox
                checked={g.granted}
                disabled
                style={{ opacity: g.inherited ? 0.5 : 1 }}
                title={g.inherited ? 'ereditato' : undefined}
              />
            );
          },
        })),
      ]}
    />
  );
};

interface RoaResource { nome: string; hint?: string }
interface RoaCell { qtaP?: string; qtaC?: string; overrun?: boolean }
interface RoaTotal { qtaP?: string; qtaC?: string }
interface RoaActivity {
  description: string;
  level: number;
  successFee?: 'P' | 'OK' | '??';
  cells: RoaCell[];
  total: RoaTotal;
}
interface RoaSummary {
  description: string;
  tipoCalcolo: 'Q' | 'I';
  cells: string[];
  total: string;
}

export const RichOffAttControl: ControlComponent = ({ control }) => {
  if (control.visible === false) return null;
  const err = control.error as string | undefined;
  if (err) return <div style={{ color: '#a00', padding: 8 }}>{err}</div>;
  const mode = (control.mode as string | undefined) ?? 'preventivo';
  const consuntivo = mode === 'consuntivo';
  const um = control.unitaMisura as string | undefined;
  const resources = (control.resources as RoaResource[] | undefined) ?? [];
  const activities = (control.activities as RoaActivity[] | undefined) ?? [];
  const summaryRows = (control.summaryRows as RoaSummary[] | undefined) ?? [];
  if (resources.length === 0) return null;
  const cellStyle: React.CSSProperties = { padding: '2px 6px', border: '1px solid #e8e8e8', fontSize: 12 };
  const headerStyle: React.CSSProperties = { ...cellStyle, background: '#fafafa', fontWeight: 600, textAlign: 'center' };
  return (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={headerStyle} rowSpan={consuntivo ? 2 : 1}>Fasi progetto</th>
          {resources.map((r, i) => (
            <th key={i} style={headerStyle} colSpan={2} title={r.hint}>{r.nome}</th>
          ))}
          <th style={headerStyle} colSpan={2}>Totale</th>
        </tr>
        {consuntivo && (
          <tr>
            {resources.flatMap((_, i) => [
              <th key={`p${i}`} style={headerStyle}>P</th>,
              <th key={`c${i}`} style={headerStyle}>C</th>,
            ])}
            <th style={headerStyle}>P</th>
            <th style={headerStyle}>C</th>
          </tr>
        )}
      </thead>
      <tbody>
        {activities.map((a, i) => (
          <tr key={i} style={i % 2 ? { background: '#fcfcfc' } : undefined}>
            <td style={{ ...cellStyle, paddingLeft: 6 + (a.level || 0) * 12 }} title={a.successFee ? `Success fee (${a.successFee})` : undefined}>
              {a.description}
              {a.successFee === 'P' && ' (SF)'}
              {a.successFee === 'OK' && ' (SF-OK)'}
              {a.successFee === '??' && ' (SF-??)'}
            </td>
            {a.cells.flatMap((c, j) => consuntivo
              ? [
                  <td key={`${j}p`} style={{ ...cellStyle, textAlign: 'right', fontWeight: c.overrun ? 700 : undefined, color: c.overrun ? '#a00' : undefined }}>{c.qtaP ?? ''}</td>,
                  <td key={`${j}c`} style={{ ...cellStyle, textAlign: 'right' }}>{c.qtaC ?? ''}</td>,
                ]
              : [
                  <td key={j} style={{ ...cellStyle, textAlign: 'right' }} colSpan={2}>{c.qtaP ?? ''}{um ? ` ${um}` : ''}</td>,
                ]
            )}
            {consuntivo
              ? <>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600 }}>{a.total.qtaP ?? ''}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600 }}>{a.total.qtaC ?? ''}</td>
                </>
              : <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600 }} colSpan={2}>{a.total.qtaP ?? ''}{um ? ` ${um}` : ''}</td>}
          </tr>
        ))}
        {summaryRows.length > 0 && summaryRows.map((s, i) => (
          <tr key={`s${i}`} style={{ background: '#f0f5ff', fontWeight: 600 }}>
            <td style={cellStyle}>{s.description}</td>
            {s.cells.map((c, j) => (
              <td key={j} style={{ ...cellStyle, textAlign: 'right' }} colSpan={2} dangerouslySetInnerHTML={{ __html: c }} />
            ))}
            <td style={{ ...cellStyle, textAlign: 'right' }} colSpan={2} dangerouslySetInnerHTML={{ __html: s.total }} />
          </tr>
        ))}
      </tbody>
    </table>
  );
};

interface PartitarioRow {
  partitarioKey: string;
  stato?: string;
  dataScadenza?: string;
  importo?: string;
  importoSaldato?: string;
  importoResiduo?: string;
  descrizione?: string;
}
interface PartitarioGroup {
  documentKey: string;
  documentLabel: string;
  protocollo?: string;
  ivaSospesa?: boolean;
  totaleDoc?: string;
  anagraficaKey?: string;
  anagraficaLabel?: string;
  anticipi?: string[];
  items: PartitarioRow[];
}

const statoColor: Record<string, string> = {
  rataSaldata: '#52c41a',
  rataScaduta: '#ff4d4f',
  rataNonScaduta: '#1677ff',
};

export const PartitarioControl: ControlComponent = ({ control, onAction }) => {
  if (control.visible === false) return null;
  const title = (control.title as string | undefined) ?? 'Elenco delle scadenze aperte';
  const groups = (control.groups as PartitarioGroup[] | undefined) ?? [];
  const cellStyle: React.CSSProperties = { padding: '2px 6px', border: '1px solid #e8e8e8', fontSize: 12 };
  if (groups.length === 0) return <div style={{ color: '#999', padding: 8 }}>Nessuna scadenza aperta</div>;
  return (
    <div className="partitario-control">
      <div style={{ fontWeight: 600, padding: '4px 0', borderBottom: '1px solid #e8e8e8' }}>{title}</div>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginTop: 8 }}>
          <div style={{ background: '#fafafa', padding: '4px 8px', borderBottom: '1px solid #e8e8e8' }}>
            {g.anticipi && g.anticipi.length > 0 && (
              <span title={`Ft. ant. presso ${g.anticipi.join(', ')}`} style={{ color: '#d48806', marginRight: 4 }}>&#9888;</span>
            )}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onAction('ViewByKey', { option1: 'documentiDetail', option2: g.documentKey }); }}
              style={{ fontWeight: 600 }}
            >
              {g.documentLabel}
            </a>
            {g.protocollo && <span style={{ color: '#666', marginLeft: 8 }}>{g.protocollo}</span>}
            {g.ivaSospesa && <span style={{ color: '#d48806', marginLeft: 8 }}>IVA SOSP.</span>}
            {g.totaleDoc && <span style={{ color: '#666', marginLeft: 8 }}>({g.totaleDoc})</span>}
            {g.anagraficaKey && g.anagraficaLabel && (
              <>
                {' · '}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); onAction('ViewByKey', { option1: 'anagraficheDetail', option2: g.anagraficaKey! }); }}
                >
                  {g.anagraficaLabel}
                </a>
              </>
            )}
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                <th style={cellStyle}>Scadenza</th>
                <th style={cellStyle}>Descrizione</th>
                <th style={{ ...cellStyle, textAlign: 'right' }}>Importo</th>
                <th style={{ ...cellStyle, textAlign: 'right' }}>Saldato</th>
                <th style={{ ...cellStyle, textAlign: 'right' }}>Residuo</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((r) => (
                <tr key={r.partitarioKey}>
                  <td style={cellStyle}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6, background: statoColor[r.stato ?? ''] ?? '#ccc' }} />
                    {r.dataScadenza ?? ''}
                  </td>
                  <td style={cellStyle}>{r.descrizione ?? ''}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }} dangerouslySetInnerHTML={{ __html: r.importo ?? '' }} />
                  <td style={{ ...cellStyle, textAlign: 'right' }} dangerouslySetInnerHTML={{ __html: r.importoSaldato ?? '' }} />
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600 }} dangerouslySetInnerHTML={{ __html: r.importoResiduo ?? '' }} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

interface ConsEntry {
  key: string;
  data: string;
  oraInizio: string;
  oraFine?: string;
  risorsa?: string;
  attivita?: string;
  ordine?: string;
  hasSpesa?: boolean;
}

export const ConsuntivazioneControl: ControlComponent = ({ control, onAction }) => {
  if (control.visible === false) return null;
  const layout = control.layout as string | undefined;
  const data = control.data as string | undefined;
  const entries = (control.entries as ConsEntry[] | undefined) ?? [];
  const deleteCmd = (control.deleteCommand as string | undefined) ?? 'RubImpElimina';
  return (
    <div className="consuntivazione-control">
      <div style={{ background: '#fafafa', padding: '4px 8px', fontSize: 12, color: '#666' }}>
        Layout: <strong>
          {layout === 'R' ? 'Per risorsa' : layout === 'D' ? 'Per data' : layout === 'A' ? 'Per attività' : layout}
        </strong>
        {data && <> · Riferimento: <strong>{data}</strong></>}
        {entries.length === 0 && <span style={{ marginLeft: 12 }}>(nessun impegno registrato)</span>}
      </div>
      {entries.length > 0 && (
        <Table<ConsEntry>
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={entries}
          columns={[
            { title: 'Data', dataIndex: 'data', width: 90 },
            {
              title: 'Orario',
              width: 110,
              render: (_, row) => `${row.oraInizio}${row.oraFine ? ` - ${row.oraFine}` : ''}`,
            },
            { title: 'Risorsa', dataIndex: 'risorsa' },
            {
              title: 'Attività',
              render: (_, row) => (
                <span>
                  {row.attivita ?? '—'}
                  {row.ordine && <span style={{ color: '#666', marginLeft: 6 }}>({row.ordine})</span>}
                  {row.hasSpesa && <span title="Con nota spese" style={{ marginLeft: 6 }}>@</span>}
                </span>
              ),
            },
            {
              title: '',
              width: 32,
              render: (_, row) => (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<span>&#10005;</span>}
                  title="Elimina impegno"
                  onClick={() => onAction(deleteCmd, { option2: row.key })}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  );
};

interface SottocontoItem {
  tipoKey: string;
  tipoDescrizione: string;
  sottocontoKey?: string;
  sottocontoCodice?: string;
  sottocontoDescrizione?: string;
  canNavigate?: boolean;
  canCreate?: boolean;
  createOption1?: string;
  createOption2?: string;
}
interface SottocontoGroup { pdcKey: string; pdcDescription: string; items: SottocontoItem[] }

export const SottocontiControl: ControlComponent = ({ control, onAction }) => {
  const groups = (control.groups as SottocontoGroup[] | undefined) ?? [];
  const showPdcHeaders = !!control.showPdcHeaders;
  const createCmd = (control.createCommand as string | undefined) ?? 'CreaSottoconto';
  const navCmd = (control.navigateCommand as string | undefined) ?? 'ViewByKey';
  const navView = (control.navigateViewName as string | undefined) ?? 'sottocontiDetail';
  if (groups.length === 0) return null;
  return (
    <div className="sottoconti-control">
      {groups.map((g) => (
        <div key={g.pdcKey} style={{ marginBottom: 8 }}>
          {showPdcHeaders && (
            <div style={{ fontWeight: 600, borderBottom: '1px solid #eee', padding: '4px 0' }}>
              Piano dei conti: {g.pdcDescription}
            </div>
          )}
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {g.items.map((it) => (
                <tr key={`${g.pdcKey}.${it.tipoKey}`}>
                  <td style={{ padding: '2px 6px', color: '#666' }}>{it.tipoDescrizione}:</td>
                  <td style={{ padding: '2px 6px' }}>
                    {it.sottocontoKey ? (
                      <>
                        {it.sottocontoCodice} {it.sottocontoDescrizione}
                        {it.canNavigate && (
                          <Button
                            size="small"
                            type="link"
                            icon={<CaretRightOutlined />}
                            onClick={() => onAction(navCmd, { option1: navView, option2: it.sottocontoKey! })}
                            title="Apri"
                          />
                        )}
                      </>
                    ) : it.canCreate ? (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => onAction(createCmd, { option1: it.createOption1!, option2: it.createOption2! })}
                      >
                        crea…
                      </Button>
                    ) : (
                      <span style={{ color: '#bbb' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

interface AssegnResource { key: string; targetKey: string; viewName: string; descrizione: string }
interface AssegnAssignment {
  key: string;
  qta: string;
  pickingKey?: string;
  pickingNumber?: string;
  canDelete?: boolean;
}
interface AssegnCell {
  resourceKey: string;
  assignments: AssegnAssignment[];
  canCreate?: boolean;
  availableQta?: string;
  createParam?: string;
  canSwap?: boolean;
  swapParam?: string;
  pos?: number;
}
interface AssegnDemand {
  key: string;
  viewName: string;
  descrizione: string;
  cells: AssegnCell[];
}

export const AssegnazioniControl: ControlComponent = ({ control, onAction, onChange }) => {
  const resources = (control.resources as AssegnResource[] | undefined) ?? [];
  const demands = (control.demands as AssegnDemand[] | undefined) ?? [];
  const createCmd = (control.createCommand as string | undefined) ?? 'AssegnazioneCrea';
  const swapCmd = (control.swapCommand as string | undefined) ?? 'AssegnazioneSwap';
  const deleteCmd = (control.deleteCommand as string | undefined) ?? 'AssegnazioneAnnulla';
  if (resources.length === 0) return <span style={{ color: '#999' }}>Nessuna risorsa</span>;
  return (
    <table style={{ borderCollapse: 'collapse', border: '1px solid #e8e8e8', fontSize: 12 }}>
      <thead>
        <tr style={{ background: '#fafafa' }}>
          <th style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>Fabbisogno</th>
          {resources.map((r) => (
            <th
              key={r.key}
              style={{ padding: '4px 8px', border: '1px solid #e8e8e8', cursor: 'pointer', color: '#1677ff' }}
              onClick={() => onAction('ViewByKey', { option1: r.viewName, option2: r.targetKey })}
            >
              {r.descrizione}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {demands.map((d) => (
          <tr key={d.key}>
            <td
              style={{ padding: '4px 8px', border: '1px solid #e8e8e8', cursor: 'pointer', color: '#1677ff' }}
              onClick={() => onAction('ViewByKey', { option1: d.viewName, option2: d.key })}
            >
              {d.descrizione}
            </td>
            {d.cells.map((c) => (
              <td key={c.resourceKey} style={{ padding: '4px 8px', border: '1px solid #e8e8e8', verticalAlign: 'top' }}>
                {c.assignments.map((a) => (
                  <div key={a.key} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ minWidth: 48, textAlign: 'right' }}>{a.qta}</span>
                    {a.pickingNumber && (
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); onAction('ViewByKey', { option1: 'pickingDetail', option2: a.pickingKey! }); }}
                      >
                        {a.pickingNumber}
                      </a>
                    )}
                    {a.canDelete && (
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<span>&#10005;</span>}
                        title="Elimina"
                        onClick={() => onAction(deleteCmd, { option1: a.key })}
                      />
                    )}
                  </div>
                ))}
                {c.canCreate && (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Input
                      size="small"
                      style={{ width: 64 }}
                      defaultValue={c.availableQta}
                      onChange={(e) => onChange(`assegnaInput.${c.pos}`, e.target.value)}
                    />
                    <Button
                      size="small"
                      type="text"
                      style={{ color: 'green' }}
                      icon={<span>+</span>}
                      title="Crea"
                      onClick={() => onAction(createCmd, { option1: c.createParam! })}
                    />
                  </div>
                )}
                {c.canSwap && (
                  <Button
                    size="small"
                    type="text"
                    style={{ color: 'green' }}
                    icon={<span>&#8634;</span>}
                    title="Cambia"
                    onClick={() => onAction(swapCmd, { option1: c.swapParam! })}
                  />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

interface DispLotto { numero: string; qta: string; scadenza?: string }
interface DispRow { magazzino?: string; fornitore?: string; numeroOrdine?: string; qta: string; consegna?: string; lotti?: DispLotto[] }
interface DispSection { name: string; label: string; rows: DispRow[]; total?: string }

export const DisponibilitaControl: ControlComponent = ({ control }) => {
  const sections = (control.sections as DispSection[] | undefined) ?? [];
  const grandTotal = control.grandTotal as string | undefined;
  const empty = control.emptyMessage as string | undefined;
  const compact = !!control.compact;
  if (sections.length === 0) return <span style={{ color: '#a00' }}>{empty ?? ''}</span>;
  if (compact) {
    // Inline list-cell form: "magazzino: qta (lotto: ..., ...), fornitore X: qta consegna ..."
    const parts: string[] = [];
    for (const s of sections) {
      for (const r of s.rows) {
        if (s.name === 'giacenze') {
          let bit = `${r.magazzino}: ${r.qta}`;
          if (r.lotti && r.lotti.length > 0) {
            bit += ' (' + r.lotti.map((l) => `${l.numero} qta: ${l.qta}${l.scadenza ? ` scad: ${l.scadenza}` : ''}`).join(', ') + ')';
          }
          parts.push(bit);
        } else if (s.name === 'fornitori') {
          let bit = `fornitore ${r.fornitore}: ${r.qta}`;
          if (r.consegna) bit += ` consegna prevista il ${r.consegna}`;
          parts.push(bit);
        } else if (s.name === 'produzione') {
          parts.push(`in produzione ordine ${r.numeroOrdine}: ${r.qta}${r.consegna ? ` consegna il ${r.consegna}` : ''}`);
        }
      }
    }
    return <span>{parts.join(', ')}</span>;
  }
  return (
    <table style={{ borderCollapse: 'collapse', border: '1px solid #e8e8e8', fontSize: 12 }}>
      <tbody>
        {sections.map((s) => (
          <React.Fragment key={s.name}>
            <tr style={{ background: '#fafafa' }}>
              <td colSpan={4} style={{ padding: '4px 8px', border: '1px solid #e8e8e8', fontWeight: 600 }}>{s.label}</td>
            </tr>
            <tr style={{ color: '#666' }}>
              {s.name === 'giacenze' && <><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>Magazzino</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }} /><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8', textAlign: 'right' }}>Quantità</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>Lotti</th></>}
              {s.name === 'fornitori' && <><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>Fornitore</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>N. ordine</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8', textAlign: 'right' }}>Quantità</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>Consegna</th></>}
              {s.name === 'produzione' && <><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>Produzione</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>N. ordine</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8', textAlign: 'right' }}>Quantità</th><th style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>Consegna</th></>}
            </tr>
            {s.rows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>{r.magazzino ?? r.fornitore ?? ''}</td>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>{r.numeroOrdine ?? ''}</td>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8', textAlign: 'right' }}>{r.qta}</td>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>
                  {r.lotti && r.lotti.length > 0
                    ? r.lotti.map((l, j) => (
                        <div key={j}>{l.numero} qta: {l.qta}{l.scadenza ? ` scad: ${l.scadenza}` : ''}</div>
                      ))
                    : r.consegna ?? ''}
                </td>
              </tr>
            ))}
            {s.total && (
              <tr style={{ fontWeight: 600 }}>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }}>TOTALE</td>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }} />
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8', textAlign: 'right' }}>{s.total}</td>
                <td style={{ padding: '2px 8px', border: '1px solid #e8e8e8' }} />
              </tr>
            )}
          </React.Fragment>
        ))}
        {grandTotal && (
          <tr style={{ fontWeight: 700, background: '#f0f5ff' }}>
            <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }}>TOTALE GENERALE</td>
            <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }} />
            <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8', textAlign: 'right' }}>{grandTotal}</td>
            <td style={{ padding: '4px 8px', border: '1px solid #e8e8e8' }} />
          </tr>
        )}
      </tbody>
    </table>
  );
};

interface CdmsRow {
  containerId: string;
  containerDescription: string;
  selectedKey?: string;
  resourceNodeKey?: string;
  selectedDescription?: string;
  options?: { value: string; text: string }[];
}

export const CdmsClassControl: ControlComponent = ({ control, onAction, onChange }) => {
  const rows = (control.rows as CdmsRow[] | undefined) ?? [];
  const isQuery = !!control.isQuery;
  const deleteCmd = (control.deleteCommand as string | undefined) ?? 'CdmsNodiRisorseDelete';
  const navpath = control.navpath as string | undefined;
  const name = control.name as string | undefined;
  const editable = control.editable !== false;
  return (
    <Table<CdmsRow>
      size="small"
      pagination={false}
      rowKey="containerId"
      dataSource={rows}
      showHeader={false}
      columns={[
        {
          dataIndex: 'containerDescription',
          width: 180,
          align: 'right' as const,
          render: (v) => <strong>{v}:</strong>,
        },
        {
          width: 24,
          render: (_, row) => (editable && !isQuery && row.resourceNodeKey)
            ? (
                <Button
                  size="small"
                  type="text"
                  icon={<span style={{ color: '#c00' }}>&#10005;</span>}
                  title="Elimina"
                  onClick={() => onAction(deleteCmd, { option1: row.resourceNodeKey as string })}
                />
              )
            : null,
        },
        {
          render: (_, row) => editable
            ? (
                <Select
                  size="small"
                  style={{ minWidth: 280 }}
                  allowClear
                  value={row.selectedKey}
                  options={(row.options ?? []).map((o) => ({ value: o.value, label: o.text }))}
                  onChange={(next) => {
                    if (!name) return;
                    // Mirror of legacy: array-of-selections per container row
                    onChange(name, next ?? '');
                    if (navpath) onAction('Post', { navpath, option1: name });
                  }}
                />
              )
            : <span>{row.selectedDescription}</span>,
        },
      ]}
    />
  );
};

interface CalDay { key: string; label: string }
interface CalTratta {
  key: string;
  viaggioKey: string;
  percorsoShort: string;
  details: Record<string, string>;
}
interface CalCell { day: string; morning: CalTratta[]; afternoon: CalTratta[] }
interface CalVehicle { id: string; description: string; cells: CalCell[] }

function renderTrattaList(list: CalTratta[], onAction: (a: string, p?: Record<string, string>) => void) {
  if (list.length === 0) return null;
  return (
    <div>
      {list.map((t) => (
        <div key={t.key}>
          <a
            href="#"
            title={Object.entries(t.details).map(([k, v]) => `${k}: ${v}`).join('\n')}
            onClick={(e) => {
              e.preventDefault();
              onAction('ViewByKey', { option1: 'lgtcViaggiDetail', option2: t.viaggioKey });
            }}
          >
            {t.percorsoShort}
          </a>
        </div>
      ))}
    </div>
  );
}

export const LgtcCalendarioControl: ControlComponent = ({ control, onAction }) => {
  const days = (control.days as CalDay[] | undefined) ?? [];
  const vehicles = (control.vehicles as CalVehicle[] | undefined) ?? [];
  if (days.length === 0 || vehicles.length === 0) {
    return <span style={{ color: '#999' }}>Nessun dato calendario</span>;
  }
  return (
    <table className="lgtc-calendar" style={{ borderCollapse: 'collapse', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ width: 140, background: '#f5f5f5', padding: '4px 8px', border: '1px solid #e8e8e8' }} />
          {days.map((d) => (
            <th key={d.key} colSpan={2} style={{ textAlign: 'center', background: '#f5f5f5', padding: '4px 8px', border: '1px solid #e8e8e8' }}>
              {d.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {vehicles.map((v) => (
          <tr key={v.id}>
            <td style={{ padding: '4px 8px', background: '#fafafa', border: '1px solid #e8e8e8', fontWeight: 500 }}>
              {v.description}
            </td>
            {v.cells.map((c) => (
              <React.Fragment key={c.day}>
                <td style={{ width: 90, verticalAlign: 'top', padding: 4, border: '1px solid #e8e8e8', fontSize: 12 }}>
                  {renderTrattaList(c.morning, onAction)}
                </td>
                <td style={{ width: 90, verticalAlign: 'top', padding: 4, border: '1px solid #e8e8e8', fontSize: 12 }}>
                  {renderTrattaList(c.afternoon, onAction)}
                </td>
              </React.Fragment>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Placeholder for entrasp controls that have getJsonType but no renderJSON yet
 *  (server emits only base descriptor). Shows a clearly marked stub so screens
 *  don't display a misleading text input. */
function stubPlaceholder(label: string): ControlComponent {
  const Placeholder: ControlComponent = ({ control }) => (
    <div
      className="entrasp-stub"
      style={{
        padding: '4px 8px',
        border: '1px dashed #d46b08',
        color: '#d46b08',
        background: '#fff7e6',
        borderRadius: 4,
        fontSize: 12,
      }}
      title={`Control "${label}" not yet ported — server emits only base descriptor`}
    >
      {label}: <em>non ancora portato</em>
      {control.hint && <span style={{ marginLeft: 6, color: '#999' }}>({control.hint})</span>}
    </div>
  );
  Placeholder.displayName = `Stub_${label}`;
  return Placeholder;
}

export const AssegnazioniPlaceholder = stubPlaceholder('assegnazioni');
export const ConsuntivazionePlaceholder = stubPlaceholder('consuntivazione');
export const DisponibilitaPlaceholder = stubPlaceholder('disponibilita');
export const PartitarioPlaceholder = stubPlaceholder('partitario');
export const RichOffAttPlaceholder = stubPlaceholder('richOffAtt');
export const SottocontiPlaceholder = stubPlaceholder('sottoconti');
export const CdmsClassPlaceholder = stubPlaceholder('cdmsClass');
export const LgtcCalendarioPlaceholder = stubPlaceholder('lgtcCalendario');

export const PromptBuilderControl: ControlComponent = ({ control, onChange, onAction }) => {
  const readOnly = control.readOnly === true || control.editable === false;
  const schemaKey = control.schemaKey as string | undefined;
  const parentId = control.parentId as string | undefined;
  const name = control.name as string | undefined;
  const value = (control.value as string | undefined) ?? '';
  const reload = control.reload === 'true';
  return (
    <div className="promptbuilder-control" style={{ width: '100%' }}>
      <Input.TextArea
        id={control.id}
        defaultValue={value}
        rows={3}
        disabled={readOnly}
        title={control.hint}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        onChange={(e) => name && onChange(name, e.target.value)}
        onBlur={() => {
          if (reload && control.navpath) {
            onAction('Post', {
              navpath: control.navpath as string,
              option1: (control.option1 as string | undefined) ?? name ?? '',
            });
          }
        }}
      />
      <div style={{ fontSize: 11, color: '#999', marginTop: 2, display: 'flex', gap: 8 }}>
        <span>Prompt builder</span>
        {schemaKey && <span>· schema: <code>{schemaKey}</code></span>}
        {parentId && <span>· parent: <code>{parentId}</code></span>}
      </div>
    </div>
  );
};
