import React, { useState, useCallback, useMemo, useRef, useEffect, useContext } from 'react';
import { Tree, Input, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { UITree, TreeNode } from '../types/ui';
import { SidContext } from './ViewRenderer';
import ViewRenderer from './ViewRenderer';
import * as api from '../services/api';

const { Text } = Typography;

interface TreeRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
  onChange: (name: string, value: unknown) => void;
}

/** Convert server TreeNode[] to Ant Design DataNode[] with optional match highlighting */
function toAntTreeData(nodes: TreeNode[], searchText?: string): React.ComponentProps<typeof Tree>['treeData'] {
  return nodes.map((node) => {
    const matched = node.matched;
    let titleEl: React.ReactNode = node.title;
    if (searchText && matched) {
      titleEl = <strong>{node.title}</strong>;
    }
    if (node.hint) {
      titleEl = <span title={node.hint}>{titleEl}</span>;
    }
    return {
      key: node.key,
      title: titleEl,
      isLeaf: node.isLeaf,
      children: node.children ? toAntTreeData(node.children, searchText) : undefined,
    };
  });
}

/** Collect all non-leaf keys from a tree (for expanding all after search) */
function collectNonLeafKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (!node.isLeaf) keys.push(node.key);
    if (node.children) keys.push(...collectNonLeafKeys(node.children));
  }
  return keys;
}

