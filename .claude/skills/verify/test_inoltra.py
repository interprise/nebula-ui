"""Test a scatola nera di inoltra.py, scritti dal contratto (docstring e uso).

Esecuzione: python3 test_inoltra.py
Solo stdlib, solo Linux (usa /proc/net/tcp per sapere se il forwarder ascolta,
senza aprire connessioni che verrebbero inoltrate).
"""
import hashlib
import http.server
import os
import socket
import socketserver
import struct
import subprocess
import sys
import threading
import time
import unittest
import http.client

QUI = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(QUI, "inoltra.py")
HOST = "127.0.0.47"
DURATA = 6  # secondi: abbastanza per un test, i processi vengono comunque terminati


# ---------- utilità ----------

def _hex_addr(host, porta):
    a = socket.inet_aton(host)
    return "%08X:%04X" % (struct.unpack("<I", a)[0], porta)


def ascolta(host, porta):
    """True se c'è un socket in LISTEN su host:porta (letto da /proc, senza connettersi)."""
    voce = _hex_addr(host, porta)
    with open("/proc/net/tcp") as f:
        for riga in f.readlines()[1:]:
            campi = riga.split()
            if campi[1] == voce and campi[3] == "0A":
                return True
    return False


def aspetta(cond, timeout=5.0, passo=0.05):
    fine = time.monotonic() + timeout
    while time.monotonic() < fine:
        if cond():
            return True
        time.sleep(passo)
    return cond()


