---
type: architektura
title: "Klienci EmuStart: Windows i Android"
description: "Jak działa klient EmuStart na Windows (pywebview, Api, tryb --browser, kopia biblioteki z serwera) i aplikacja Android (WebView, most EmuAndroid, __emuPad) oraz jak oba łączą się z EmuStart Server."
tags: [emustart, client, windows, android, pywebview, webview]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T23:16:42.429Z
sources:
  - id: openwiki-source-3a86e937b3bdf9fc386b02ba
    resource: repo://emustart/android/app/build.gradle.kts
  - id: openwiki-source-4378881d4321ebe09d3b9f31
    resource: repo://emustart/android/app/src/main/java/io/github/c4rl0s79/emustart/MainActivity.kt
  - id: openwiki-source-41d978605caa219b235d17c2
    resource: repo://emustart/android/app/src/main/java/io/github/c4rl0s79/emustart/Server.kt
  - id: openwiki-source-0d61759cab48093068c68838
    resource: repo://emustart/emustart/dosmidi.py
  - id: openwiki-source-1f1d4f3bbb924e004b121a5b
    resource: repo://emustart/emustart/goglib.py
  - id: openwiki-source-993f7cca8bd66ab8c43f8fb8
    resource: repo://emustart/emustart/launcher.py
  - id: openwiki-source-6df1c98092383c519f5bcd85
    resource: repo://emustart/emustart/libsync.py
  - id: openwiki-source-c689b27cb9963760bf507303
    resource: repo://emustart/emustart/paths.py
  - id: openwiki-source-a124d623671267edfd450054
    resource: repo://emustart/emustart/server.py
  - id: openwiki-source-8e86ad247bda3ba0a75ffbac
    resource: repo://emustart/emustart/unelevated.py
  - id: openwiki-source-2adf1fd1ef5a15de936149b6
    resource: repo://emustart/main.py
  - id: openwiki-source-f0e926c2a9db5ea4c80d614b
    resource: repo://emustart/web/app.js
generated: { by: "claude-code", at: "2026-11-17T00:45:56.894Z" }
---

# Klienci EmuStart: Windows i Android

Oba klienty pokazują **ten sam interfejs** — HTML/JS/CSS z `emustart/web/` — i rozmawiają z tym samym
serwerem przez API `/v1/…` (zob. [API /v1](../przeplywy/api-v1.md)). Różnią się warstwą natywną:
na Windows to Python (`emustart/emustart/api.py`) w oknie pywebview, na Androidzie — Kotlin
(`emustart/android/…/emustart/*.kt`) w WebView. Trzeci „klient” tego samego interfejsu i logiki to
silnik w Lumenie — opisany w [Moście Lumen ↔ silnik](../integracje/most-lumen-silnik.md).

## Klient Windows (`emustart/main.py`)

### Punkt wejścia i tryby

`emustart/main.py` (docstring na początku pliku):

| Polecenie | Działanie |
|---|---|
| `python main.py` | pełny ekran (wg ustawienia `fullscreen` w `config.json`, domyślnie tak) |
| `python main.py --window` | w oknie |
| `python main.py --debug` | w oknie + DevTools |
| `python main.py --browser` | bez okna: serwer UI na `http://127.0.0.1:8765/index.html?dev` |
| `--sdl-probe=… --sdl-out=…` | krótki proces pomocniczy do numerów padów SDL (`emustart/sdlpads.py`) |

Przebieg `main()`:

1. `boot.setup_logging("emustart.log", …)` i `boot.log_versions()` — log w `logs/` obok programu.
2. Jeśli w katalogu programu działa układ serwera (`paths.server_layout_active()` — jest
   `server/config.json`, a nie ma `config.json`), klient przełącza ścieżki na dane serwera
   (`paths.use_server_layout`) — EmuStart uruchomiony na komputerze z serwerem pracuje na jego danych.
3. Tworzy `Api()` (`emustart/emustart/api.py`) i lokalny serwer HTTP interfejsu
   (`server.start()` — domyślnie `127.0.0.1`, losowy port).
4. W trybie okna: `webview.create_window("EmuStart", f"{base}/index.html", js_api=api, …)`;
   interfejs woła metody `Api` mostem pywebview.
