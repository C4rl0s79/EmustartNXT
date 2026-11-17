---
type: operacje
title: "Rozwiązywanie problemów"
description: "Diagnostyka typowych problemów systemu EmustartNXT: urządzenie nie widzi serwera (zapora, LAN, Tailscale, HTTPS), odpowiedzi 403/404 z serwera, logi, panel serwera, silnik EmuStart w Lumenie, który nie startuje, oraz problemy opisane w dokumentacji użytkownika."
tags: [troubleshooting, network, firewall, logs, engine, server]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T23:16:42.429Z
sources:
  - id: openwiki-source-b838c72bfa4df685685e38e9
    resource: repo://emustart/emustart/gogfinal.py
  - id: openwiki-source-269bd79d82cebe60040832db
    resource: repo://emustart/emustart/hotkey.py
  - id: openwiki-source-39316019f7b366045ad545d4
    resource: repo://emustart/emustart/remote.py
  - id: openwiki-source-a124d623671267edfd450054
    resource: repo://emustart/emustart/server.py
  - id: openwiki-source-8e86ad247bda3ba0a75ffbac
    resource: repo://emustart/emustart/unelevated.py
  - id: openwiki-source-dc1c4e0ec4611cab17206a30
    resource: repo://emustart/server_main.py
  - id: openwiki-source-9733b1fd9c40323c5ddf4535
    resource: repo://lumen/engine/engine_main.py
  - id: openwiki-source-2df32bc926e05bf8be1063ec
    resource: repo://lumen/src/main/emustart/engine.ts
  - id: openwiki-source-fbeb3e45dda5bb14b4d19bef
    resource: repo://lumen/src/main/hangWatch.ts
  - id: openwiki-source-09cc82d5a5407fc108b34403
    resource: repo://lumen/src/main/xbox/account.ts
generated: { by: "claude-code", at: "2026-11-17T21:56:42.171Z" }
---

# Rozwiązywanie problemów