const TreeRenderer: React.FC<TreeRendererProps> = ({ ui, onAction, onChange }) => {
  const sid = useContext(SidContext);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>(ui.treeNodes || []);
  const [filteredData, setFilteredData] = useState<TreeNode[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Detail pane state
  const [detailUi, setDetailUi] = useState<UITree | null>(null);
  const detailFormValues = useRef<Record<string, string>>({});
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract form values from a detail UI response
  const extractDetailFormValues = useCallback((dui: UITree): Record<string, string> => {
    const values: Record<string, string> = {};
    const walkRows = (rows: UITree['rows']) => {
      if (!rows) return;
      for (const row of rows) {
        for (const cell of row.cells) {
          const ctrl = cell.control;
          if (!ctrl) continue;
          if (ctrl.editable && !ctrl.noPost && !ctrl.disabled) {
            const name = ctrl.name || ctrl.id;
            if (name && ctrl.value != null && typeof ctrl.value !== 'object') {
              values[name] = String(ctrl.value);
            }
          }
          if (ctrl.contentRows) walkRows(ctrl.contentRows);
        }
      }
    };
    walkRows(dui.rows);
    return values;
  }, []);

  const prevTreeNodesRef = useRef(ui.treeNodes);
  useEffect(() => {
    if (ui.treeNodes && ui.treeNodes !== prevTreeNodesRef.current) {
      prevTreeNodesRef.current = ui.treeNodes;
      setTreeData(ui.treeNodes);
    }
  }, [ui.treeNodes]);

  // Pick up detail responses routed through Shell (Save/Post on tree+detail)
  const detailResponse = (ui as unknown as Record<string, unknown>)._detailResponse as UITree | undefined;
  const prevDetailResponseRef = useRef(detailResponse);
  useEffect(() => {
    if (detailResponse && detailResponse !== prevDetailResponseRef.current) {
      prevDetailResponseRef.current = detailResponse;
      setDetailUi(detailResponse);
      detailFormValues.current = extractDetailFormValues(detailResponse);
    }
  }, [detailResponse, extractDetailFormValues]);

  const navigateView = ui.navigateView;

  const onExpand = useCallback((keys: React.Key[]) => {
    setExpandedKeys(keys as string[]);
  }, []);

  // Lazy load children for a node
  const onLoadData = useCallback(async (node: { key: React.Key; children?: unknown[] }) => {
    if (node.children) return;
    const key = String(node.key);
    document.body.style.cursor = 'wait';
    try {
      const resp = await api.postAction('LoadTreeChildren', {
        navpath: ui.path || '',
        option1: key,
        option2: ui.viewName || '',
      }, undefined, sid);
      const children = (resp.ui as unknown as Record<string, unknown>)?.treeChildren as TreeNode[] | undefined;
      if (children) {
        const mergeChildren = (nodes: TreeNode[], targetKey: string, newChildren: TreeNode[]): TreeNode[] => {
          return nodes.map(n => {
            if (n.key === targetKey) return { ...n, children: newChildren };
            if (n.children) return { ...n, children: mergeChildren(n.children, targetKey, newChildren) };
            return n;
          });
        };
        setTreeData(prev => mergeChildren(prev, key, children));
      }
      setLoadedKeys(prev => [...prev, key]);
    } finally {
      document.body.style.cursor = '';
    }
  }, [ui.path, sid]);

  // Handle node click — load detail in right pane
  const onSelect = useCallback(async (keys: React.Key[]) => {
    if (keys.length === 0 || !navigateView) return;
    const key = String(keys[0]);
    setSelectedKey(key);
    document.body.style.cursor = 'wait';
    try {
      const resp = await api.postAction('LocateAndNavigate', {
        navpath: key,
        option1: navigateView,
      }, undefined, sid);
      if (resp.ui) {
        setDetailUi(resp.ui);
        detailFormValues.current = extractDetailFormValues(resp.ui);
      }
    } finally {
      document.body.style.cursor = '';
    }
  }, [navigateView, sid, extractDetailFormValues]);

  // Handle detail field changes — update local ref AND Shell's formValues
  const handleDetailChange = useCallback((name: string, value: unknown) => {
    const strValue = value == null ? '' : String(value);
    detailFormValues.current[name] = strValue;
    onChange(name, value);
  }, [onChange]);


  // Server-side search with debounce
  const handleSearch = useCallback((value: string) => {
    setSearchText(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim()) {
      setFilteredData(null);
      setExpandedKeys([]);
      setLoadedKeys([]);
      setTreeData(ui.treeNodes || []);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      document.body.style.cursor = 'wait';
      try {
        const resp = await api.postAction('FilterTree', {
          navpath: ui.path || '',
          option1: value.trim(),
          option2: ui.viewName || '',
        }, undefined, sid);
        if (resp.ui?.treeNodes) {
          setFilteredData(resp.ui.treeNodes);
          setExpandedKeys(collectNonLeafKeys(resp.ui.treeNodes));
        } else {
          setFilteredData([]);
        }
      } catch {
        setFilteredData(null);
      } finally {
        document.body.style.cursor = '';
      }
    }, 400);
  }, [ui.path, sid]);

  const displayData = filteredData ?? treeData;
  const isFiltered = filteredData !== null;
  const antTreeData = useMemo(
    () => toAntTreeData(displayData, isFiltered ? searchText : undefined),
    [displayData, isFiltered, searchText]
  );

  // Memoize the detail pane so tree state changes (expand, select) don't re-render it
  // Only re-render when detailUi changes (new node selected or Save response)
  const detailPane = useMemo(() => {
    if (!detailUi) return null;
    return (
      <ViewRenderer
        ui={detailUi}
        onAction={onAction}
        onChange={handleDetailChange}
        embedded
      />
    );
  }, [detailUi, onAction, handleDetailChange]);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0 }}>
      {/* Left pane: tree */}
      <div style={{ display: 'flex', flexDirection: 'column', width: detailUi ? 300 : '100%', minWidth: 250, borderRight: detailUi ? '1px solid #e8e8e8' : undefined, transition: 'width 0.2s' }}>
        {ui.title && <div className="view-title">{ui.title}</div>}
        <div style={{ padding: '8px 8px 4px' }}>
          <Input
            placeholder="Cerca nell'albero..."
            prefix={<SearchOutlined />}
            allowClear
            value={searchText}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
          {antTreeData && antTreeData.length > 0 ? (
            <Tree
              treeData={antTreeData}
              expandedKeys={expandedKeys}
              selectedKeys={selectedKey ? [selectedKey] : []}
              onExpand={onExpand}
              loadData={isFiltered ? undefined : onLoadData}
              loadedKeys={isFiltered ? undefined : loadedKeys}
              onSelect={onSelect}
              showLine
              blockNode
            />
          ) : (
            <Text type="secondary" style={{ padding: 16, display: 'block' }}>
              {searchText ? 'Nessun risultato' : 'Nessun elemento'}
            </Text>
          )}
        </div>
      </div>

      {/* Right pane: detail */}
      {detailUi && (
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {detailPane}
        </div>
      )}
    </div>
  );
};

export default TreeRenderer;
