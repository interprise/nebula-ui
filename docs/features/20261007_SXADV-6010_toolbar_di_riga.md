# SXADV-6010 — la toolbar del pannello di riga

## Il caso (riprodotto il 07/10/2026)

Prima Nota → Nuovo → tab *Reg. contabili* → Nuovo, si compila la riga nel pannello
("Modifica riga") → **Salva+ della toolbar in alto**. La richiesta parte con
`action=SaveAndNew&navpath=S1-0.0`: il navpath e' quello del DOCUMENTO, scritto da
CORE nell'handler del bottone (`RecordNavigator`). Il server salva il documento e ne
apre uno nuovo, vuoto: Elena l'ha letto come "il rigo appena immesso e' stato
ripulito". Non e' un difetto del Salva+ del documento, che resta com'e'.

Quello che manca e' un Salva+ della RIGA. Indicazione di Luca (07/10): *replicare sul
micro-detail la toolbar della pagina, con le funzionalita' centrate sul view state
del dettaglio*, cioe' della riga.

## Contratto

### Cosa c'e' nella barra del pannello

Accanto alle frecce riga precedente/successiva e a "Chiudi", il pannello mostra, con
le stesse etichette e icone della toolbar in alto:

| Bottone | Richiesta | Dopo la risposta |
|---|---|---|
| **Salva** | il comando di salvataggio della pagina (`Save`, o la `customSaveCommand` che la toolbar in alto porta nel suo handler) con `navpath` = percorso della riga | il pannello resta sulla stessa riga |
| **Salva+** | `SaveAndNew` con `navpath` = percorso della riga | se il salvataggio riesce: una riga nuova nella lista, il pannello si sposta li' (stesso meccanismo del Nuovo, SXADV-6011); se fallisce: nessuna riga nuova, il pannello resta sulla riga con l'errore |
| **Nuovo** | il comando di inserimento della lista (`gridActions.addCommand`) con `navpath` = percorso della lista, come il "Nuovo" sopra la griglia | il pannello va sulla riga nuova |
| **Cancella** | quello che faceva "Elimina": conferma, poi `Delete` (o la `customDeleteCommand`) sulla riga, e il pannello si chiude | invariato |

Salva salva il **documento intero**: CORE ha una sola transazione per Session, e una
riga senza la sua testata non si scrive. "Centrato sulla riga" vuol dire che il
comando lavora sul view state della riga e che il pannello ci resta sopra.

Niente **Annulla** nel pannello: annullare una sola riga richiede un comando CORE che
oggi non esiste (vedi SXADV-6045). Il Salva+ e l'Annulla della toolbar in alto restano
del documento e non cambiano.

### `rowToolbarActions(input)` — `src/components/rowToolbar.ts`

Funzione pura che decide i bottoni Salva / Salva+ / Nuovo.

```ts
export interface RowToolbarInput {
  /** La toolbar della PAGINA, come la manda il server (tab.toolbar). */
  pageToolbar: readonly unknown[] | undefined;
  /** gridActions.addCommand della lista (assente se non si puo' inserire). */
  addCommand?: string;
  /** La lista e' incorporata: il server le manda gridActions. */
  embedded?: boolean;
  /** Percorso della lista (gridActions.path, o ui.path): navpath del Nuovo. */
  listPath?: string;
  /** Percorso della riga nel pannello: navpath di Salva e Salva+. */
  rowPath: string;
}
export interface RowToolbarAction {
  key: 'save' | 'saveNew' | 'new';
  label: string;            // 'Salva' | 'Salva+' | 'Nuovo'
  icon: string;             // 'database_save.png' | 'database_add.png' | 'add.png'
  action: string;
  params: Record<string, string>;
  disabled: boolean;
}
export function rowToolbarActions(input: RowToolbarInput): RowToolbarAction[]
```

- Le voci della toolbar che non sono oggetti (stringhe come `'->'` o HTML) si ignorano.
- **Salva.** La voce della pagina il cui `id` comincia con `save` ma NON con
  `saveNew` (gli id sono `save<idViewState>` e `saveNew<idViewState>`; se ce n'e' piu'
  d'una vale la prima). Il comando e' il
  primo argomento dell'handler `doAction.createCallback('X')` o
  `doAction2.createCallback('X', ...)`. Se la voce manca, o non ha handler, o il
  comando e' vuoto (`createCallback('')`, cioe' salvataggio non permesso), **non c'e'
  ne' Salva ne' Salva+**. `disabled` = `disabled` della voce.
  `params` = `{ navpath: rowPath }`.
- **Salva+.** C'e' solo se c'e' Salva **e** c'e' un comando di inserimento (vedi
  Nuovo). `action` = `'SaveAndNew'`, `params` = `{ navpath: rowPath }`, `disabled` =
  quello di Salva.
- **Nuovo.** Il comando e' `addCommand` se dato (la stringa vuota vale come non data). Altrimenti, **solo se `embedded` non e' vero**, se la toolbar della
  pagina ha una voce con `id` che comincia con `newRecord`, non disabilitata e con un
  handler `doAction2.createCallback('X', 'P')`, il comando e' `X` e il navpath `P` (e'
  il caso di una lista che e' la pagina stessa). Gli argomenti dell'handler si leggono
  fra apici: il navpath contiene virgole (`'S1-0.0,S1-9'`). Se non c'e' nessuno dei due, niente
  Nuovo. Con `addCommand`, `params` = `{ navpath: listPath }` se `listPath` e' dato,
  altrimenti `{}`. `disabled` = `false`.
- Con `embedded` vero e `addCommand` assente (o vuoto) non c'e' Nuovo, e quindi
  nemmeno Salva+: il server non ha dato il comando perche' su quella lista non si
  inseriscono righe, e il Nuovo della pagina creerebbe un documento.
- Ordine del risultato: Salva, Salva+, Nuovo (solo quelli presenti).

### Il server: `SaveAndNewCommand` su una riga

Contratto in `CORE/docs/20261007_SXADV-6010_salva_piu_di_riga.md`.

## Prova a schermo

Prima Nota → Nuovo → Reg. contabili → Nuovo, compilare la riga 1 → **Salva+ del
pannello**: il documento si salva, compare la riga 2 vuota e il pannello e' su di lei.
Con un campo obbligatorio della riga vuoto: errore, nessuna riga 2, pannello sulla
riga 1. Salva del pannello: salva e il pannello resta sulla riga. Salva+ in alto:
come prima (documento nuovo).
