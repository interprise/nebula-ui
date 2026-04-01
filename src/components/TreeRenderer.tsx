import React, { useState, useCallback, useMemo } from 'react';
import { Tree, Input, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { UITree, TreeNode } from '../types/ui';
import * as api from '../services/api';

const { Text } = Typography;

interface TreeRendererProps {
  ui: UITree;
  onAction: (action: string, params?: Record<string, string>) => void;
  sid?: string;
}

/** Convert server TreeNode[] to Ant Design DataNode[] */
function toAntTreeData(nodes: TreeNode[]): React.ComponentProps<typeof Tree>['treeData'] {
  return nodes.map((node) => ({
    key: node.key,
    title: node.hint ? (
      <span title={node.hint}>{node.title}</span>
    ) : node.title,
    isLeaf: node.isLeaf,
    children: node.children ? toAntTreeData(node.children) : undefined,
  }));
}

/** Collect all keys from a tree (for expand-all after search) */
function collectKeys(nodes: TreeNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    keys.push(node.key);
    if (node.children) keys.push(...collectKeys(node.children));
  }
  return keys;
}

/** Filter tree nodes by search text, keeping ancestor paths */
function filterTree(nodes: TreeNode[], search: string): TreeNode[] {
  const lower = search.toLowerCase();
  const result: TreeNode[] = [];
  for (const node of nodes) {
    const titleMatch = node.title.toLowerCase().includes(lower);
    const filteredChildren = node.children ? filterTree(node.children, search) : [];
    if (titleMatch || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: filteredChildren.length > 0 ? filteredChildren : node.children,
      });
    }
  }
  return result;
}

const TreeRenderer: React.FC<TreeRendererProps> = ({ ui, onAction, sid }) => {
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<TreeNode[]>(ui.treeNodes || []);

  const navigateView = ui.navigateView;

  // Handle node expand/collapse — toggle on server + load children if needed
  const onExpand = useCallback((keys: React.Key[]) => {
    setExpandedKeys(keys as string[]);
  }, []);

  // Lazy load children when expanding a node that hasn't been loaded yet
  const onLoadData = useCallback(async (node: { key: React.Key; children?: unknown[] }) => {
    if (node.children) return; // Already loaded
    const key = String(node.key);
    // Toggle the node on the server to load its children
    document.body.style.cursor = 'wait';
    try {
      const resp = await api.postAction('ToggleTreeNode', {
        navpath: ui.path || '',
        option1: key,
      }, undefined, sid);
      // The server re-renders the tree with the node open — extract the children
      if (resp.ui?.treeNodes) {
        // Find the node in the response and get its children
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
          // Merge children into the local tree
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

  // Filter tree data based on search text
  const displayData = useMemo(() => {
    if (!searchText) return treeData;
    return filterTree(treeData, searchText);
  }, [treeData, searchText]);

  // When searching, expand all visible nodes
  const displayExpandedKeys = useMemo(() => {
    if (!searchText) return expandedKeys;
    return collectKeys(displayData);
  }, [searchText, expandedKeys, displayData]);

  const antTreeData = useMemo(() => toAntTreeData(displayData), [displayData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {ui.title && <div className="view-title">{ui.title}</div>}
      <div style={{ padding: '8px 8px 4px' }}>
        <Input
          placeholder="Cerca nell'albero..."
          prefix={<SearchOutlined />}
          allowClear
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ maxWidth: 400 }}
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
        {antTreeData && antTreeData.length > 0 ? (
          <Tree
            treeData={antTreeData}
            expandedKeys={displayExpandedKeys}
            onExpand={onExpand}
            loadData={onLoadData}
            loadedKeys={loadedKeys}
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
