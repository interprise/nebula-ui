/* Il digitato del pannello di riga appartiene alla riga su cui e' stato scritto.
 *
 * I campi del pannello hanno nomi senza la riga (`descrizione.S1-2`: campo piu'
 * id del viewstate della lista): la riga la dice il navpath (o il postPath) della
 * richiesta che li porta. I valori pero' stavano nei valori della scheda, che
 * partono con OGNI richiesta, e restavano li' anche dopo essere stati spediti.
 * Cosi' un Salva sul rigo B, poi la modifica del rigo A e un altro Salva,
 * mandava i valori di B con il navpath di A, e il server li scriveva su A; una
 * pagina avanti/indietro (senza navpath) li scriveva sul record corrente del
 * server (MD-VALORI-RESIDUI-DOPO-SALVA, trovato provando SXADV-5982).
 *
 * Regola: un valore del pannello parte solo in una richiesta per la sua riga, e
 * dopo esserci partito esce dai valori della scheda (il server lo tiene nella
 * cache della Session, anche se il Salva poi fallisce). Una richiesta per altro
 * non lo porta, e il valore si scarta: non ha piu' una riga a cui andare. */

/** Campo del pannello (nome come parte nella richiesta) -> percorso della riga. */
export type PanelFieldRows = Map<string, string>;

/** Il campo e' stato scritto nel pannello aperto sulla riga `rowPath`. */
export function markPanelField(rows: PanelFieldRows, name: string, rowPath: string): void {
  rows.set(name, rowPath);
}

/** I valori da spedire con una richiesta per `target` (il suo postPath, o il
 *  navpath; null = nessuna riga). Non modifica niente: dice cosa parte, quali
 *  campi del pannello partono (`sent`) e quali si scartano (`dropped`). */
export function scopePanelValues(
  values: Record<string, string | string[]>,
  rows: PanelFieldRows,
  target: string | null | undefined,
): { values: Record<string, string | string[]>; sent: string[]; dropped: string[] } {
  const out = { ...values };
  const sent: string[] = [];
  const dropped: string[] = [];
  for (const [name, row] of rows) {
    if (target && row === target) {
      sent.push(name);
    } else {
      dropped.push(name);
      delete out[name];
    }
  }
  return { values: out, sent, dropped };
}
