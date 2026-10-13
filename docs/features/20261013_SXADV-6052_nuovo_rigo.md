# SXADV-6052 — Micro-detail dopo "Nuovo" rigo

Seguito di SXADV-6011/6010/6045/6048. Il micro-detail (pannello "Gestione riga") e' un
editor di riga: Salva e Annulla restano del documento, qui non cambia il modello
transazionale. Si correggono tre difetti visti da Elena su Anagrafiche > Tabelle >
Categorie Statistiche > clic su una categoria > tab Figlie > Nuovo.

## Cosa succedeva (riprodotto il 13/10/2026 su pandoraalfa44, client 5174)

La pagina e' un albero+dettaglio: la scheda resta l'albero `anagraficheStatisticheTree`,
il dettaglio `anagraficheStatisticheDetail` sta nel pannello di destra e incorpora la
lista listEdit `anagraficheStatisticheList` (Figlie).

Ogni risposta instradata nel pannello di destra (`_detailResponse`) faceva ripartire da
`TreeRenderer` un `LocateAndNavigate` sul nodo selezionato, per "rientrare in modifica"
(commit b50afcf, pensato per il Salva). Dopo il "Nuovo" di una riga quel giro:

- ridisegna il dettaglio una seconda volta, su view state NUOVI (S1-1/S1-2 diventano
  S1-3/S1-4, poi S1-5/S1-6, ...): la pagina si riscrive due volte a ogni Nuovo e le
  briciole crescono di una voce (6052.0);
- il `currField` della risposta all'Add (`codiceStatistico.S1-4.1`) nomina una riga che
  dopo il giro non esiste piu': al secondo Nuovo il pannello si chiudeva, la riga nuova
  restava selezionata senza campi (6052.2);
- il server resta con l'edit path sul view state vecchio: il digitato sulla riga nuova,
  spedito dal Nuovo successivo, andava perso;
- il fuoco restava su `<body>` (6052.1: nessuno lo metteva nel pannello, in nessuna
  lista).

## Cosa cambia

### 1. Il pannello dell'albero non rinaviga dopo un Nuovo di riga

`treeDetailRouting.ts`:

- `paneDetail(treeUi, detail, keepsEdit)` restituisce la UI della scheda albero con il
  dettaglio allegato: `{ ...treeUi, _detailResponse: detail, _detailKeepsEdit: keepsEdit }`.
  `_detailKeepsEdit` e' presente solo se `keepsEdit` e' true.
- `paneReentersEdit(ui)` dice se `TreeRenderer` deve rientrare in modifica con un
  `LocateAndNavigate`: true salvo quando `ui._detailKeepsEdit === true`.

Shell (instradamento in `processResponseInner`): `keepsEdit` e' vero quando la risposta
e' quella di un Add/Salva+ andato a buon fine (`pendingAddRef` armato al momento
dell'instradamento: un ERROR o una domanda del server lo hanno gia' spento). In quel
caso la toolbar della risposta resta alla scheda (e' quella del view state del
pannello, che non cambia); template, bindings e scopePaths si tolgono come prima.

`TreeRenderer`: con `paneReentersEdit(ui) === false` mostra il dettaglio ricevuto e
basta (nessuna richiesta). Il Salva e ogni altra risposta rientrano come prima.

### 2. Dopo il Nuovo il fuoco va nel pannello (tutte le liste)

`panelFocus.ts`:

- `firstPanelField(panel)` restituisce il primo campo utilizzabile dentro
  `.edit-panel-body` di `panel` (stesso criterio del fuoco sulla pagina nuova:
  input/textarea/select non disabilitato, non in sola lettura - salvo le combo antd -,
  non `type=hidden|button|reset|submit`, `tabIndex !== -1`, con almeno un
  `getClientRects()`), o `null`.
- `focusFirstPanelField(panel)` lo mette a fuoco con `preventScroll` e seleziona il
  testo di un input di testo, poi lo porta in vista solo in verticale
  (`revealVertically`, come SXADV-5922). Se il campo non c'e' ancora riprova per
  qualche frame (al massimo 10). Non fa niente se e' aperta una finestra modale.
  Restituisce una funzione che annulla i tentativi pendenti. Il secondo argomento,
  facoltativo, `onFocused()` e' chiamato una volta sola, quando il cursore e'
  arrivato (non se non arriva, non se i tentativi sono stati annullati).

`ListRenderer` apre il pannello sulla riga creata dal Nuovo con
`onSelectRecord(path, { fromAdd: true })`; `ListView` passa a `EditPanel` un contatore
`focusRequest` che cresce a ogni apertura da Nuovo, e `EditPanel` chiama
`focusFirstPanelField` quando il contatore cambia. Il contatore torna a 0 appena il
cursore e' arrivato (`onFocused`), a un clic su una riga e alla chiusura del pannello:
un pannello che si rimonta dopo (Chiudi e clic su una riga, una risposta che lo smonta
per un attimo) non porta via il cursore. Un clic su una riga non sposta il fuoco
(comportamento invariato).

### 3. Il flag del Nuovo vale solo per la sua richiesta

Ogni azione che non sia `Add`/`SaveAndNew` spegne, alla partenza, il flag del Nuovo
(`pendingAddRef`): un Add che non ha creato la riga (Salva+ senza diritto di
inserimento, Add che CORE chiude senza messaggio) non lo lascia armato, e il Salva
successivo nell'albero rientra in modifica come deve.

## Non cambia

- Salva/Annulla del documento, Annulla di riga, Cancella: invariati.
- Il Nuovo del dettaglio stesso (record nuovo dell'albero) si apre a pagina intera.
