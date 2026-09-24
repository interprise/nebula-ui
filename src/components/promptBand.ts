/* La banda delle etichette del righello (SXADV-5742.1, SXADV-5969.3).
 *
 * La banda sono le colonne iniziali che TUTTE le etichette di inizio riga
 * condividono, cioe' la colspan PIU' PICCOLA fra quelle etichette — non la piu'
 * larga. Fino a SXADV-5969 si prendeva la piu' larga: su "Tessere -
 * Interrogazione" quasi tutte le etichette occupano 4 colonne e "Ultima Rata
 * Pagata" 7, quindi le colonne 4-6 diventavano "banda" (41px l'una) anche nelle
 * righe dove li' comincia il CAMPO. Anno, i "da" delle date e il codice
 * Iscritto finivano in colonne strette e venivano tagliati; si salvavano solo i
 * campi a fine riga, grazie allo sconfinamento a destra di SXADV-5874.
 *
 * Un'etichetta che occupa piu' colonne della banda si prende le colonne in piu'
 * dal contenuto: la banda deve allora bastare a quello che le colonne di
 * contenuto non coprono. Siccome la larghezza del contenuto dipende a sua volta
 * dalla banda (quello che resta dello spazio visibile), si risolve per
 * approssimazioni successive, con la stessa funzione che poi dimensiona la
 * tabella: a convergenza la banda e' misurata sulla colonna di contenuto che la
 * tabella usera' davvero. Di solito quella colonna cala mentre la banda cresce,
 * ma non sempre (sotto il pavimento il righello risale a `contentColWish`):
 * per questo c'e' un tetto alle iterazioni e, se non bastano, il limite sicuro
 * calcolato sul pavimento assoluto del contenuto. */

export interface LeadingPrompt {
  /** Colonne occupate dall'etichetta. */
  span: number;
  /** Larghezza che l'etichetta pretende per stare su una riga, padding compreso. */
  width: number;
}

export interface PromptBand {
  cols: number;
  width: number;
}

const MAX_ITERATIONS = 8;

/**
 * @param prompts le etichette di inizio riga visibili
 * @param contentColFor larghezza di una colonna di contenuto quando la banda e'
 *   larga `bandWidth` px
 * @param minContentCol la larghezza sotto cui una colonna di contenuto non
 *   scende mai, qualunque sia la banda: da' il limite sicuro
 */
export function solvePromptBand(
  prompts: readonly LeadingPrompt[],
  contentColFor: (bandWidth: number) => number,
  minContentCol: number,
): PromptBand {
  const valid = prompts.filter((p) => p.span >= 1);
  if (valid.length === 0) return { cols: 0, width: 0 };
  const cols = Math.min(...valid.map((p) => p.span));

  const need = (contentCol: number) =>
    Math.max(0, ...valid.map((p) => (p.width - (p.span - cols) * contentCol) / cols));

  let perCol = Math.max(0, ...valid.filter((p) => p.span === cols).map((p) => p.width / cols));
  let converged = false;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const next = need(contentColFor(Math.ceil(perCol * cols)));
    if (next <= perCol) {
      converged = true;
      break;
    }
    perCol = next;
  }
  if (!converged) perCol = Math.max(perCol, need(minContentCol));
  return { cols, width: perCol ? Math.ceil(perCol * cols) : 0 };
}
