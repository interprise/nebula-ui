# Valori di colonna posizionali e richieste su una riga (difetto trovato con SXADV-6011)

## Il difetto (riprodotto il 07/10/2026, anche col codice di prima)

Prima Nota nuova, tab *Reg. contabili* (multiEdit): riga 1 compilata, riga 2 vuota,
nessun salvataggio. F5, poi "Nuovo" sulla lista. La richiesta parte con

```
navpath=S1-0.0,S1-9.1 & descrizione.S1-9=riga uno & descrizione.S1-9= & dare.S1-9=100,00 & dare.S1-9= …
```

e il server scrive sulla riga 2 i valori della riga 1: descrizione, sottoconto, DARE.
Nessun errore, nessun avviso. I dati sono corrotti in sessione e finiscono nel DB al
Salva.

**Perche'.**

1. *Client.* Quando la griglia di una lista multiEdit si monta, `initGridFormValues`
   (ListRenderer) mette nei valori del form, per ogni colonna con
   `control.editable`, l'array dei valori di TUTTE le righe della pagina, sotto la
   chiave `campo.<idViewState>` (es. `descrizione.S1-9`). Nelle rese METADATA/DATA il
   server non marca modificabili le colonne non booleane di una multiEdit, quindi di
   solito parte solo la colonna di spunta. Nella resa FULL (F5 -> `Refresh full=1`) le
   marca, e partono tutte. Gli array restano nei valori finche' non arriva la
   risposta successiva, quindi viaggiano con la prima richiesta.
2. *Server.* `ToolViewState.postChildren`/`postData`: se il navpath punta una riga
   della lista (`getCurrentEditPosition() != -2`), il server scrive SOLO quella riga e
   legge i parametri all'istanza 0, cioe' il primo elemento dell'array: il valore
   della riga 1. Il giro posizionale su tutta la pagina c'e' solo quando la
   richiesta non punta nessuna riga.

Un array per colonna ha senso solo nel giro posizionale. Insieme a un navpath che
punta una riga di quella lista, scrive su quella riga il valore della riga 1.

## Contratto

### 1. La griglia non carica i valori di colonna quando si monta

`ListRenderer` non mette piu' nei valori del form gli array delle colonne quando la
griglia si monta. Quei valori sono quelli che il server ha appena mandato, quindi
rispedirli non serve. Gli array si mandano solo quando l'utente cambia
qualcosa in griglia (la spunta di selezione: `pushColumnValues` dal toggle), come
oggi.

### 2. `withoutPositionalArrays(values, navpath)` — `src/services/positionalValues.ts`

```ts
export function withoutPositionalArrays(
  values: Record<string, string | string[]>,
  navpath: string | null | undefined,
): Record<string, string | string[]>
```

- `navpath` e' una catena di segmenti separati da virgola (`S1-0.0,S1-9.1`). Un
  segmento **punta una riga** quando finisce con `.<intero>` (anche negativo:
  `S1-0.-1` e' il record nuovo della testata); la parte prima dell'ultimo punto e'
  l'id del view state (`S1-9`). Un segmento senza posizione (`S1-9`, la lista intera
  delle ListActions) non punta niente.
- Toglie dai valori ogni voce il cui valore e' un **array** e la cui chiave finisce
  con `'.' + id` per l'id di un segmento che punta una riga. Il confronto e' esatto
  sull'id intero: `x.S11-9` non e' del view state `S1-9`.
- Le voci scalari restano tutte, anche quelle dello stesso view state (sono i campi
  del pannello e della testata). Restano anche gli array degli altri view state e
  tutti gli array quando il navpath manca, e' vuoto o non punta righe.
- Non modifica `values`. Quando toglie qualcosa restituisce un oggetto nuovo; quando
  non c'e' niente da togliere puo' restituire `values` stesso.

### 3. Dove si applica

`api.postAction(action, params, formValues, sid)` spedisce
`withoutPositionalArrays(formValues, params.navpath)` al posto di `formValues`. E'
il punto da cui partono tutte le richieste con i valori del form.

## Effetto a schermo

Dopo F5 (o in qualunque resa FULL di una lista multiEdit con righe), "Nuovo",
"Salva" del documento e le modifiche dal pannello di riga non scrivono piu' su una
riga i valori di un'altra.

Caso limite accettato: se l'utente spunta caselle di selezione in una multiEdit e
poi fa un'azione puntata su una riga (pannello aperto), le spunte non partono e la
lista torna come la manda il server. Prima venivano applicate alla riga sbagliata.
Le ListActions (Tutti/Nessuno/...) usano un navpath senza posizione e non cambiano.

## Limite noto (revisione indipendente, 07/10): la riga puntata la ricorda il server

Il server tiene la riga puntata (`Session.setPostPath`) anche per le richieste dopo,
che non portano un navpath: la spostano solo i comandi che ne ricevono uno o che
navigano. Il client invece guarda soltanto il navpath della richiesta. Quindi resta
questo caso:

1. pannello aperto sulla riga 2 di una multiEdit (il server ricorda `…,S1-9.1`);
2. il client dimentica la riga (ordinamento, Refresh, F5) ma il server no;
3. l'utente spunta la casella di selezione della riga 3;
4. Salva dalla toolbar, senza navpath: l'array della spunta parte, il server scrive
   sulla riga 2 la spunta della riga 1, e la spunta della riga 3 si perde.

Esisteva gia' prima, e su tutte le colonne. Dopo questa correzione gli unici array
che partono sono quelli delle caselle che l'utente ha toccato, quindi il danno e'
limitato alla colonna di spunta. Ricostruire dal client la riga che il server ricorda
e' fragile, perche' la spostano decine di comandi. Il rimedio vero sta in CORE: nel
ramo "riga puntata" di `ToolViewState.postData`/`postChildren`, un parametro che ha
piu' valori e' posizionale e non va letto come valore della riga.