5. W trybie `--browser` interfejs woła te same metody przez `POST /api/<metoda>` (lista argumentów
   JSON w treści). Serwer HTTP przyjmuje to tylko z tego komputera, z właściwym nagłówkiem `Host`
   i nagłówkiem `X-EmuStart: 1` (`emustart/emustart/server.py`, `_local_ui` i `do_POST`).

### Klasa `Api`

`Api` (`emustart/emustart/api.py`) to cała logika klienta wystawiona interfejsowi: konfiguracja,
skanowanie, uruchamianie gier (`launcher`), profile graczy, pady (`uipad`, gdy obsługa padów jest
w Pythonie), grafiki (`art.Fetcher`), WinFsp do grania w trakcie pobierania (`vfs`). Przy starcie
m.in. wysyła zaległe zapisy profili na serwer w tle (`launcher.start_post(… profiles.push_all …)`).

### Komputer bez folderów z grami — kopia biblioteki z serwera

`emustart/emustart/libsync.py` opisuje „cienkiego klienta”: komputer zalogowany do serwera, bez
własnych folderów z grami (`rom_roots`), niczego nie skanuje:

- biblioteka z `GET /v1/library` (systemy z wersją = czas skanu na serwerze) i
  `GET /v1/library?es=…` (gry systemu) — pobierane tylko systemy zmienione od ostatniej synchronizacji;
- gry przy uruchomieniu pobierane z serwera (`netsrc`), z pamięcią podręczną gier;
- grafiki — lokalny serwer interfejsu dociąga brakujący plik z serwera i zapamiętuje go;
- emulator dla systemu — zalecany przez serwer (ten sam emulator/rdzeń co u administratora).

Gry z biblioteki serwera mają w lokalnej bazie `src = "serwer"` (`libsync.SERVER_SRC`).

### Połączenie z serwerem

Logowanie urządzenia (link/QR z panelu serwera albo konto + hasło) i podpisywanie zapytań kluczem
urządzenia opisuje [API /v1](../przeplywy/api-v1.md). Klient zapamiętuje adres serwera i jego
odcisk certyfikatu w `config.json`; port domyślny serwera to `8740` (`remote.DEFAULT_PORT`), a API
urządzeń działa tylko połączeniem szyfrowanym — zob.
[Konfiguracja, porty, ścieżki i logi](../operacje/konfiguracja-porty-i-sciezki.md).

> Uwaga: docstring `emustart/emustart/remote.py` wciąż mówi o udostępnianiu API „przez HTTP
> (Tailscale)”, ale od wersji 0.43 `/v1` przyjmuje zwykłe HTTP wyłącznie z tego samego komputera
> (`server.py`, `_v1_ok`). Aktualny jest kod.

### Uruchamianie gier bez uprawnień administratora

Gry i emulatory startują przez `unelevated.popen` (`emustart/emustart/unelevated.py`), a nie wprost
`subprocess.Popen` (`launcher.py` przy starcie emulatora, `gogfinal.py` przy grach GOG). Gdy proces EmuStart ma
uprawnienia administratora — co dotyczy silnika w Lumenie, który od 1.0.59 startuje jako administrator — program
gracza dostaje token powłoki zalogowanego użytkownika (`GetShellWindow` → `OpenProcessToken` → `DuplicateTokenEx` →
`CreateProcessWithTokenW`). Bez uprawnień (zwykły klient EmuStart, Lumen ze źródeł) to zwykłe `subprocess.Popen`.
Gdy uruchomienie z tokenem się nie uda, program startuje normalnie, a log zapisuje ostrzeżenie — gra nie zostaje
bez startu.

### MIDI w grach DOSBox (MT-32 / SC-55)

`emustart/emustart/dosmidi.py` wybiera wyjście MIDI dla gier DOSBox per gra: tryby `auto`, `mt32`, `sc55`,
`default`. Pliki gry zostają bez zmian — przy starcie DOSBox dostaje dodatkowy plik `-conf` w podfolderze gry
`.emustart-midi` z `mididevice=win32` i `midiconfig=<numer portu>`; ostatni `-conf` wygrywa. Porty wybiera się
po nazwie (`config.json`: `midi_mt32_port`, `midi_sc55_port`), a numer jest liczony przy każdym starcie, bo
Windows zmienia numery po odłączeniu urządzeń USB. Tryb `auto` korzysta z baz `midigames.py` (gry z MT-32 oraz
gry, które fałszywie deklarują MT-32 — generator `emustart/tools/build_midi_games.py`).

