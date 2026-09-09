import { useCallback, useRef, useState } from 'react';

/** Margine fra la tendina e il bordo della finestra. */
const EDGE = 12;
/** Sotto questa altezza una tendina non e' piu' consultabile: meglio farla
 *  sconfinare di poco (e lasciare che antd la ribalti) che ridurla a due voci. */
const FLOOR = 120;

/** Tetto d'altezza di un menu a tendina, misurato sullo spazio che c'e'
 *  davvero attorno al pulsante che lo apre.
 *
 *  antd cappa i suoi menu a `max-height: 100vh` e li scorre: sembra
 *  sufficiente, ma il tetto e' l'altezza dell'INTERA finestra mentre la tendina
 *  parte da sotto il pulsante, cioe' gia' a due o trecento pixel dall'alto.
 *  Quello che avanza esce dal fondo dello schermo, e la barra di scorrimento
 *  interna non serve a niente perche' e' fuori anche lei: le ultime voci non
 *  sono raggiungibili in alcun modo. Sull'elenco delle estrazioni dati di
 *  Anagrafica Unica (18 voci) le ultime sparivano su un 14" allo zoom del 125%,
 *  e si recuperavano solo riportando il browser al 100% (SXADV-5772).
 *
 *  Il tetto giusto e' quindi lo spazio SOTTO il pulsante. Si tiene il maggiore
 *  fra sotto e sopra perche' quando non ci sta sotto antd ribalta la tendina
 *  all'insu': dandole un'altezza che sta nel maggiore dei due, dovunque atterri
 *  ci sta per intero, e quando eccede scorre dentro la finestra invece che
 *  fuori.
 *
 *  Si misura all'apertura, non una volta sola: fra un'apertura e l'altra la
 *  finestra puo' essere stata ridimensionata, o il pulsante essersi spostato. */
export function useViewportMenuHeight<T extends HTMLElement = HTMLElement>(): {
  triggerRef: React.RefObject<T | null>;
  menuStyle: React.CSSProperties;
  onOpenChange: (open: boolean) => void;
} {
  const triggerRef = useRef<T | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - EDGE;
    const above = rect.top - EDGE;
    setMaxHeight(
      Math.min(
        Math.max(below, above, FLOOR),
        window.innerHeight - EDGE * 2,
      ),
    );
  }, []);
  return { triggerRef, menuStyle: { maxHeight, overflowY: 'auto' }, onOpenChange };
}
