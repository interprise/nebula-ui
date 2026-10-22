// Dove sta l'ingranaggio del cambio azienda/sede (SXADV-5980.a).
//
// Lo strato che ferma i clic copre tutto lo schermo, ma l'ingranaggio va al
// centro dello SPAZIO DI LAVORO (.tab-content), dove stanno anche le scritte
// della Home: centrato sullo schermo cadeva spostato a sinistra di mezza barra
// laterale e in basso di mezza testata, fuori asse rispetto a quei testi.

export interface Rettangolo { left: number; top: number; width: number; height: number }

/** Centro (coordinate della finestra, px CSS) della parte di `spazio` che si
 *  vede nella finestra; il centro della finestra se lo spazio manca o non se ne
 *  vede niente. */
export function centroIngranaggio(
  spazio: Rettangolo | null | undefined,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const finestra = { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) };
  if (!spazio) return finestra;
  const sinistra = Math.max(spazio.left, 0);
  const destra = Math.min(spazio.left + spazio.width, viewport.width);
  const alto = Math.max(spazio.top, 0);
  const basso = Math.min(spazio.top + spazio.height, viewport.height);
  if (destra <= sinistra || basso <= alto) return finestra;
  return { x: Math.round((sinistra + destra) / 2), y: Math.round((alto + basso) / 2) };
}
