import React, { useEffect, useState } from 'react';
import { Spin } from 'antd';

/** Quanto il legacy aspettava in silenzio: il timeout di Ext.Ajax (30 s),
 *  scaduto il quale diceva all'utente che la richiesta stava durando piu' del
 *  previsto (ui.js handleFailure). */
const SLOW_REQUEST_MS = 30000;

/**
 * Velo della scheda mentre una richiesta e' in corso. Una richiesta lunga (una
 * stampa, un'elaborazione, un errore che il server impiega a riportare)
 * mostrava solo la rotellina, senza una parola, anche per minuti (SXADV-5804):
 * passati 30 secondi compare il testo del legacy.
 *
 * La richiesta non si interrompe. Il legacy la abbandonava allo scadere del
 * timeout e ripiegava su un Refresh; qui la risposta che arriva dopo e' quella
 * giusta, errori compresi, e va mostrata.
 */
const LoadingOverlay: React.FC<{ progressPct?: number }> = ({ progressPct }) => {
  const [slow, setSlow] = useState(false);

  // Il velo esiste solo mentre la scheda aspetta: il suo montaggio e' l'inizio
  // dell'attesa.
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_REQUEST_MS);
    return () => clearTimeout(timer);
  }, []);

  const description = progressPct != null
    ? `${progressPct}%`
    : slow
      ? 'La richiesta ci sta mettendo più del previsto. Si prega di attendere...'
      : undefined;

  return (
    <div className="loading-overlay">
      <Spin size="large" description={description}>
        <div style={{ minHeight: 60 }} />
      </Spin>
    </div>
  );
};

export default LoadingOverlay;
