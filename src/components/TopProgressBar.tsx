import { useEffect, useState } from 'react';

/**
 * Thin indeterminate progress bar pinned to the top of the viewport, shown
 * while a server request is in flight. A short delay before it appears keeps
 * the frequent fast field-reloads from flickering it on and off.
 */
export default function TopProgressBar({ active, delay = 150 }: { active: boolean; delay?: number }) {
  // L'effetto porta SOLO il ritardo: scaduto quello, la richiesta in corso è
  // abbastanza lenta da meritare la barra. Che poi la barra si veda è una
  // derivazione (`active && elapsed`), non un secondo stato da rimettere in
  // riga — spegnerla con un setState dentro l'effetto voleva dire un giro di
  // render in più a ogni richiesta, cioè proprio dove serve non pesare.
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setElapsed(true), delay);
    // Alla fine della richiesta il ritardo riparte da capo: la prossima non
    // deve ereditare il timer già scaduto di questa e comparire subito.
    return () => {
      window.clearTimeout(timer);
      setElapsed(false);
    };
  }, [active, delay]);

  if (!active || !elapsed) return null;
  return (
    <div className="top-progress-bar" role="progressbar" aria-busy="true" aria-label="Caricamento">
      <div className="top-progress-bar__indicator" />
    </div>
  );
}
