#!/usr/bin/env python3
"""Inoltra <host>:<porta> verso 127.0.0.1:<porta>, per 150 secondi.

Serve al link monouso di `entrasp-sql --login-session`, il cui server ascolta solo
su 127.0.0.1: aprendo il link con un altro host di loopback (127.0.0.4N) il cookie
di sessione finisce su quell'host, separato da quello delle altre sessioni.

Uso: setsid python3 inoltra.py <host> <porta> >/dev/null 2>&1 &
Esce da solo dopo 150 s; le connessioni aperte si chiudono con lui.
"""
import socket
import sys
import threading
import time

DURATA = 150


def pompa(da: socket.socket, a: socket.socket) -> None:
    try:
        while True:
            dati = da.recv(65536)
            if not dati:
                break
            a.sendall(dati)
    except OSError:
        pass
    finally:
        for s in (da, a):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


def main(host: str, porta: int, durata: float = DURATA) -> None:
    if host == "127.0.0.1":
        raise SystemExit("con 127.0.0.1 non serve: apri il link così com'è, con 127.0.0.1 al posto di localhost")
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, porta))
    srv.listen(8)
    srv.settimeout(0.5)
    fine = time.time() + durata
    while time.time() < fine:
        try:
            cliente, _ = srv.accept()
        except socket.timeout:
            continue
        try:
            locale = socket.create_connection(("127.0.0.1", porta), timeout=5)
        except OSError:
            cliente.close()
            continue
        locale.settimeout(None)
        threading.Thread(target=pompa, args=(cliente, locale), daemon=True).start()
        threading.Thread(target=pompa, args=(locale, cliente), daemon=True).start()
    srv.close()


if __name__ == "__main__":
    if len(sys.argv) != 3 or not sys.argv[2].isdigit():
        raise SystemExit("uso: inoltra.py <host> <porta>")
    main(sys.argv[1], int(sys.argv[2]))
