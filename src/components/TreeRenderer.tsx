import React, { useState, useCallback, useMemo, useRef, useEffect, useContext } from 'react';
import { Tree, Input, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { UITree, TreeNode } from '../types/ui';
import { SidContext } from './ViewRenderer';
import * as api from '../services/api';

const { Text } = Typography;

interface TreeRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
}

/** Convert server TreeNode[] to Ant Design DataNode[] with optional match highlighting */
function toAntTreeData(nodes: TreeNode[], searchText?: string): React.ComponentProps<typeof Tree>['treeData'] {
  return nodes.map((node) => {
    const matched = node.matched;
    let titleEl: React.ReactNode = node.title;
    // Highlight matched nodes during search
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

const TreeRenderer: React.FC<TreeRendererProps> = ({ ui, onAction }) => {
  const sid = useContext(SidContext);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>(ui.treeNodes || []);
  const [filteredData, setFilteredData] = useState<TreeNode[] | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the unfiltered tree data in sync with ui prop
  const prevTreeNodesRef = useRef(ui.treeNodes);
  useEffect(() => {
    if (ui.treeNodes && ui.treeNodes !== prevTreeNodesRef.current) {
      prevTreeNodesRef.current = ui.treeNodes;
      setTreeData(ui.treeNodes);
    }
  }, [ui.treeNodes]);

  const navigateView = ui.navigateView;

  const onExpand = useCallback((keys: React.Key[]) => {
    setExpandedKeys(keys as string[]);
  }, []);

  // Lazy load children when expanding a node
  const onLoadData = useCallback(async (node: { key: React.Key; children?: unknown[] }) => {
    if (node.children) return;
    const key = String(node.key);
    document.body.style.cursor = 'wait';
    try {
      const resp = await api.postAction('ToggleTreeNode', {
        navpath: ui.path || '',
        option1: key,
      }, undefined, sid);
      if (resp.ui?.treeNodes) {
        const findNode = (nodes: TreeNode[], targetKey: string): TreeNode | undefined => {
          for (const n of nodes) {
            if (n.key === targetKey) return n;
            if (n.children) {
              const found = findNode(n.children, targetKey);
              if (found) return found;
            }
          }
          return undefined;
        };
        const updatedNode = findNode(resp.ui.treeNodes, key);
        if (updatedNode?.children) {
          const mergeChildren = (nodes: TreeNode[], targetKey: string, children: TreeNode[]): TreeNode[] => {
            return nodes.map(n => {
              if (n.key === targetKey) return { ...n, children };
              if (n.children) return { ...n, children: mergeChildren(n.children, targetKey, children) };
              return n;
            });
          };
          setTreeData(prev => mergeChildren(prev, key, updatedNode.children!));
        }
        setLoadedKeys(prev => [...prev, key]);
      }
    } finally {
      document.body.style.cursor = '';
    }
  }, [ui.path, sid]);

  // Handle node click — navigate to detail view
  const onSelect = useCallback((keys: React.Key[]) => {
    if (keys.length === 0 || !navigateView) return;
    const key = String(keys[0]);
    onAction('LocateAndNavigate', { navpath: key, option1: navigateView });
  }, [navigateView, onAction]);

  // Server-side search with debounce
  const handleSearch = useCallback((value: string) => {
    setSearchText(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim()) {
      // Clear filter — show original tree
      setFilteredData(null);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      document.body.style.cursor = 'wait';
      try {
        const resp = await api.postAction('FilterTree', {
          navpath: ui.path || '',
          option1: value.trim(),
        }, undefined, sid);
        if (resp.ui?.treeNodes) {
          setFilteredData(resp.ui.treeNodes);
          // Expand all non-leaf nodes in the filtered result
          setExpandedKeys(collectNonLeafKeys(resp.ui.treeNodes));
        } else {
          setFilteredData([]);
        }
      } catch {
        // On error, clear filter
        setFilteredData(null);
      } finally {
        document.body.style.cursor = '';
      }
    }, 400); // 400ms debounce
  }, [ui.path, sid]);

  const displayData = filteredData ?? treeData;
  const isFiltered = filteredData !== null;
  const antTreeData = useMemo(
    () => toAntTreeData(displayData, isFiltered ? searchText : undefined),
    [displayData, isFiltered, searchText]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {ui.title && <div className="view-title">{ui.title}</div>}
      <div style={{ padding: '8px 8px 4px' }}>
        <Input
          placeholder="Cerca nell'albero..."
          prefix={<SearchOutlined />}
          allowClear
          value={searchText}
          onChange={(e) => handleSearch(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
        {antTreeData && antTreeData.length > 0 ? (
          <Tree
            treeData={antTreeData}
            expandedKeys={isFiltered ? expandedKeys : expandedKeys}
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
  );
};

export default TreeRenderer;