Program grający port (np. Munt `mt32emu-qt.exe` dla MT-32 albo program wskazany w `midi_mt32_app` /
`midi_sc55_app`; `-` = nic) uruchamia `ensure_companion` tuż przed startem gry, gdy jeszcze nie działa:
bez uprawnień administratora, zminimalizowany i bez fokusu. `warmup` robi to samo przy starcie Lumena. Wywołania
z gry GOG: `goglib.py` (start gry z DOSBoxem), ustawienia: metody MIDI w `api.py`.

## Aplikacja Android (`emustart/android/`)

### Budowa interfejsu

- Wersja aplikacji (`versionName`) jest czytana z `emustart/emustart/__init__.py`
  (`android/app/build.gradle.kts`) — APK i klient Windows mają ten sam numer wersji.
- Przy budowaniu katalog `emustart/web/` jest kopiowany do zasobów aplikacji
  (`generated/webassets/web`), bez `web/portal/**` (strona serwera — nie w aplikacji).

### `MainActivity` i most `EmuAndroid`

`MainActivity.kt`:

- tworzy `WebView` z włączonym JavaScriptem i ładuje `http://emustart.local/index.html?android`;
- adres `emustart.local` **nigdy nie idzie do sieci**: `shouldInterceptRequest` serwuje pliki
  z zasobów aplikacji, a ścieżki `/remote/…` (grafiki z serwera) przez most — tak, by obca treść
  z sieci lokalnej nie dostała dostępu do mostu;
- rejestruje most JavaScript `EmuAndroid` (`Bridge.kt`) — odpowiednik metod `Api` z Windows;
- przy starcie prosi o uprawnienie „dostęp do wszystkich plików” (gry w publicznym folderze, żeby
  emulatory mogły je czytać);
- zdarzenia pada przekazuje do interfejsu wywołaniem `window.__emuPad(akcja, puszczenie)`;
  `web/app.js` rejestruje `window.__emuPad` jako źródło `"apk"`. To **inna ścieżka** niż pad
  w oknie Windows — zmiany obsługi pada trzeba sprawdzać osobno dla APK
  (zasada z `emustart/CLAUDE.md`).

Pozostałe pliki Kotlin dzielą się zadaniami: `Server.kt` (adres serwera, token, zapytania),
`DeviceKey.kt` (klucz urządzenia), `Downloader.kt`/`Cache.kt` (pobieranie i pamięć gier),
`Emulators.kt`/`Installer.kt`/`EmuProfile.kt`/`Bios.kt` (emulatory i BIOS-y), `SaveSync.kt`/`Saves.kt`
(zapisy), `Prefs.kt` (ustawienia).

### Wybór adresu serwera na Androidzie

`Server.kt` łączy adres wpisany przez użytkownika z adresami podanymi przez serwer
(`prefs.serverEndpoints`) i:

- odrzuca adresy inne niż `https://` (od 0.43), a dla własnego certyfikatu serwera wymaga odcisku
  (`prefs.serverFp`); tunel (np. Cloudflare) jest sprawdzany zwykłym trybem CA;
- porządkuje kandydatów: sieć lokalna → Tailscale (`100.64.0.0/10`) → publiczny → tunel;
- sprawdza je równolegle zapytaniem `POST /v1/auth/challenge` z pustym `device` (odpowiedź
  serwera EmuStart zawiera pole `reason`) i wybiera najszybszy;
- wynik pamięta 5 minut albo do błędu połączenia (`baseUrl`, `forgetBase`).

## Powiązane

- [EmuStart Server](serwer-emustart.md)
- [API /v1](../przeplywy/api-v1.md)
- [Przegląd systemu](przeglad-systemu.md)
- Dokumentacja użytkownika: `emustart/docs/wiki/Aplikacja-na-Androida.md`,
  `emustart/docs/wiki/Instalacja-i-pierwsze-uruchomienie.md`
