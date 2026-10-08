# SXADV-6048 — Riga in gestione evidenziata, eco in tempo reale nella lista

Seguito di SXADV-6010 / 6045 (`20261008_SXADV-6045_gestione_riga.md`). Il pannello
"Gestione riga" di una lista listEdit/multiEdit lavora su una riga della griglia.

## Cosa cambia

1. **6048.1 — sfondo giallo.** Mentre il pannello e' aperto su una riga (dopo Nuovo,
   o dopo un clic su una riga esistente), quella riga della griglia (tutte le sue
   bande) e i campi modificabili del pannello hanno uno sfondo giallo, piu' scuro del
   giallo degli avvisi in testata (antd Alert warning, `#fffbe6`). Token di tema:
   `--app-row-editing-bg` (`#fff1b8`). A pannello chiuso la riga torna alla resa di
   prima (azzurro di riga corrente).
2. **6048.2 — eco in tempo reale.** Quello che si scrive nel pannello compare subito
   nella cella corrispondente della riga in griglia, senza aspettare il server. I
   campi calcolati dal server (es. Saldo contabile) si aggiornano solo alla risposta.

## `src/components/rowEcho.ts` (funzioni pure)

Tipi:

```ts
/** Testo da mostrare nella riga per un campo del pannello, con il nome a filo
 *  del campo (serve a sapere se e' ancora non spedito). */
export interface EchoEntry { wire: string; text: string }
/** Eco della riga in gestione: nome NUDO del controllo -> voce. */
export type RowEcho = Record<string, EchoEntry>;
```

### `bareFieldName(wireName: string, vsId: string): string`

Il nome a filo di un campo del pannello e' `<nome nudo>.<id viewstate>`
(`descrizione.S1-9`). Se `wireName` finisce con `'.' + vsId` restituisce la parte
prima, altrimenti `wireName` intero. `vsId` vuoto: `wireName` intero.

### `echoText(ctrl, value, caption?): string | undefined`

`ctrl` = il controllo del pannello (`{ type?: string; currencySymbol?: string }`),
puo' essere `undefined`. Restituisce il testo da mostrare in cella, o `undefined` se
il campo NON si riflette (la cella resta quella del server):

- tipo booleano (`checkbox`, `boolean`, `bool`, confronto senza maiuscole): `undefined`;
- `caption` stringa: la caption (combo: l'etichetta della voce scelta, non il codice);
- `caption` array (selezione multipla): i `listText ?? text` uniti da `', '`;
- tipo di scelta da elenco (il tipo, senza maiuscole, contiene `combo`, `lookup` o
  `select`) SENZA caption e con un valore non vuoto: `undefined` (l'Esc della combo
  rimette il valore di prima senza didascalia: il codice al posto della voce sarebbe
  peggio della cella del server);
- `value` `null`/`undefined`/`''`: `''`;
- `value` array: elementi uniti da `', '`;
- tipo `money`: `` `${value} ${simbolo}` `` dove simbolo = `currencySymbol` decodificato
  dalle entita' HTML (`&#x20AC;` -> `€`), `€` se assente/vuoto (la lista mostra
  `8,49 €`; il valore che arriva dal campo e' gia' in formato italiano, `10.000,00`).
  Un valore senza punti con piu' di tre cifre intere riceve il separatore delle
  migliaia nella parte intera (`1234,5` -> `1.234,5 €`): sotto le cinque cifre il campo
  non lo scrive, la lista si'. I decimali restano quelli scritti;
- altrimenti `String(value)`.

### `applyRowEcho(data, echo, columns): data`

`data` = l'oggetto riga di AG Grid (vedi ListRenderer: `col_<i>`, `_display_<i>`,
`_isContinuationRow`, `_isBreakRow`), `columns` = `ui.columns` (indice = `i`).
Per ogni indice `i` con `columns[i].control.name` presente in `echo`:
`col_<i>` = testo; se `data` ha gia' la chiave `_display_<i>` anche quella = testo.
Se il tipo del controllo della colonna e' `html` (senza maiuscole) il testo si scrive
con `&`, `<`, `>` sostituiti da `&amp;`, `&lt;`, `&gt;` (la cella lo rende come
markup, il testo digitato va mostrato com'e').
- Restituisce un oggetto NUOVO se ha cambiato almeno un valore, altrimenti lo STESSO
  `data` (identita').
- Non tocca le righe di continuazione o di rottura (stesso `data` restituito).
- `echo` vuoto o `columns` assente: stesso `data`.
- Non modifica mai `data` sul posto.

### `pruneEcho(echo, isDirty): RowEcho | null`

All'arrivo di righe nuove dal server: tiene solo le voci il cui `wire` e' ancora fra i
campi non spediti (`isDirty(wire) === true`); quelle gia' spedite le ha ormai il
server, che le rimanda nella riga (o le ha annullate: Annulla di riga). Restituisce
`null` se non resta niente; lo STESSO oggetto se non toglie niente.

## Collegamenti

- `ListView` (ViewRenderer.tsx) avvolge l'`onChange` del pannello: inoltra a Shell
  (con la caption), poi registra `echoText` sotto `bareFieldName` per la riga
  selezionata, con una voce NUOVA (oggetto nuovo) a ogni modifica. Se `echoText` da'
  `undefined` la voce di quel campo si toglie. La prima modifica su un'altra riga
  riparte da un'eco vuota.
- `ListRenderer` riceve `editingPath` (riga del pannello, solo se il pannello e'
  visibile), `rowEcho` (`{ path, echo }`, INTERA, anche quando non e' in vista) e
  `isEchoLive` (da Shell, via `FieldDirtyContext`: il campo non e' ancora partito).
  - La classe `record-row-editing` va su tutte le righe del record (regola di classe +
    DOM, come `record-group-selected`).
  - L'eco si mostra sulla riga `rowEcho.path` anche quando il pannello e' passato a
    un'altra riga o si e' chiuso (finche' il server non risponde la riga lasciata tiene
    il digitato), sul nodo AG Grid della riga principale, con `applyRowEcho` e `node.updateData` (ridisegna le celle, non la
    riga). Si ricorda il valore del server di ogni cella scritta: togliendo l'eco lo si
    rimette, e solo dove la cella porta ancora il testo dell'eco (una spunta di
    selezione multiEdit scritta nel frattempo sullo stesso oggetto resta).
  - Una voce vale finche' non arrivano righe dal server (`ui.rows` nuove) DOPO che il
    campo e' partito: a quell'arrivo le voci gia' partite (`pruneEcho` le esclude) si
    segnano come risposte e non si applicano piu'. Si segnano anche se l'eco non e' in
    vista (pannello chiuso, altra riga), altrimenti tornerebbero vecchie alla
    riapertura, anche su un altro record (i percorsi di riga sono posizionali). Non
    basta "non ancora partito": un campo con ricalcolo (sottoconto, importi) parte
    nello stesso istante in cui lo si sceglie. Un rowData ricostruito solo dal client
    (una-riga, colonne fisse) non conta come risposta.

## Limiti

- L'eco copre le colonne della riga principale; le bande di continuazione (record su
  piu' righe) e la modalita' una-riga si aggiornano alla risposta del server.
- Le caselle di spunta non si riflettono in tempo reale.
- Dove manca `FieldDirtyContext` (liste rese fuori dal contenuto della scheda) ogni
  voce smette di valere alle prime righe nuove dal server.