def porta_libera():
    """Una porta effimera libera su 127.0.0.1 (e quindi plausibilmente anche su HOST)."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def avvia_forwarder(host, porta, durata=DURATA):
    """Lancia main(host, porta, durata) in un processo separato."""
    codice = (
        "import sys; sys.path.insert(0, %r); from inoltra import main; main(%r, %d, %r)"
        % (QUI, host, porta, durata)
    )
    p = subprocess.Popen(
        [sys.executable, "-c", codice],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return p


def recv_esatti(sock, n):
    buf = bytearray()
    while len(buf) < n:
        pezzo = sock.recv(min(65536, n - len(buf)))
        if not pezzo:
            raise ConnectionError("EOF dopo %d di %d byte" % (len(buf), n))
        buf += pezzo
    return bytes(buf)


def dati(n, seme):
    """n byte deterministici non banali (non ripetitivi su 64 KiB)."""
    out = bytearray()
    i = 0
    while len(out) < n:
        out += hashlib.sha256(b"%s-%d" % (seme, i)).digest()
        i += 1
    return bytes(out[:n])


# ---------- backend raw: protocollo a lunghezza prefissata ----------

RISPOSTA_EXTRA = 300 * 1024


class GestoreRaw(socketserver.BaseRequestHandler):
    """Legge [len][payload], risponde [len][payload rovesciato + 300 KiB], poi chiude."""

    def handle(self):
        try:
            testa = recv_esatti(self.request, 4)
        except ConnectionError:
            return  # connessione vuota: va bene
        n = struct.unpack("!I", testa)[0]
        payload = recv_esatti(self.request, n)
        risposta = payload[::-1] + dati(RISPOSTA_EXTRA, b"risposta")
        self.request.sendall(struct.pack("!I", len(risposta)) + risposta)
        self.request.close()


class ServerRaw(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


# ---------- backend HTTP: come il server monouso ----------

COOKIE = "entrasp_session=abc123.XYZ; Path=/; HttpOnly; SameSite=Lax"
LOCATION = "http://127.0.0.47:%d/dopo-login?x=1&y=%%2F"
CORPO_GRANDE = 200 * 1024


class GestoreHTTP(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        porta = self.server.server_address[1]
        if self.path.startswith("/token-"):
            self.send_response(302)
            self.send_header("Set-Cookie", COOKIE)
            self.send_header("Location", LOCATION % porta)
            self.send_header("Content-Length", "0")
            self.end_headers()
        elif self.path == "/grande":
            corpo = dati(CORPO_GRANDE, b"http")
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()


class ServerHTTP(http.server.ThreadingHTTPServer):
    daemon_threads = True


# ---------- test ----------

class BaseInoltra(unittest.TestCase):
    def setUp(self):
        self.processi = []
        self.server = []

    def tearDown(self):
        for s in self.server:
            s.shutdown()
            s.server_close()
        for p in self.processi:
            if p.poll() is None:
                p.kill()
            p.wait(timeout=5)
            p.stdout.close()
            p.stderr.close()

    def backend(self, cls, gestore, porta=0):
        s = cls(("127.0.0.1", porta), gestore)
        threading.Thread(target=s.serve_forever, daemon=True).start()
        self.server.append(s)
        return s.server_address[1]

    def forwarder(self, porta, durata=DURATA, host=HOST):
        p = avvia_forwarder(host, porta, durata)
        self.processi.append(p)
        ok = aspetta(lambda: ascolta(host, porta) or p.poll() is not None)
        if p.poll() is not None:
            self.fail("il forwarder è uscito subito (rc=%s): %s"
                      % (p.returncode, p.stderr.read().decode(errors="replace")))
        self.assertTrue(ok, "il forwarder non ascolta su %s:%d" % (host, porta))
        return p


class TestByte(BaseInoltra):
    def test_byte_intatti_nei_due_sensi_oltre_64k(self):
        porta = self.backend(ServerRaw, GestoreRaw)
        self.forwarder(porta)
        payload = dati(200 * 1024, b"richiesta")
        with socket.create_connection((HOST, porta), timeout=10) as c:
            c.sendall(struct.pack("!I", len(payload)) + payload)
            n = struct.unpack("!I", recv_esatti(c, 4))[0]
            risposta = recv_esatti(c, n)
            self.assertEqual(n, len(payload) + RISPOSTA_EXTRA)
            self.assertEqual(risposta[:len(payload)], payload[::-1])
            self.assertEqual(risposta[len(payload):], dati(RISPOSTA_EXTRA, b"risposta"))
            # il backend ha chiuso: anche il client deve vedere la chiusura
            self.assertEqual(c.recv(1), b"", "chiusura del backend non propagata al client")


class TestHTTP(BaseInoltra):
    def test_302_con_set_cookie_e_location_invariati(self):
        porta = self.backend(ServerHTTP, GestoreHTTP)
        self.forwarder(porta)
        conn = http.client.HTTPConnection(HOST, porta, timeout=10)
        conn.request("GET", "/token-0123456789abcdef")
        r = conn.getresponse()
        r.read()
        conn.close()
        self.assertEqual(r.status, 302)
        self.assertEqual(r.getheader("Set-Cookie"), COOKIE)
        self.assertEqual(r.getheader("Location"), LOCATION % porta)

    def test_corpo_http_oltre_64k(self):
        porta = self.backend(ServerHTTP, GestoreHTTP)
        self.forwarder(porta)
        conn = http.client.HTTPConnection(HOST, porta, timeout=10)
        conn.request("GET", "/grande")
        r = conn.getresponse()
        corpo = r.read()
        conn.close()
        self.assertEqual(r.status, 200)
        self.assertEqual(len(corpo), CORPO_GRANDE)
        self.assertEqual(corpo, dati(CORPO_GRANDE, b"http"))

    def test_due_connessioni_in_sequenza(self):
        porta = self.backend(ServerHTTP, GestoreHTTP)
        self.forwarder(porta)
        c1 = http.client.HTTPConnection(HOST, porta, timeout=10)
        c1.request("GET", "/token-uno")
        r1 = c1.getresponse()
        r1.read()
        c1.close()
        self.assertEqual(r1.status, 302)
        c2 = http.client.HTTPConnection(HOST, porta, timeout=10)
        c2.request("GET", "/favicon.ico")
        r2 = c2.getresponse()
        r2.read()
        c2.close()
        self.assertEqual(r2.status, 404)


class TestDurata(BaseInoltra):
    def test_smette_di_ascoltare_dopo_durata(self):
        porta = self.backend(ServerRaw, GestoreRaw)
        durata = 2
        inizio = time.monotonic()
        p = self.forwarder(porta, durata=durata)
        # prima della scadenza ascolta ancora
        time.sleep(0.5)
        self.assertTrue(ascolta(HOST, porta))
        # entro durata + margine il processo esce e la porta non ascolta più
        try:
            p.wait(timeout=durata + 4)
        except subprocess.TimeoutExpired:
            self.fail("main() non è tornato entro durata + 4 s")
        trascorso = time.monotonic() - inizio
        self.assertGreaterEqual(trascorso, durata - 0.5, "uscito troppo presto")
        self.assertFalse(ascolta(HOST, porta))
        with self.assertRaises(ConnectionRefusedError):
            socket.create_connection((HOST, porta), timeout=2).close()

    def test_main_ritorna_dopo_durata_in_processo(self):
        """main() chiamata direttamente (import) torna da sola dopo `durata`."""
        porta = porta_libera()
        sys.path.insert(0, QUI)
        try:
            from inoltra import main
        finally:
            sys.path.remove(QUI)
        t = threading.Thread(target=main, args=(HOST, porta, 1.5), daemon=True)
        inizio = time.monotonic()
        t.start()
        self.assertTrue(aspetta(lambda: ascolta(HOST, porta), timeout=3))
        t.join(timeout=6)
        self.assertFalse(t.is_alive(), "main() non è tornata dopo durata")
        self.assertGreaterEqual(time.monotonic() - inizio, 1.0)
        self.assertTrue(aspetta(lambda: not ascolta(HOST, porta), timeout=2))


class TestRifiuti(BaseInoltra):
    def test_rifiuta_127_0_0_1(self):
        sys.path.insert(0, QUI)
        try:
            from inoltra import main
        finally:
            sys.path.remove(QUI)
        porta = porta_libera()
        inizio = time.monotonic()
        with self.assertRaises(SystemExit):
            main("127.0.0.1", porta, 1)
        self.assertLess(time.monotonic() - inizio, 0.9, "rifiuto solo dopo aver girato")

    def test_rifiuta_127_0_0_1_da_riga_di_comando(self):
        r = subprocess.run([sys.executable, SCRIPT, "127.0.0.1", str(porta_libera())],
                           capture_output=True, timeout=10)
        self.assertNotEqual(r.returncode, 0)

    def test_argomenti_sbagliati_uscita_non_zero_con_uso(self):
        casi = [
            [],
            [HOST],
            [HOST, "abc"],
            [HOST, "12x"],
            [HOST, "40123", "extra"],
        ]
        for args in casi:
            with self.subTest(args=args):
                try:
                    r = subprocess.run([sys.executable, SCRIPT] + args,
                                       capture_output=True, timeout=5)
                except subprocess.TimeoutExpired:
                    self.fail("con argomenti %r non esce: sta girando" % (args,))
                self.assertNotEqual(r.returncode, 0)
                messaggio = (r.stdout + r.stderr).decode(errors="replace")
                self.assertTrue(messaggio.strip(), "nessun messaggio d'uso")
                self.assertNotIn("Traceback", messaggio, "traceback invece del messaggio d'uso")


class TestNessunBackend(BaseInoltra):
    def test_nessuno_ascolta_client_chiuso_forwarder_vivo(self):
        porta = porta_libera()
        p = self.forwarder(porta)
        with socket.create_connection((HOST, porta), timeout=5) as c:
            try:
                c.sendall(b"GET / HTTP/1.0\r\n\r\n")
                ricevuto = c.recv(1024)
            except (ConnectionResetError, BrokenPipeError):
                ricevuto = b""
            except socket.timeout:
                self.fail("connessione client lasciata appesa senza backend")
            self.assertEqual(ricevuto, b"")
        time.sleep(0.3)
        self.assertIsNone(p.poll(), "il forwarder è morto senza backend")
        self.assertTrue(ascolta(HOST, porta))
        # appena il backend c'è, una nuova connessione funziona
        self.backend(ServerHTTP, GestoreHTTP, porta=porta)
        conn = http.client.HTTPConnection(HOST, porta, timeout=10)
        conn.request("GET", "/token-dopo")
        r = conn.getresponse()
        r.read()
        conn.close()
        self.assertEqual(r.status, 302)
        self.assertEqual(r.getheader("Set-Cookie"), COOKIE)

    def test_nessuno_ascolta_nessun_traceback(self):
        porta = porta_libera()
        p = self.forwarder(porta, durata=2)
        for _ in range(2):
            with socket.create_connection((HOST, porta), timeout=5) as c:
                try:
                    c.recv(1)
                except OSError:
                    pass
        p.wait(timeout=8)
        err = p.stderr.read().decode(errors="replace")
        self.assertNotIn("Traceback", err)


if __name__ == "__main__":
    unittest.main(verbosity=2)
