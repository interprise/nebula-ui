# SXADV-6011 — dopo "Nuovo" il pannello di riga va sulla riga nuova

## Il difetto (riprodotto il 07/10/2026)

Prima Nota → Nuovo → tab *Reg. contabili* (`docRegContabiliMultiEditList`, multiEdit) →
Nuovo, si scrive la riga 1 → Nuovo di nuovo. La lista mostra la riga 2 nuova, ma il
pannello di riga ("Modifica riga") resta sulla riga 1 con i suoi valori. Si scrive
quindi sulla riga 1, la riga nuova resta vuota, e il Salva del documento fallisce con
"non e' stato possibile impostare il sottoconto" (validazione corretta: la riga nuova
e' davvero vuota).

**Causa.** Il client sceglie la riga da aprire come la PRIMA riga "in modifica" della
risposta: la prima con `props.isNew`, oppure la prima con celle `editable`. In una
lista multiEdit tutte le righe hanno celle `editable` (e in un documento nuovo tutte
sono `isNew`), quindi vince sempre la riga 1. Il server invece la riga nuova la dice:
`currField` della risposta all'Add e' un campo nello scope della riga nuova
(`descrizione.S1-9.1`, riga `S1-0.0,S1-9.1`).

## Contratto

### `addedRowPath(rowPaths, currField, fallback)` — `src/components/addedRow.ts`

```ts
export function addedRowPath(
  rowPaths: readonly string[],
  currField: string | null | undefined,
  fallback: string | null,
): string | null
```

- `rowPaths`: i percorsi delle righe primarie della lista, in ordine
  (es. `['S1-0.0,S1-9.0', 'S1-0.0,S1-9.1']`). Un percorso e' una catena di scope
  separati da virgola; l'ultimo scope e' quello della riga.
- `currField`: il `currField` della risposta all'Add, nella forma `<campo>.<scope>`
  (il nome del campo puo' contenere punti; lo scope e' la parte finale).
- Restituisce il percorso della riga il cui **ultimo scope** e' lo scope di
  `currField`, cioe' `currField` termina con `'.' + ultimoScope`. Il confronto e' esatto
  sullo scope intero: `x.S1-9.11` non e' la riga `…,S1-9.1`, e un campo della testata
  (`dataReg.S1-0`) non e' nessuna riga.
- Se `currField` manca o non corrisponde a nessuna riga, restituisce `fallback`
  invariato (il comportamento di prima: prima riga `isNew` o prima riga con celle
  modificabili).
- Funzione pura: non legge ne' scrive niente fuori dagli argomenti.

### Da Shell alla lista: `PendingAddContext`

Il valore del contesto (e la prop `pendingAdd` di `ListRenderer`) passa da
`() => boolean` a `() => false | { currField: string | null }`:

- `false`: non c'e' un Add appena partito (come prima).
- `{ currField }`: c'e', e `currField` e' quello dell'ultima risposta arrivata mentre
  l'Add era armato (`null` se il server non l'ha mandato).
- Resta "leggi e azzera": una seconda chiamata subito dopo restituisce `false`.

### Comportamento a schermo

Dopo "Nuovo" (o "Salva +") su una lista listEdit/multiEdit, il pannello di riga si
apre sulla riga che il server ha appena creato, la evidenzia, la porta a vista, e
mostra i suoi valori (vuoti o i default del server, es. l'AVERE di quadratura). Vale
per tutte le liste con il pannello, non solo per la Prima Nota.

## Limiti noti (revisione indipendente, 07/10)

Nei casi seguenti `currField` non nomina una riga della lista, e il pannello torna al
comportamento di prima (riga 1). Nessuno peggiora quello che c'era:

- **albero + dettaglio**: dopo l'Add il pannello dell'albero rientra con una
  `LocateAndNavigate` su un view state nuovo, e lo scope di `currField` e' quello
  vecchio;
- **lista paginata**: la riga nuova puo' finire su un'altra pagina;
- **resa solo DATA**: il server emette `currField` nelle rese FULL/METADATA
  (`UIControl.java`); una lista che arrivasse solo in DATA non lo porta.

Il passaggio Shell -> contesto -> lista (armare, catturare, leggere e azzerare) non ha
un test automatico: e' verificato a schermo.

## Cosa NON cambia (principio del 07/10)

Salva e Annulla restano azioni del documento: una transazione, testata e righe
insieme. Niente Salva/Annulla di riga, niente pulsanti nuovi nel pannello, la toolbar
del documento non si offusca, il Cancella resta com'e'. 6010, 6045 e 6048 sono lavori
separati.
