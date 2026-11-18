---
name: verify
description: Come provare ui-new (client React nebula-ui con nebulaerp e CORE) dal vivo prima di dire che funziona — turno sul Tomcat condiviso :9080, entrasp-up o tomcat-restart, un host per sessione, login con entrasp-sql --login-session, browser su una pagina sola, prova del solo client senza turno, bundle ricostruito e confrontato con quello schierato. Caricala come prima cosa, prima di esplorare il codice, in questo workspace quando: un mandato o un ticket SXADV chiede il controllo a schermo; c'è da riprodurre un difetto segnalato da Elena o dal collaudo; una modifica tocca quello che l'utente vede (maschere, liste AG Grid, Micro-Detail, toolbar, controlli, sessioni S1/S2); devi schierare o riavviare :9080, avviare il Vite o lanciare uno script e2e/*.live.mjs o *.e2e.mjs; devi controllare che il bundle schierato sia quello del tuo ramo. Non usarla per i soli test vitest, per commenti Jira, push o rilasci, né per domande sul codice.
---

# Verify: ui-new dal vivo

La sequenza per vedere il client React girare contro il server vero (o contro un server simulato) senza pestare
le altre sessioni. Le regole generali (una pagina del browser, un host per sessione, ALFA sì e produzione solo in
lettura) sono nella skill globale `verifica-dal-vivo`; come si dichiara la prova, in `dichiarare-verifica`; chi
scrive i test, in `test-indipendenti`.

Ogni passo dice come capisci che è andato bene (**→ ok se**). Le variabili d'ambiente **non sopravvivono** fra
due chiamate Bash: ogni comando qui sotto porta le sue, e `<wt>`, `<host>`, `<porta>` vanno scritti per esteso.

## 0. Dove e con cosa

**Su che DB sei.** Di regola ALFA (`pandoraalfa44`): dati e password di collaudo, un Salva fatto dall'app durante
la prova è al più una nota; SQL che scrive e migrazioni no (memoria `alfa-dati-di-test`). Ma `entrasp-target` può
puntare ui-new altrove, produzione compresa:
```bash
entrasp-target --ws ui-new --stato
```
→ ok se tutte le righe dicono `(nessun target)` e `pandoraalfa44`. Altrimenti lavagna: con un target attivo non si
copia `core.properties` e non si usa `entrasp-up` (si riavvia con `tomcat-restart`, vedi `verifica-dal-vivo`).

**Worktree.** Per **riprodurre** un difetto su quello che gira già su :9080 basta il passo 1 e poi il 4: niente
worktree. Per **modificare codice**, un worktree per ticket, mai il checkout condiviso `~/ui-new`, con le cartelle
dei repo sorelle sotto una sola, perché `npm run build` scrive in `../entrasp/WebContent/app` (memoria
`ui-new-worktree-per-ticket`):
```bash
mkdir -p ~/ui-new-<t>
git -C ~/ui-new/entrasp-ui fetch -q origin && git -C ~/ui-new/entrasp-ui worktree add -b sxadv-<t> ~/ui-new-<t>/entrasp-ui origin/master
git -C ~/ui-new/entrasp fetch -q origin && git -C ~/ui-new/entrasp worktree add -b sxadv-<t> ~/ui-new-<t>/entrasp origin/react-ui
cd ~/ui-new-<t>/entrasp-ui && npm ci
cp ~/ui-new/entrasp/src/core.properties ~/ui-new-<t>/entrasp/src/ && ENTRASP_WS_ROOT=/home/luca/ui-new-<t> nebula-codegen
```
(`core.properties` è ignorato da git; il codegen scrive circa 3.200 file in `model/generated/`.)

**Repo Maven.** Il `~/.m2` condiviso può avere un `nebulafw-2.0.0` di un altro ramo (memoria
`m2-condiviso-override-e-turni`): non si costruisce mai contro quello e non ci si installa mai CORE.
- CORE non toccato: si usa il repo del checkout condiviso, `/home/luca/ui-new/.m2repo`.
- CORE toccato: anche CORE in worktree (il remoto è `gh`, non `origin`) e un repo tuo, con la copia **vera** della
  sola cartella nebulafw, perché un install su un hardlink scriverebbe nel file condiviso:
  ```bash
  git -C ~/ui-new/CORE fetch -q gh && git -C ~/ui-new/CORE worktree add -b sxadv-<t> ~/ui-new-<t>/CORE gh/react-ui
  cp -al ~/ui-new/.m2repo ~/ui-new-<t>/.m2repo
  rm -rf ~/ui-new-<t>/.m2repo/it/sixtema/nebulafw && cp -a ~/ui-new/.m2repo/it/sixtema/nebulafw ~/ui-new-<t>/.m2repo/it/sixtema/
  ```

**Host e porta**, da tenere per tutta la prova e da scrivere nella nota di turno (non copiare quelli della prova
del 18/11, `127.0.0.47`):
- **host** `127.0.0.4N` con N tuo, per il browser condiviso (passo 5). Il cookie vale per host: due sessioni
  sullo stesso host nel Chrome di Claude in Chrome finiscono nella stessa HttpSession e si scambiano le schede S1,
  S2 (memoria `chrome-cookie-localhost-condiviso`). Con Playwright basta `localhost`;
- **porta del Vite**, se ti serve: libera, `ss -ltn | grep -c ':<porta> '` → `0` (5173 è di solito del checkout
  condiviso).

## 1. Turno su :9080

Il Tomcat di ui-new è **uno solo per tutti i worktree**: chi schiera sovrascrive il WAR degli altri. Il turno
serve per schierare, riavviare e per ogni prova che misura il server. Per provare solo il client non serve
(passo 6).

```bash
python3 -c "
import json
u = {}
for l in open('/home/luca/.claude/fleet/board.jsonl'):
    try: e = json.loads(l)
    except ValueError: continue
    if '9080' in e.get('id', '') or e.get('id', '').startswith('SXADV-62-'): u[e['id']] = e
for i, e in u.items():
    if e['lane'] in ('stato', 'decisione'): print(e['ts'][:16], i, e['lane'], e.get('what', '')[:110])"
tomcat-status --mine
```
→ ok se nessuna voce aperta in `stato` o `decisione` di oggi parla di :9080 in uso. `tomcat-status` dice solo se
il Tomcat CLI è acceso e di chi è la porta (CLI o Eclipse), non quale sessione lo usa: quello lo dice la lavagna.
Le voci vecchie hanno id per ticket (`SXADV-xxxx-TURNO-9080`); una voce `SXADV-62-*` aperta vuol dire che la
dashboard ha la precedenza (Luca, 21/09). Le voci ferme da giorni (es. `SXADV-TURNO-9080-dashboard` del 02/11) non
bloccano, ma vanno citate nella tua. Se il server serve a un altro, lavagna e intanto passo 6.

```bash
board post --id UI-NEW-9080 --lane stato --what "in uso: <sessione>, <ticket>, WAR di <wt>, host <host>"
```

## 2. Avvio o riavvio

Prima, sempre:
```bash
hostname; grep -a '^dev.domain' <wt>/entrasp/src/core.properties
ip -brief addr show tun0
```
→ ok se l'hostname **finisce con** `dev.domain` (oggi `luca-linux2`): altrimenti CORE va in run mode PROD e apre
`url.prod`, il DB di produzione (memoria `dev-domain-hostname-run-mode`). E se `tun0` c'è: è la VPN, che
avvia Luca (`~/vpn.sh` vuole il suo certificato). Senza VPN, lavagna; quando torna, `tomcat-restart` dentro il turno
(memoria `vpn-caduta-vuole-riavvio-tomcat`).

| Cosa è cambiato | Comando |
|---|---|
| entrasp (Java) o client React | `MAVEN_OPTS=-Dmaven.repo.local=/home/luca/ui-new/.m2repo ENTRASP_WS_ROOT=<wt> entrasp-up --skip-core` |
| CORE | `MAVEN_OPTS=-Dmaven.repo.local=<wt>/.m2repo ENTRASP_WS_ROOT=<wt> entrasp-up` |
| niente da ricostruire: VPN caduta e tornata, app appesa | `tomcat-restart` |

`entrasp-up` costruisce, schiera, riavvia e torna solo quando l'app risponde; se la porta è del Tomcat di Eclipse
si rifiuta: non forzare.

→ ok se:
- `curl -s --max-time 5 -o /dev/null -w '%{http_code}' -X POST -d action=GetConfig http://localhost:9080/entrasp/controller2`
  dà `200`: l'app è su (la pagina `/entrasp/` dà 200 anche con l'app bloccata; il DB lo prova il login del passo 4);
- il CORE nel WAR è quello che hai scelto:
  `md5sum ~/tomcat/entrasp-base-ui-new/webapps/entrasp/WEB-INF/lib/nebulafw-2.0.0.jar <repo scelto>/it/sixtema/nebulafw/2.0.0/nebulafw-2.0.0.jar`
  → stessi md5.

## 3. Vite (solo se ti serve il ricaricamento a caldo)

```bash
cd <wt>/entrasp-ui && npx vite --config vite.config.poll.mts --host <host> --port <porta> --strictPort   # in background
```
`npm run dev` muore con `ENOSPC` (gli osservatori inotify li tiene Eclipse): la configurazione `poll` interroga i
file invece. → ok se `curl -s --max-time 5 -o /dev/null -w '%{http_code}' http://<host>:<porta>/entrasp/app/` dà
`200`. Il proxy va a `localhost:9080`. Il Vite legge i sorgenti, non il bundle: la prova del bundle è il passo 7.

Senza Vite, l'app è su `http://<host>:9080/entrasp/app/` (il Tomcat ascolta su tutti gli indirizzi).

## 4. Login

L'utente è il `codice_part` della partizione più `AMM`: Modena è **44AMM**. Se non torna:
`entrasp-sql "select login from utenti where login like '%AMM'"`. Non chiedere password a Luca e non usare
`--login`, che la stampa.

```bash
entrasp-sql --login-session 44AMM --to http://<host>:<porta o 9080>/entrasp/app/
```
Torna in un secondo e stampa `aprire entro 120 s, vale una volta: http://localhost:<p>/<token>`. Non metterlo in
pipe né sotto `timeout` (la memoria lo segnala come causa di link morti). Poi:
- con `localhost` (Playwright): apri il link così com'è;
- con `127.0.0.4N`: il server monouso ascolta solo su 127.0.0.1. Subito, inoltra la sua porta col tuo host e apri
  il link sostituendo `localhost` col tuo host:
  `setsid python3 <cartella di questa skill>/inoltra.py <host> <p> >/dev/null 2>&1 &`
  (si chiude da solo dopo 150 s).

→ ok se la pagina finisce su `/entrasp/app/` con il menu a sinistra e il nome utente in alto, non la maschera di
login. Se il classificatore blocca la lettura dell'output di `--login-session`, lavagna: non si aggira.

In locale gira lo `StandardAuthenticator`, non l'SSO di Piero che usano Elena e i clienti: un difetto di accesso,
uscita o cambio password che in locale non si riproduce non è smentito (memoria `local-login-is-not-the-real-login`).

## 5. Browser

- **Claude in Chrome**: è il Chrome vero di Luca, con il profilo condiviso fra sessioni. Qui l'host tuo
  `127.0.0.4N` è obbligatorio, una scheda tua, chiusa a fine prova.
- **chrome-devtools**: istanza unica, una pagina sola: `list_pages`, poi `select_page` + `navigate_page` sul link;
  `new_page` solo se non ce n'è nessuna, e la vuota in più la chiudi tu (memoria `chrome-devtools-riusa-la-pagina`).
  Se risponde «The browser is already running», lo tiene un'altra sessione: non chiuderlo, usa Playwright.
- **Playwright**: contesto suo, niente cookie in comune con nessuno, quindi `localhost` va bene e l'inoltro non
  serve. Modello col browser: `e2e/sxadv5959-ultima-scelta.live.mjs` (`APP=http://localhost:9080/entrasp/app/
  USER_LOGIN=44AMM`): login con `--login-session`, conteggio delle POST a `controller`/`controller2`, sola lettura
  dichiarata in testa. Gli altri `.live.mjs` (5776, 5958, 5960) sono solo HTTP, senza browser, e prendono
  `BASE=http://localhost:9080/entrasp`. nebula-ui non ha Playwright fra le dipendenze: sta nella cache di npx e la
  cartella cambia nome, quindi
  `PLAYWRIGHT_DIR=$(ls -d ~/.npm/_npx/*/node_modules/playwright | head -1 | sed 's#/playwright$##')` (il default
  scritto negli script può non esistere più).
  Provato il 18/11/2026: 44AMM, vista Utenti aperta con `GetConfig, JSONMenu, dashboard.Get, ExecuteMenuItem`.

→ ok se vedi il comportamento atteso **sui dati** e sulle richieste (quale `action`, quante volte), non solo la
maschera che si apre. Un difetto segnalato si riproduce prima della correzione, sullo stesso percorso del ticket.

## 6. Solo il client, senza turno

Quando la prova riguarda il rendering e non il server, :9080 non serve (memoria
`prove-client-senza-tomcat-condiviso`):
- **server simulato**: il client vero dal tuo Vite, le risposte con `page.route` (modello:
  `e2e/sxadv5989-session-switch.e2e.mjs`, che intercetta anche immagini e plugin);
- **bundle dal disco**: i file di `<wt>/entrasp/WebContent/app` serviti da `page.route` (modello da copiare:
  `~/ui-new/docs/sxadv-62-prove/g7_test.mjs`, opzione `G7_APP_DA`; il percorso di Playwright lì dentro è fisso e
  va aggiornato come al passo 5).

Come ultima regola registra `page.route('**/entrasp/**', r => { fughe++; r.abort(); })`: risponde a tutto quello
che le altre non hanno preso. → ok se `fughe` è `0` a fine prova. Contare le richieste «verso :9080» non prova
niente: dal Vite passano per il proxy e la pagina non le vede andare a :9080.

Resta legata al server, e chiede il turno, la prova che ha il server per oggetto (SQL, comandi, salvataggi).

## 7. Bundle

QA e ALFA vedono il React solo attraverso il bundle tracciato in nebulaerp (memoria
`bundle-react-sempre-ricostruito`).

```bash
cd <wt>/entrasp-ui && npm run build        # scrive in <wt>/entrasp/WebContent/app
diff -rq <wt>/entrasp/WebContent/app ~/tomcat/entrasp-base-ui-new/webapps/entrasp/app
md5sum <wt>/entrasp/WebContent/app/assets/index-*.js     # per la nota
```
→ ok se `diff` non stampa niente: quello che hai provato su :9080 è quello che consegni (anche il CSS, che il solo
md5 del `.js` non vede). Se differiscono, sul server c'è il WAR di qualcun altro o uno vecchio: rischiera (passo
2) prima di dire che hai provato il tuo.

Il commit del bundle va su nebulaerp `react-ui` con gli SXADV nel soggetto e `(REACT <sha nebula-ui>)` in coda:
**lì Claude non si nomina**, niente trailer, e nemmeno nel commento Jira. Il push, su tutti e tre i repo, solo con
la parola di Luca nella sessione (memoria `via-al-push-nella-sessione`).

## 8. Pulizia (sempre, anche se la prova fallisce)

1. Spegni Vite e script: `pgrep -f '[v]ite --config vite.config.poll.mts --host <host> --port <porta>' | xargs -r kill`
   (mai `pkill -f` col testo del comando: uccide la shell che lo lancia), poi `ss -ltn | grep -c ':<porta> '` → `0`.
2. Browser: chiudi la tua scheda di Claude in Chrome o la pagina vuota in più di chrome-devtools; con Playwright,
   `browser.close()`.
3. Dati ALFA: quello che la prova ha salvato, rimettilo com'era se sai com'era; altrimenti scrivilo nella nota.
4. Turno: `board post --id UI-NEW-9080 --lane nota --what "libero: <sessione>, su :9080 resta il WAR di <wt> (index <md5>)"`.
   In `nota`, non in `stato`: una voce `stato` resta «in corso» sulla lavagna di Luca.

## Trappole note

- 500 a corpo vuoto su **tutte** le richieste: con il Tomcat di Eclipse è l'hot-swap fallito dopo una modifica a
  CORE, e si riavvia (memoria `core-change-needs-server-restart`). Col Tomcat CLI una modifica a CORE arriva solo con
  `entrasp-up`, che riavvia già: lì un 500 è un errore vero, si legge `tomcat-tail`.
- Un Tomcat privato in un worktree è possibile solo con l'host dedicato concesso da Luca (memoria
  `tomcat-privato-in-worktree`: togliere `services.dev`, non copiare `conf/Catalina`).
- 8 file di `entrasp-ui` sono CRLF (fra cui `ViewRenderer.tsx`, `ListRenderer.tsx`, `global.css`): Edit mirati,
  mai script che riscrivono il file intero.
