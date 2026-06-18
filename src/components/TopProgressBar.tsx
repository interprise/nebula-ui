import { useEffect, useRef, useState } from 'react';

/**
 * Thin indeterminate progress bar pinned to the top of the viewport, shown
 * while a server request is in flight. A short delay before it appears keeps
 * the frequent fast field-reloads from flickering it on and off.
 */
export default function TopProgressBar({ active, delay = 150 }: { active: boolean; delay?: number }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (active) {
      timerRef.current = window.setTimeout(() => setVisible(true), delay);
    } else {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      setVisible(false);
    }
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [active, delay]);

  if (!visible) return null;
  return (
    <div className="top-progress-bar" role="progressbar" aria-busy="true" aria-label="Caricamento">
      <div className="top-progress-bar__indicator" />
    </div>
  );
}
