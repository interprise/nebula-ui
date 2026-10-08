# SXADV-6045 — Gestione riga: Annulla di riga, Cancella che non chiude il pannello

Seguito di SXADV-6010 (`20261007_SXADV-6010_toolbar_di_riga.md`). Il pannello di riga
di una lista listEdit/multiEdit ha la toolbar della pagina centrata sulla riga.

## Cosa cambia

1. **Titolo**: "Modifica riga" diventa **"Gestione riga"**.
2. **Annulla di riga**: nuova voce della toolbar di riga, fra Salva+ e Nuovo, come in
   alto. Ordine finale: **Salva, Salva+, Annulla, Nuovo**, poi Cancella e Chiudi.
3. **Cancella** non chiude piu' il pannello: dopo la cancellazione il pannello passa
   alla riga che ha preso il posto di quella cancellata, o alla precedente se era
   l'ultima; si chiude solo se la lista resta vuota. La conferma resta.

## `rowToolbarActions` (src/components/rowToolbar.ts)

Si aggiunge la chiave `'cancel'` a `RowToolbarAction.key`.

- Presente se e solo se c'e' il Salva di riga (stessa regola del 6010: c'e' una voce
  `save*` non `saveNew*` con un comando) **e** nella toolbar della pagina c'e' una voce
  con `id` che comincia per `cancel`.
- `label: 'Annulla'`, `icon: 'undo'`, `action: 'CancelRow'`,
  `params: { navpath: rowPath }`, `disabled: false` sempre: l'Annulla del documento e'
  spento quando la Session non ha modifiche, ma la riga puo' avere valori digitati e
  non ancora spediti, e cosa c'e' da annullare lo sa il server.
- Ordine: `save`, `saveNew`, `cancel`, `new`.

## `pathAfterRemoval(removedPath, paths)` (src/components/rowToolbar.ts)

Quale riga mostra il pannello dopo che la riga `removedPath` e' stata tolta (Cancella,
o Annulla di una riga nuova). `paths` sono i percorsi delle righe della lista DOPO la
risposta, in ordine. I percorsi di riga sono posizionali: `<prefisso>.<n>`.

- Se `paths` contiene `removedPath` restituisce `removedPath` (la riga successiva e'
  scivolata in quella posizione, oppure la riga non e' stata tolta: errore, o un
  Annulla di una riga esistente).
- Altrimenti, fra i percorsi con lo stesso prefisso (`removedPath` senza l'ultimo
  numero dopo il punto) restituisce quello con l'indice piu' alto minore di quello
  tolto.
- Altrimenti `null` (lista vuota, o percorso senza indice): il pannello si chiude.

## ListView / EditPanel

- `EditPanel` non chiama piu' `onClose()` dopo il Cancella: chiama `onRemoved(path)`.
  `ListView` ricorda il percorso e, quando arrivano i record nuovi, sceglie la riga con
  `pathAfterRemoval`, ne fa la riga del pannello e il navpath di riga
  (`setEditRow`), o chiude il pannello se e' `null`.
- Lo stesso per l'Annulla di riga: dopo `CancelRow` il pannello resta sulla riga (riga
  esistente: valori di prima) o passa alla precedente (riga nuova tolta).
- Il CORE di `CancelRow`: `CORE/docs/20261008_SXADV-6045_annulla_di_riga.md`.

## Doppio clic

`onRemoved` restituisce `false` se una rimozione e' gia' in volo (meno di 15 s): il
secondo clic su Annulla o Cancella viene ignorato, perche' col percorso posizionale
colpirebbe la riga scivolata al posto di quella tolta. Dopo 15 s senza risposta la
rimozione in sospeso scade.

## Salva+ e il Post di ricalcolo (Shell)

Il flag "riga appena aggiunta" (`pendingAddRef`) di `Add` e `SaveAndNew` si arma
all'ARRIVO della risposta, non all'invio. Digitando l'importo e premendo subito
Salva+, il campo importo manda prima un Post di ricalcolo; la sua risposta arrivava
con il flag gia' armato, veniva presa per quella dell'aggiunta, e il pannello restava
fisso sulla riga salvata invece di passare alla nuova (difetto del 6010, trovato a
schermo sul 6045).
