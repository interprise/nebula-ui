import React from 'react';

export const WorkflowPill: React.FC<{ state: string; prevState?: string }> = ({ state, prevState }) => {
  let hash = 0;
  for (let i = 0; i < state.length; i++) {
    hash = state.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  const bg = `hsl(${hue}, 55%, 45%)`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        background: bg,
        color: '#fff',
        fontWeight: 600,
        fontSize: 12,
        padding: '2px 12px',
        borderRadius: 12,
        whiteSpace: 'nowrap',
        letterSpacing: 0.3,
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}>
        {state}
      </span>
      {prevState && (
        <span style={{ fontSize: 11, color: '#999' }}>
          da {prevState}
        </span>
      )}
    </span>
  );
};