Zawsze zaczynaj od logów — ich położenie: [Konfiguracja, porty, ścieżki i logi](konfiguracja-porty-i-sciezki.md#logi).
Problemy z padami, grami, emulatorami, RetroAchievements i grafikami opisuje dokumentacja
użytkownika: `emustart/docs/wiki/Rozwiązywanie-problemów.md`. Tu — problemy z komunikacją
i z uruchamianiem komponentów, ustalone na podstawie kodu.

## Urządzenie nie łączy się z serwerem

Sprawdzaj po kolei:

1. **Czy serwer działa.** Panel serwera (`EmuStartServer.exe`) łączy się z nim przez `127.0.0.1`
   i próbuje go uruchomić; komunikat „Serwer EmuStart nie odpowiada na porcie … i nie udało się go
   uruchomić” odsyła do `logs\emustart.log` obok programu (`emustart/server_main.py`,
   `_server_panel`).
2. **Port szyfrowany.** Urządzenia łączą się z API `/v1` wyłącznie przez HTTPS — domyślnie port
   **8741** (zwykły + 1). Zwykły port 8740 przyjmuje `/v1` tylko z komputera serwera i każde inne
   zapytanie `/v1` dostaje **403** (`emustart/emustart/server.py`, `_v1_ok`; od wersji 0.43).
   Port szyfrowany nie otworzy się, gdy serwer działa ze źródeł bez biblioteki `cryptography`
   (`emustart/emustart/tls.py`) — w logu: wyjątek „port szyfrowany”.
3. **Zapora Windows.** `EmuStartServer.exe --install` (jako administrator) dodaje reguły „EmuStart
   Server” i „EmuStart Server (szyfrowany)”; serwer na koncie SYSTEM sam dopisuje regułę dla portu
   szyfrowanego przy starcie, a bez uprawnień zostawia tylko wpis „zapora: …” w logu
   (`emustart/emustart/remote.py`, `install_autostart`, `ensure_firewall`). Po zmianie
   `server_port`/`server_tls_port` sprawdź, czy reguły wskazują nowe porty.
4. **Sieć.** Porty zwykły i szyfrowany przyjmują tylko adresy prywatne (LAN), loopback,
   link-local i Tailscale (`100.64.0.0/10`). Zapytanie z adresu publicznego dostaje 403, a w logu
   serwera pojawia się (raz na godzinę na port) ostrzeżenie „port …: zapytanie z internetu (…)
   odrzucone — router przekierowuje tu ruch z zewnątrz”. Dostęp z internetu działa wyłącznie przez
   port publiczny (panel → „Dostęp z internetu”, domyślnie 8742) albo tunel.
5. **Odcisk certyfikatu.** Klienci przypinają certyfikat serwera odciskiem SHA-256 z kodu QR /
   logowania. Nowy certyfikat (np. serwer postawiony od zera zamiast przeniesienia przez panel →
   „Przygotuj przeniesienie”) oznacza konieczność ponownego zalogowania urządzeń
   (`emustart/emustart/tls.py`).
6. **Wybór adresu na Androidzie.** Aplikacja bierze tylko adresy `https://` (własny certyfikat —
   tylko z zapamiętanym odciskiem), sprawdza je kolejno LAN → Tailscale → publiczny → tunel
   i pamięta wybór 5 minut albo do błędu (`emustart/android/…/Server.kt`).

## Port publiczny (internet)

- Za NAT-em operatora (CGNAT) port publiczny nie ma sensu — serwer to wykrywa i pokazuje w panelu
  (`emustart/emustart/public.py`).
- Seria 20 błędnych kluczy w 10 minut z jednego adresu blokuje ten adres na 30 minut; najwyżej 32
  połączenia naraz z jednego adresu.
- Bez tokenu urządzenia port publiczny przyjmuje tylko logowanie (`/v1/enroll/request`,
  `/v1/enroll/poll`, `/v1/auth/challenge`, `/v1/auth/token`) i stronę serwera.

## 403 / 404 przy wywołaniach lokalnych

- `POST /api/<metoda>` (tryb `--browser`, panel) wymaga połączenia z `127.0.0.1`, nagłówka
  `Host: 127.0.0.1:<port>` lub `localhost:<port>` oraz `X-EmuStart: 1` — w innym razie 403.
  Nieznana metoda albo nazwa zaczynająca się od `_` → 404 (`server.py`, `do_POST`).
- `/admin/…` (panel serwera) działa tylko z komputera serwera.
- Odpowiedź „połączenie przerwane” zamiast kodu błędu przy dużym zapytaniu: serwer doczytuje do 1 MB
  treści przed odmową; większą treść kończy zamknięciem połączenia (`refuse`).

## Panel serwera i uprawnienia

- Serwer z zadania Harmonogramu działa jako **SYSTEM** — nie zna liter dysków sieciowych
  użytkownika; panel zamienia wybrane foldery na ścieżki UNC (`srvconfig.unc`).
- Po `--install` folder programu jest tylko do odczytu dla zwykłych użytkowników, dlatego panel
  loguje do `%LOCALAPPDATA%\EmuStart Server\logs\panel.log`.

## Silnik EmuStart w Lumenie nie startuje

Stan i komunikaty pochodzą z `lumen/src/main/emustart/engine.ts`:

| Komunikat / objaw | Przyczyna i rada |
|---|---|
| „Nie znaleziono silnika EmuStart (engine/engine_main.py ani EmuStartEngine.exe).” | brak `resources\engine\EmuStartEngine\EmuStartEngine.exe` w wersji zbudowanej i brak `engine/engine_main.py`; przebuduj (`npm run dist`) |
| „EmuStart (…) korzysta już z folderu danych …” | samodzielny EmuStart działa z tego samego folderu danych — zamknij go albo zmień folder w Ustawieniach |
| „Brakuje modułów Pythona dla EmuStart (…)” | uruchomienie ze źródeł bez zależności: `pip install -r engine/requirements.txt` |
| „Silnik EmuStart zakończył pracę (kod …)” | sprawdź `logs\emustart.log` w katalogu danych silnika i `logs\lumen.log`; Lumen próbuje do 3 restartów |
| brak gotowości przez 45 s | silnik nie wypisał handshake'u — proces jest zabijany; zwykle błąd startu Pythona (log) |
| „Tryb testowy (LUMEN_DRY_RUN=1)…” | ustawiona zmienna `LUMEN_DRY_RUN=1` blokuje uruchamianie gier |

Ze źródeł silnik startuje Pythonem z Ustawień Lumena, z `LUMEN_PYTHON` albo przez `py -3`.
Diagnostyka padów bez uruchamiania Lumena: `engine_main.py --diag-controllers [--json]`
(`lumen/engine/engine_main.py`).

## Okno EmuStart się nie otwiera

Według dokumentacji użytkownika: pliki zablokowane po rozpakowaniu ZIP-a (`Unblock-File`), brak
.NET Framework 4.8 albo WebView2 Runtime — szczegóły w `emustart/docs/wiki/Rozwiązywanie-problemów.md`.

## Menu w grze się nie otwiera

Skrót to **przytrzymany Select + A** — od EmuStart 0.62.0 skróty pada w grze używają Select zamiast LB
we wszystkich emulatorach (`emustart/emustart/hotkey.py`, `emustart/CHANGELOG.md` → 0.62.0). Komentarz
„LB + A” w `lumen/engine/engine_main.py` pochodzi sprzed tej zmiany. Skróty nie działają przy wyłączonej
obsłudze padów (`--pady=brak`).

## Lumen: logowanie do Xbox się nie udaje

- Komunikat z przyczyną po polsku (konto bez profilu Xbox, konto dziecka, warunki, kraj, weryfikacja wieku) to kod
  odmowy Xbox Live (`x-err` / `XErr`) przetłumaczony przez `xerrText` (`lumen/src/main/xbox/account.ts`); poprawia
  się go na koncie Microsoft / xbox.com, nie w Lumenie.
- Własna aplikacja Azure bez adresu przekierowania `https://login.microsoftonline.com/common/oauth2/nativeclient`
  (platforma „Aplikacje mobilne i klasyczne”) kończy logowanie błędem dopiero po wpisaniu hasła — sama strona
  logowania tego nie sprawdza (`emustart/CHANGELOG.md`, etap 19e). Pusty identyfikator w Ustawienia → Zaawansowane
  przywraca domyślną aplikację „Lumen Launcher”.
- Gry kupione, ale nigdy nieuruchomione, nie pojawiają się z konta — Lumen czyta historię tytułów (titlehub).
  Zob. [Xbox i Microsoft Store](../integracje/xbox-microsoft-store.md).

## Lumen: druga kopia, uprawnienia, zawieszenia

- **Okno wyboru przy starcie** — działa już inny Lumen (inna wersja albo folder); nowa kopia przekazała prośbę przez
  pliki w `%LOCALAPPDATA%\Lumen` (`instances.ts`). Osobny profil `LUMEN_USER_DATA` pomija ten mechanizm.
- **Gra startuje z uprawnieniami administratora** — w logu silnika ostrzeżenie „nie uruchomiono bez uprawnień
  administratora …”: uruchomienie z tokenem powłoki się nie udało i `unelevated.popen` uruchomił program zwykle
  (`emustart/emustart/unelevated.py`).
- **Okno albo Deck przestaje odpowiadać** — `lumen.log` zawiera wpisy `[hang]` („nie odpowiada”, „znów odpowiada”
  z czasem, awarie procesów, pamięć procesów co 10 min — `hangWatch.ts`) i `[perf]` (zacięcia); to pierwsze miejsce
  do sprawdzenia.

## Gry DOSBox bez muzyki MT-32 / SC-55

- Port MIDI wybiera się po nazwie (Opcje gry → MIDI → „Wyjścia MIDI…”); gdy żaden program nie gra tego portu
  (np. loopMIDI bez Munt), gra jest cicha. Silnik uruchamia program grający port przed grą (Munt `mt32emu-qt.exe`
  dla MT-32 albo program z `midi_mt32_app` / `midi_sc55_app`) tylko wtedy, gdy go znajdzie (`dosmidi.companion`).
- Urządzenie w samej grze (SOUND.CFG, SETUP) ustawia się jej programem konfiguracji — EmuStart ustawia tylko port
  DOSBoxa. Diagnostyka: „Uruchom… → Uruchom z diagnostyką” zostawia komunikat błędu gry na ekranie.

## Powiązane

- [Konfiguracja, porty, ścieżki i logi](konfiguracja-porty-i-sciezki.md)
- [API /v1](../przeplywy/api-v1.md)
- [EmuStart Server](../architektura/serwer-emustart.md)
- [Most Lumen ↔ silnik](../integracje/most-lumen-silnik.md)
- [Xbox i Microsoft Store](../integracje/xbox-microsoft-store.md)
- [Gry GOG z archiwum serwera](../przeplywy/gry-gog.md)
