// La riga in modifica nel pannello viaggia come `postPath` accanto al navpath.
//
// Il pannello si apre senza chiedere niente al server, quindi il server ricorda
// come riga dei valori l'ultima di cui ha saputo. Il navpath non basta a dirgli
// la riga del pannello: il Nuovo lo usa per la LISTA in cui nasce la riga nuova.
// Le chiavi dei campi dicono la lista, non la riga: senza `postPath` il digitato
// finiva sull'ultima riga aggiunta (trovato in SXADV-6052).
// Contratto: CORE/docs/20261013_SXADV-6052_postpath_della_riga_in_modifica.md

/** I parametri di una richiesta con la riga in modifica come `postPath`. Un
 *  `postPath` messo da chi chiama resta; senza riga in modifica non parte, e
 *  nemmeno quando la riga e' di un'altra sessione (`sid`): la riga in modifica
 *  e' una sola per tutte le schede e il cambio scheda non la azzera, mentre il
 *  server cerca il percorso solo nella sessione della richiesta e, non
 *  trovandolo, risponde "Sessione non valida". */
export function withRowPostPath(
  params: Record<string, string>,
  editNavpath: string | null | undefined,
  sid?: string,
): Record<string, string> {
  if (!editNavpath || params.postPath) return params;
  if (sid && !editNavpath.startsWith(`${sid}-`)) return params;
  return { ...params, postPath: editNavpath };
}

/** I parametri di una richiesta senza navpath, con la riga in modifica come
 *  navpath (Salva, Post: il server si posiziona sulla riga del pannello). Stessa
 *  regola della sessione di {@link withRowPostPath}: una riga di un'altra
 *  scheda mandata con questo `sid` e' un percorso che il server non trova
 *  (SXADV-6146). */
export function withRowNavpath(
  params: Record<string, string>,
  editNavpath: string | null | undefined,
  sid?: string,
): Record<string, string> {
  if (!editNavpath || params.navpath) return params;
  if (sid && !editNavpath.startsWith(`${sid}-`)) return params;
  return { ...params, navpath: editNavpath };
}
