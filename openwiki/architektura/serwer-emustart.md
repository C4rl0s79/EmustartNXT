---
type: architektura
title: "EmuStart Server"
description: "EmuStart Server (server_main.py / EmuStartServer.exe): tryby uruchomienia, katalog danych server\\, porty zwykły, szyfrowany i publiczny, reguły dostępu w server.py, autostart przez Harmonogram zadań i zadania w tle."
tags: [emustart, server, tls, firewall, upnp, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-11T20:26:15.897Z
sources:
  - id: openwiki-source-c689b27cb9963760bf507303
    resource: repo://emustart/emustart/paths.py
  - id: openwiki-source-37e7277eedf5a9b2062b9903
    resource: repo://emustart/emustart/public.py
  - id: openwiki-source-39316019f7b366045ad545d4
    resource: repo://emustart/emustart/remote.py
  - id: openwiki-source-a124d623671267edfd450054
    resource: repo://emustart/emustart/server.py
  - id: openwiki-source-c08534823933971ba14ec84c
    resource: repo://emustart/emustart/tls.py
  - id: openwiki-source-dc1c4e0ec4611cab17206a30
    resource: repo://emustart/server_main.py
generated: { by: "claude-code", at: "2026-11-11T20:26:15.897Z" }
---

# EmuStart Server

Serwer gier to **osobny program** od klienta EmuStart: `emustart/server_main.py`, zbudowany jako
`EmuStartServer.exe`. Udostępnia urządzeniom bibliotekę gier, grafiki, konta, emulatory, BIOS-y,
synchronizację zapisów i archiwum GOG przez API `/v1/…` (zob. [API /v1](../przeplywy/api-v1.md)).

## Tryby uruchomienia

Docstring `emustart/server_main.py`:

| Polecenie | Działanie |
|---|---|
| `EmuStartServer.exe` / `--panel` | okno panelu serwera (stan, konfiguracja, urządzenia, konta, aktualizacja); uruchamia serwer, jeśli nie odpowiada |
| `EmuStartServer.exe --service` | serwer bez okna (zadanie Harmonogramu „EmuStart Server”) |
| `EmuStartServer.exe --install` | autostart z Windows, zapora, skrót w menu Start (jako administrator) |
| `EmuStartServer.exe --login-link` | link logowania urządzenia do schowka (komputer bez aparatu) |

- Panel i `--login-link` działają na koncie użytkownika i logują do
  `%LOCALAPPDATA%\EmuStart Server\logs\panel.log` (`boot.user_logs()`); panel łączy się z serwerem
  przez `127.0.0.1` (`srvadmin.ping`), a gdy ten nie odpowiada — próbuje go uruchomić.
- `--service`/`--install` logują do `logs\emustart.log` obok programu.
- `--login-link` prosi działający serwer o kod (`POST /admin/login_code` na `127.0.0.1` z nagłówkiem
  `X-EmuStart: 1`) i kopiuje link (jednorazowy, ważny 10 minut) do schowka.

### `--install` (wymaga administratora, tylko wersja zbudowana)

`remote.install_autostart` (`emustart/emustart/remote.py`):

1. `icacls` na folderze programu: pełny dostęp tylko SYSTEM i Administratorzy, zwykli użytkownicy —
   odczyt (żeby nikt nie podmienił DLL wykonywanej przez serwer na koncie SYSTEM);
2. `schtasks`: zadanie „EmuStart Server” przy starcie systemu, konto SYSTEM, `--service`; potem
   PowerShell zdejmuje limit czasu zadania i ustawia 3 ponowienia co minutę po awarii;
3. skrót „EmuStart Server” do panelu w menu Start dla wszystkich użytkowników;
4. reguły zapory `EmuStart Server` (port zwykły) i `EmuStart Server (szyfrowany)` (port + 1).

## Katalog danych `server\`

Serwer trzyma wszystko poza grami w podkatalogu `server` obok programu (`paths.SERVER`,
`emustart/emustart/paths.py`): `config.json`, `library.sqlite`, `media\` (grafiki), konta, certyfikat.
Skopiowanie katalogu programu przenosi serwer. Przy pierwszym starcie `--service` przenosi tam
`config.json` i folder `data` z wersji 0.x (`use_server_layout(migrate=True)`).

## Start serwera (`_server_mode`)

Kolejno (`emustart/server_main.py`):

1. `srvapi.ServerApi()`, wspólny klucz serwera (`remote.ensure_token`, działa tylko na tym komputerze);
2. folder profili (`remote.init_nas`) — zapisy klientów przez serwer;
3. gdy ustawiono `gog_depots_dir` — indeks archiwum GOG w tle (`gogarchive.refresh`) i reguły zapisów
   gier GOG (`saverules.update_async`, raz na tydzień);
4. harmonogramy w tle: kopie kont raz dziennie (`acctbackup`), nowe wersje emulatorów raz dziennie
   (`emustore.scheduler`), programy do pobrania ze strony serwera (`clientdist.scheduler`);
5. import kluczy źródeł grafik z `server\art_keys.json` (plik jest potem usuwany);
6. HTTP na `0.0.0.0:<server_port>` (domyślnie **8740**, `remote.DEFAULT_PORT`); po restarcie z panelu
   (`--restarted`) czeka do 30 s na zwolnienie portu;
7. port szyfrowany (`_start_tls`) i — jeśli włączony — port publiczny oraz tunel.

## Porty i reguły dostępu

| Port | Domyślnie | Ustawienie | Kto | Co |
|---|---|---|---|---|
| zwykły (HTTP) | 8740 | `server_port` | ten komputer, LAN, Tailscale | panel/UI/`/api` i `/admin` tylko z `127.0.0.1`; `/v1` tylko z `127.0.0.1` |
| szyfrowany (HTTPS) | zwykły + 1 | `server_tls_port` | ten komputer, LAN, Tailscale | `/v1` dla urządzeń, grafiki |
| publiczny (HTTPS) | 8742 | `server_public_port`, włącza `server_public` | internet (UPnP) | tylko `/v1/`, `/media/`, `/assets/` z tokenem urządzenia + strona serwera |

Reguły w `emustart/emustart/server.py`:

- `_near`: port zwykły i szyfrowany przyjmują tylko adresy prywatne, loopback, link-local i Tailscale
  (`100.64.0.0/10`); zapytanie z internetu dostaje 403 i ostrzeżenie w logu (raz na godzinę na port).
- `_v1_ok`: `/v1` tylko przez TLS, albo z loopbacku bez nagłówka `CF-Connecting-IP` (od 0.43).
- `_local_ui`: interfejs, `/api` i `/admin` tylko z loopbacku, z `Host: 127.0.0.1:<port>` lub
  `localhost:<port>` (ochrona przed DNS rebinding), nigdy z portu publicznego ani tunelu; dodatkowo
  `POST` wymaga `X-EmuStart: 1`.
- `refuse`: przed odmową doczytuje treść zapytania (do 1 MB), żeby Windows nie zrywał połączenia RST.

### Certyfikat (`emustart/emustart/tls.py`)

Serwer tworzy własny certyfikat (EC P-256, 20 lat) w katalogu serwera. Klienci nie sprawdzają go
w urzędzie certyfikacji, tylko porównują odcisk SHA-256 z odciskiem z kodu QR / logowania
(„przypięcie”). Klucz prywatny `tls-key.pem` jest zaszyfrowany losowym hasłem, a hasło chronione DPAPI
komputera (`tls-key.pass`) — kopia folderu na innym komputerze jest bezużyteczna. Przeniesienie
serwera: panel → „Przygotuj przeniesienie” (plik `przeniesienie.emustart`). Bez biblioteki
`cryptography` port szyfrowany się nie otwiera.

### Dostęp z internetu (`emustart/emustart/public.py`)

Włączany w panelu („Dostęp z internetu”). Serwer prosi router przez UPnP o przekierowanie portu
publicznego i odnawia je co 20 minut, wykrywa CGNAT, podaje klientom adres zewnętrzny jako rodzaj
`public`. Bez tokenu urządzenia działają tylko `/v1/enroll/request`, `/v1/enroll/poll`,
`/v1/auth/challenge`, `/v1/auth/token`. 20 błędnych kluczy w 10 minut z jednego adresu → blokada
na 30 minut; najwyżej 32 połączenia naraz z jednego adresu.

## Panel serwera i strona serwera

- `/admin/…` — API panelu (`emustart/emustart/srvadmin.py`), wyłącznie z tego komputera.
- Strona serwera (`emustart/emustart/webportal.py`, pliki `web/portal/`) — logowanie Google na
  zaproszenie, kod logowania, programy do pobrania; dostępna także z portu publicznego.

## Powiązane

- [Konfiguracja, porty, ścieżki i logi](../operacje/konfiguracja-porty-i-sciezki.md)
- [Rozwiązywanie problemów](../operacje/rozwiazywanie-problemow.md)
- Dokumentacja użytkownika: `emustart/docs/wiki/EmuStart-Server.md`,
  `emustart/docs/wiki/Serwer-dla-Androida.md`
