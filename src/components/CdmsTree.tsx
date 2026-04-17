import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tree, Input, Dropdown, Modal, Button, Tooltip, message } from 'antd';
import {
  FolderOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { DataNode, EventDataNode } from 'antd/es/tree';
import * as api from '../services/api';
import type { CdmsNode } from '../services/api';

interface CdmsTreeProps {
  collapsed: boolean;
  onFolderClick: (cdmsId: string, folderName: string) => void;
  onAction: (action: string, params?: Record<string, string>) => void;
}

/** Convert server CdmsNode to Ant Design DataNode */
function toDataNode(node: CdmsNode): DataNode {
  return {
    key: node.cdmsId,
    title: node.text,
    isLeaf: !!node.leaf,
    icon: (props: { expanded?: boolean }) =>
      props.expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
    // Store server data for context menu
    ...({ cdmsData: node } as unknown as Record<string, unknown>),
  };
}

/** Walk tree to find a node by key and update it */
function updateTreeNode(
  nodes: DataNode[],
  key: React.Key,
  updater: (node: DataNode) => DataNode,
): DataNode[] {
  return nodes.map((n) => {
    if (n.key === key) return updater(n);
    if (n.children) return { ...n, children: updateTreeNode(n.children, key, updater) };
    return n;
  });
}

/** Collect all keys from nodes (for expand-all during filter) */
function collectAllKeys(nodes: DataNode[]): React.Key[] {
  const keys: React.Key[] = [];
  for (const n of nodes) {
    keys.push(n.key);
    if (n.children) keys.push(...collectAllKeys(n.children));
  }
  return keys;
}

/** Filter tree nodes by text, keeping matching nodes + ancestors */
function filterTree(nodes: DataNode[], lowerFilter: string): DataNode[] | null {
  let anyMatch = false;
  const filtered = nodes.map((n) => {
    const titleMatch = String(n.title).toLowerCase().includes(lowerFilter);
    const childResult = n.children ? filterTree(n.children, lowerFilter) : null;
    if (titleMatch || childResult) {
      anyMatch = true;
      return { ...n, children: childResult || n.children };
    }
    return null;
  }).filter(Boolean) as DataNode[];
  return anyMatch ? filtered : null;
}

const CdmsTree: React.FC<CdmsTreeProps> = ({ collapsed, onFolderClick, onAction }) => {
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    node: DataNode;
    x: number;
    y: number;
  } | null>(null);
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedFilter, setDebouncedFilter] = useState('');

  // Load roots on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.cdmsGetRoots();
        if (cancelled) return;
        setIsAdmin(resp.admin);
        setTreeData(resp.nodes.map(toDataNode));
      } catch (e) {
        message.error(`Errore caricamento documentale: ${e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounce filter
  const handleFilterChange = useCallback((value: string) => {
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    if (!value) {
      setFilter('');
      setDebouncedFilter('');
      return;
    }
    setFilter(value);
    filterTimerRef.current = setTimeout(() => {
      setDebouncedFilter(value);
    }, 300);
  }, []);

  // Filtered tree data
  const displayData = useMemo(() => {
    if (!debouncedFilter) return treeData;
    return filterTree(treeData, debouncedFilter.toLowerCase()) || [];
  }, [treeData, debouncedFilter]);

  // Auto-expand all when filtering
  const displayExpandedKeys = useMemo(() => {
    if (!debouncedFilter) return expandedKeys;
    return collectAllKeys(displayData);
  }, [debouncedFilter, displayData, expandedKeys]);

  // Lazy load children on expand
  const onLoadData = useCallback(async (node: EventDataNode<DataNode>) => {
    if (node.children && node.children.length > 0) return; // already loaded
    const cdmsData = (node as unknown as { cdmsData: CdmsNode }).cdmsData;
    if (!cdmsData) return;
    try {
      const children = await api.cdmsGetChildren(cdmsData.cdmsId);
      const childNodes = children.map(toDataNode);
      setTreeData((prev) =>
        updateTreeNode(prev, node.key, (n) => ({
          ...n,
          children: childNodes,
          isLeaf: childNodes.length === 0,
        })),
      );
    } catch (e) {
      message.error(`Errore espansione nodo: ${e}`);
    }
  }, []);

  // Node click → open document list filtered by this folder
  const onSelect = useCallback(
    (keys: React.Key[], info: { node: EventDataNode<DataNode> }) => {
      if (keys.length === 0) return;
      setSelectedKeys(keys);
      const node = info.node;
      const title = String(node.title);
      const cdmsId = String(node.key);
      onFolderClick(cdmsId, title);
    },
    [onFolderClick],
  );

  // Right-click context menu
  const onRightClick = useCallback(
    ({ event, node }: { event: React.MouseEvent; node: EventDataNode<DataNode> }) => {
      event.preventDefault();
      event.stopPropagation();
      const cdmsData = (node as unknown as { cdmsData: CdmsNode }).cdmsData;
      if (!cdmsData?.editable && !isAdmin) return; // not editable
      setContextMenu({ node, x: event.clientX, y: event.clientY });
    },
    [isAdmin],
  );

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  // Reload children of a node (after mutation)
  const reloadNode = useCallback(async (cdmsId: string) => {
    try {
      const children = await api.cdmsGetChildren(cdmsId);
      const childNodes = children.map(toDataNode);
      setTreeData((prev) =>
        updateTreeNode(prev, cdmsId, (n) => ({ ...n, children: childNodes })),
      );
    } catch {
      // ignore
    }
  }, []);

  // Context menu actions
  const handleNewFolder = useCallback(
    (parentNode: DataNode) => {
      let folderName = '';
      Modal.confirm({
        title: 'Nuova cartella',
        content: (
          <Input
            placeholder="Nome cartella"
            autoFocus
            onChange={(e) => { folderName = e.target.value; }}
            onPressEnter={() => Modal.destroyAll()}
          />
        ),
        okText: 'Crea',
        cancelText: 'Annulla',
        onOk: async () => {
          if (!folderName.trim()) return;
          const parentId = String(parentNode.key);
          const resp = await api.cdmsExec('newdir', { path: parentId, text: folderName.trim() });
          if (resp.error) {
            message.error(resp.error);
          } else {
            // Expand parent and reload children
            setExpandedKeys((prev) => prev.includes(parentId) ? prev : [...prev, parentId]);
            await reloadNode(parentId);
          }
        },
      });
    },
    [reloadNode],
  );

  const handleRename = useCallback(
    (node: DataNode) => {
      let newName = String(node.title);
      Modal.confirm({
        title: 'Rinomina cartella',
        content: (
          <Input
            defaultValue={newName}
            autoFocus
            onChange={(e) => { newName = e.target.value; }}
            onPressEnter={() => Modal.destroyAll()}
          />
        ),
        okText: 'Rinomina',
        cancelText: 'Annulla',
        onOk: async () => {
          if (!newName.trim()) return;
          const nodeId = String(node.key);
          const resp = await api.cdmsExec('rename', { path: nodeId, newname: newName.trim() });
          if (resp.error) {
            message.error(resp.error);
          } else {
            // Update title locally
            setTreeData((prev) =>
              updateTreeNode(prev, node.key, (n) => ({ ...n, title: newName.trim() })),
            );
          }
        },
      });
    },
    [],
  );

  const handleDelete = useCallback(
    (node: DataNode) => {
      Modal.confirm({
        title: 'Elimina cartella',
        content: `Eliminare la cartella "${node.title}"?`,
        okText: 'Elimina',
        okButtonProps: { danger: true },
        cancelText: 'Annulla',
        onOk: async () => {
          const nodeId = String(node.key);
          const resp = await api.cdmsExec('delete', { path: nodeId });
          if (resp.error) {
            message.error(resp.error);
          } else {
            // Remove node from tree
            setTreeData((prev) => {
              const remove = (nodes: DataNode[]): DataNode[] =>
                nodes.filter((n) => n.key !== node.key).map((n) =>
                  n.children ? { ...n, children: remove(n.children) } : n,
                );
              return remove(prev);
            });
          }
        },
      });
    },
    [],
  );

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    return [
      { key: 'newdir', icon: <PlusOutlined />, label: 'Nuova cartella', onClick: () => handleNewFolder(contextMenu.node) },
      { key: 'rename', icon: <EditOutlined />, label: 'Rinomina', onClick: () => handleRename(contextMenu.node) },
      { key: 'delete', icon: <DeleteOutlined />, label: 'Elimina', danger: true, onClick: () => handleDelete(contextMenu.node) },
    ];
  }, [contextMenu, handleNewFolder, handleRename, handleDelete]);

  if (collapsed) {
    return (
      <div style={{ textAlign: 'center', padding: 16, color: '#999' }}>
        <FolderOutlined style={{ fontSize: 20 }} />
      </div>
    );
  }

  return (
    <div className="cdms-tree-container">
      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 4 }}>
        <Input
          placeholder="Cerca cartelle..."
          prefix={<SearchOutlined />}
          allowClear
          value={filter}
          onChange={(e) => handleFilterChange(e.target.value)}
          size="small"
          style={{ flex: 1 }}
        />
        {isAdmin && (
          <Tooltip title="Nuovo albero">
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => onAction('AddPage', { viewName: 'cdmsNodiClassificazioneDetail' })}
            />
          </Tooltip>
        )}
      </div>
      <div className="cdms-tree-content">
        <Tree
          showIcon
          treeData={displayData}
          expandedKeys={displayExpandedKeys}
          selectedKeys={selectedKeys}
          onExpand={(keys) => setExpandedKeys(keys)}
          onSelect={onSelect}
          onRightClick={onRightClick}
          loadData={onLoadData}
          blockNode
        />
      </div>
      {contextMenu && (
        <Dropdown
          menu={{ items: contextMenuItems }}
          open
          trigger={[]}
          overlayStyle={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}
        >
          <span style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }} />
        </Dropdown>
      )}
    </div>
  );
};

export default CdmsTree;
