import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../services/api';
import type { MetadataRow } from '../services/api';
import type { UIControl } from '../types/ui';

const VALID = /[A-Za-z0-9_]/;
const VALID_OR_DOT = /[A-Za-z0-9_.]/;

function isValidChar(c: string): boolean {
  return VALID.test(c);
}

function getStartPos(value: string, caret: number): number {
  let p = caret;
  while (p > 0 && isValidChar(value.charAt(p - 1))) p--;
  return p;
}

function getFilterValue(value: string, caret: number): string {
  return value.substring(getStartPos(value, caret), caret);
}

// Ported from exp-builder.js getQueryString: walks backwards from caret through
// the DSL expression to extract the navigation path preceding the identifier
// being typed. Handles nested [...] filter blocks and recursion when inside one.
function getQueryPath(value: string, pos?: number): string {
  const startPos = pos !== undefined ? pos : value.length;
  let i = startPos - 1;
  let found = false;
  if (pos !== undefined) {
    found = true;
  } else {
    while (i >= 0) {
      const ch = value.charAt(i);
      if (ch === '.' || ch === '[') { found = true; break; }
      if (!isValidChar(ch)) break;
      i--;
    }
  }
  let last = '';
  if (found) {
    const to = i;
    i--;
    let inparen = 0;
    while (i >= 0) {
      const ch = value.charAt(i);
      if (inparen === 0 && !VALID_OR_DOT.test(ch)) break;
      if (ch === ']') inparen++;
      else if (ch === '[') {
        if (inparen > 0) inparen--;
        else break;
      }
      i--;
    }
    last = value.substring(i + 1, to);
  }
  let inparen = 0;
  while (i >= 0) {
    const ch = value.charAt(i);
    if (ch === '[') {
      if (inparen === 0) break;
      inparen--;
    } else if (ch === ']') inparen++;
    i--;
  }
  if (i > 0) {
    const prev = getQueryPath(value, i + 1);
    if (!prev) return last;
    if (!last) return prev;
    return prev + '.' + last;
  }
  return last;
}

// Compute caret pixel coordinates in a textarea by building a visually-identical
// mirror <div> that reproduces the textarea's wrapping behavior. A marker span
// is inserted at the caret offset and its offsetTop/offsetLeft is read.
const MIRROR_PROPS = [
  'boxSizing', 'width', 'height',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
  'lineHeight', 'letterSpacing', 'textTransform', 'textIndent',
  'whiteSpace', 'wordSpacing', 'wordWrap', 'tabSize',
] as const;

function getCaretCoords(textarea: HTMLTextAreaElement, position: number): { top: number; left: number; lineHeight: number } {
  const style = window.getComputedStyle(textarea);
  const div = document.createElement('div');
  const ds = div.style;
  ds.position = 'absolute';
  ds.visibility = 'hidden';
  ds.top = '0';
  ds.left = '-9999px';
  ds.whiteSpace = 'pre-wrap';
  ds.overflow = 'hidden';
  for (const p of MIRROR_PROPS) {
    ds.setProperty(
      p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()),
      style.getPropertyValue(p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()))
    );
  }
  const value = textarea.value;
  div.textContent = value.substring(0, position);
  const marker = document.createElement('span');
  // Non-empty content so the span gets a layout box at line end
  marker.textContent = value.substring(position) || '.';
  div.appendChild(marker);
  document.body.appendChild(div);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  document.body.removeChild(div);
  return { top, left, lineHeight };
}

interface Props {
  control: UIControl;
  disabled?: boolean;
  onChange: (val: unknown) => void;
}

const ExpBuilderControl: React.FC<Props> = ({ control, disabled, onChange }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const initialValue = (control.value as string) || '';
  const boName = (control.boName as string) || '';
  const allowMethods = !!control.allowMethods;

  const [items, setItems] = useState<MetadataRow[]>([]);
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const lastQueryRef = useRef<string | null>(null);

  const updatePopupPos = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const coords = getCaretCoords(ta, ta.selectionStart);
    const rect = ta.getBoundingClientRect();
    setPopupPos({
      top: rect.top + coords.top + coords.lineHeight - ta.scrollTop + 2,
      left: rect.left + coords.left - ta.scrollLeft,
    });
  }, []);

  const filtered = useMemo(() => {
    if (!filter) return items;
    const f = filter.toLowerCase();
    return items.filter(it => it.name.toLowerCase().startsWith(f));
  }, [items, filter]);

  useEffect(() => {
    setHighlight(h => (h >= filtered.length ? 0 : h));
  }, [filtered.length]);

  useEffect(() => {
    lastQueryRef.current = null;
    setItems([]);
  }, [boName, allowMethods]);

  // Keep highlighted item visible
  useEffect(() => {
    const ul = listRef.current;
    if (!ul || !open) return;
    const el = ul.children[highlight] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  const doFetch = useCallback(async (queryPath: string) => {
    if (!boName) return;
    try {
      const rows = await api.fetchMetadata(boName, allowMethods, queryPath);
      setItems(rows);
      lastQueryRef.current = queryPath;
    } catch {
      setItems([]);
      lastQueryRef.current = queryPath;
    }
  }, [boName, allowMethods]);

  const trigger = useCallback((value: string, caret: number) => {
    const queryPath = getQueryPath(value.substring(0, caret));
    const filterVal = getFilterValue(value, caret);
    setFilter(filterVal);
    setOpen(true);
    setHighlight(0);
    updatePopupPos();
    if (queryPath !== lastQueryRef.current) doFetch(queryPath);
  }, [doFetch, updatePopupPos]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    trigger(v, e.target.selectionStart);
  }, [onChange, trigger]);

  const insertItem = useCallback((item: MetadataRow) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const v = ta.value;
    const startPos = getStartPos(v, caret);
    const before = v.substring(0, startPos);
    const after = v.substring(caret);
    const newValue = before + item.name + after;
    ta.value = newValue;
    const newCaret = before.length + item.name.length;
    ta.setSelectionRange(newCaret, newCaret);
    ta.focus();
    onChange(newValue);
    setOpen(false);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Space or Ctrl+ArrowDown: force-open suggestions at caret
    if (e.ctrlKey && (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta) trigger(ta.value, ta.selectionStart);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => (filtered.length ? (h + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => (filtered.length ? (h - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered.length > 0) {
        e.preventDefault();
        insertItem(filtered[highlight]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }, [open, filtered, highlight, insertItem, trigger]);

  const handleBlur = useCallback(() => {
    // Delay so clicks on popup items register before we close
    setTimeout(() => setOpen(false), 150);
  }, []);

  const rows = control.rows || 5;
  const cols = control.length || control.size || 60;

  return (
    <div className="exp-builder-wrapper" style={{ position: 'relative', display: 'inline-block', width: '100%', maxWidth: `${cols}ch` }}>
      <textarea
        ref={textareaRef}
        id={control.id}
        name={control.name}
        title={control.hint as string | undefined}
        disabled={disabled}
        defaultValue={initialValue}
        rows={rows}
        spellCheck={false}
        autoComplete="off"
        className="exp-builder-input"
        style={{
          width: '100%',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          padding: '6px 8px',
          border: '1px solid #d9d9d9',
          borderRadius: 4,
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
      {open && filtered.length > 0 && createPortal(
        <ul
          ref={listRef}
          className="exp-builder-popup"
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            zIndex: 10000,
            maxHeight: 'calc(10 * 1.6em + 16px)',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            padding: 4,
            margin: 0,
            listStyle: 'none',
            minWidth: 280,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
          }}
        >
          {filtered.map((item, i) => (
            <li
              key={item.name}
              className={`exp-builder-item elem-${item.type}${item.method ? ' method' : ''}`}
              style={{
                padding: '3px 8px',
                cursor: 'pointer',
                background: i === highlight ? '#e6f4ff' : 'transparent',
                borderRadius: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
              onMouseDown={(e) => { e.preventDefault(); insertItem(item); }}
              onMouseEnter={() => setHighlight(i)}
            >
              <span style={{
                color: item.type === 'R' ? '#1677ff' : '#333',
                fontStyle: item.method ? 'italic' : 'normal',
              }}>{item.name}</span>
              <span style={{ color: '#999', fontSize: 11 }}>{item.javaType}</span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
};

export default ExpBuilderControl;
