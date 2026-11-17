---
type: operacje
title: "Konfiguracja, porty, ścieżki i logi"
description: "Gdzie EmuStart (klient i serwer), silnik w Lumenie i Lumen trzymają konfigurację i dane, jakich portów używają, jakie zmienne środowiskowe rozpoznają i gdzie piszą logi."
tags: [configuration, ports, paths, logs, environment, emustart, lumen]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T23:16:42.429Z
sources:
  - id: openwiki-source-945ea3efa39a975f0dd7693f
    resource: repo://emustart/emustart/api.py
  - id: openwiki-source-c87f2b14a2f95cf5b1432f64
    resource: repo://emustart/emustart/boot.py
  - id: openwiki-source-379cdd2e2adfd1d3ac03a5f6
    resource: repo://emustart/emustart/config.py
  - id: openwiki-source-0d61759cab48093068c68838
    resource: repo://emustart/emustart/dosmidi.py
  - id: openwiki-source-c689b27cb9963760bf507303
    resource: repo://emustart/emustart/paths.py
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
  - id: openwiki-source-c87f0e16b4cde66a04ef3608
    resource: repo://lumen/src/main/library/service.ts
  - id: openwiki-source-bacca483d37d13cf87b2b3d3
    resource: repo://lumen/src/main/logger.ts
  - id: openwiki-source-f7b15250e564dc6e998ff8d2
    resource: repo://lumen/src/main/net.ts
  - id: openwiki-source-d80b43594aac1c5181443946
    resource: repo://lumen/src/main/store/settings.ts
generated: { by: "claude-code", at: "2026-11-17T19:02:08.485Z" }
---

# Konfiguracja, porty, ścieżki i logi

## Katalogi danych

### Klient EmuStart (Windows) — `emustart/emustart/paths.py`

Wszystko leży **obok programu** (`paths.APP` = folder exe albo katalog `emustart/` przy uruchomieniu
ze źródeł) — instalacja jest przenośna:

| Ścieżka | Zawartość |
|---|---|
| `config.json` | ustawienia (`config.py`) |
| `data\library.sqlite` | biblioteka gier |
| `data\media\` | grafiki |
| `logs\` | logi |
| `cache\` | pamięć podręczna gier (gdy `cache_dir` puste) |
| `Emulatory\` | domyślny folder emulatorów (gdy `emu_root` puste; nie dla silnika Lumena ani serwera) |
| `%TEMP%\emustart\run\` | gry rozpakowane na czas jednej sesji |

### EmuStart Server

Ten sam program przełącza się na **katalog serwera** `server\` obok exe (`paths.use_server_layout`):
`server\config.json`, `server\library.sqlite`, `server\media\` oraz konta, profile i certyfikat.
Kopia katalogu programu przenosi serwer (klucz TLS jest jednak chroniony DPAPI komputera — do
przeniesienia służy panel, zob. [EmuStart Server](../architektura/serwer-emustart.md)).
Gdy w katalogu jest `server\config.json`, a nie ma `config.json`, także zwykły klient uruchomiony
z tego katalogu pracuje na danych serwera (`server_layout_active`).

### Silnik w Lumenie

Katalog danych silnika wskazuje zmienna `EMUSTART_HOME` ustawiana przez Lumena — domyślnie
`<LumenData>\emustart` albo ustawienie `emustartHome` (`lumen/src/main/index.ts`,
`lumen/engine/engine_main.py`).

### Lumen — `lumen/src/main/dataDir.ts`

`LumenData\` obok `Lumen.exe` (wersja zainstalowana i przenośna), `%APPDATA%\Lumen` przy
uruchomieniu ze źródeł albo gdy folder programu jest tylko do odczytu, lub katalog z
`LUMEN_USER_DATA`. Szczegóły: [Lumen](../architektura/lumen.md#dane-lumendata).

## `config.json`

`config.load()` (`emustart/emustart/config.py`) łączy `DEFAULTS` z plikiem. Uszkodzony plik nie jest
nadpisywany po cichu — zostaje przeniesiony do `config.json.broken`, a program startuje z domyślnymi
ustawieniami. Wybrane klucze:

| Klucz | Domyślnie | Znaczenie |
|---|---|---|
| `rom_roots` | `[]` | foldery z grami (kolejność = pierwszeństwo przy duplikatach) |
| `emu_root` | `""` | folder emulatorów |
| `cache_dir`, `cache_recent`, `small_game_mb` | `""`, 10, 64 | pamięć podręczna gier |
| `fullscreen` | `true` | klient startuje na pełnym ekranie |
| `bios_dir` | `""` | BIOS-y (serwer: dla urządzeń; PC: kopiowane do RetroArcha) |
| `profiles_nas` | `""` | serwer: folder profili graczy (`""` → `<serwer>\profiles`) |
| `backup_dir`, `backup_auto`, `backup_keep` | `""`, `true`, 14 | serwer: kopie kont |
| `systems`, `system_merge` | `{}` | ustawienia per system / scalanie platform |
| `server_port` | brak → 8740 | serwer: port zwykły (`remote.DEFAULT_PORT`) |
| `server_tls_port` | brak → port + 1 | serwer: port szyfrowany |
| `server_public`, `server_public_port` | wył., 8742 | serwer: dostęp z internetu (`public.py`) |
| `server_tunnel_url` | brak | serwer: adres tunelu podawany klientom |
| `gog_depots_dir` | brak | serwer: archiwum depotów GOG |
| `server_url`, `server_fp`, `server_account`, `server_key`, `server_keyname`, `server_keykind` | — | klient: zalogowanie do serwera (usuwane przy wylogowaniu, `api.py`) |
| `midi_mt32_port`, `midi_sc55_port` | zgadywane po nazwie | gry DOSBox: porty MIDI po nazwie; `-` = urządzenie wyłączone (`dosmidi.py`) |
| `midi_mt32_app`, `midi_sc55_app` | `""` (MT-32: Munt) | program grający port, uruchamiany przed grą i przy starcie Lumena; `-` = nic |

Klucze źródeł grafik (`art_keys`) i klucz urządzenia to dane poufne — nie kopiuj `config.json`
do zgłoszeń błędów.

## Porty

| Port | Kto | Adres | Uwagi |
|---|---|---|---|
| 8740 (`server_port`) | EmuStart Server | `0.0.0.0` | `/v1` tylko z tego komputera; panel `/admin` tylko lokalnie |
| 8741 (`server_tls_port`, port + 1) | EmuStart Server | `0.0.0.0` | HTTPS z przypiętym certyfikatem — API `/v1` dla urządzeń |
| 8742 (`server_public_port`) | EmuStart Server | `0.0.0.0` | tylko przy dostępie z internetu (UPnP) |
| losowy | klient EmuStart (okno) | `127.0.0.1` | serwer interfejsu (`server.start()`) |
| 8765 | klient EmuStart `--browser` | `127.0.0.1` | interfejs w przeglądarce |
| losowy | silnik w Lumenie | `127.0.0.1` | podawany Lumenowi w handshake'u na stdout |

`--install` dodaje reguły zapory „EmuStart Server” (port zwykły) i „EmuStart Server (szyfrowany)”
(port + 1); serwer przy starcie sam pilnuje reguły dla portu szyfrowanego (`remote.ensure_firewall`).

## Zmienne środowiskowe

| Zmienna | Gdzie | Znaczenie |
|---|---|---|
| `EMUSTART_HOME` | silnik | katalog danych silnika (ustawia Lumen) |
| `LUMEN_ENGINE_TOKEN` | silnik | token sesji wymagany przez `/api` (`X-Lumen-Token`) |
| `LUMEN_WINDOW_TITLE` | silnik | tytuł okna Lumena |
| `LUMEN_PYTHON` | Lumen | Python do uruchamiania silnika ze źródeł |
| `LUMEN_USER_DATA` | Lumen | osobny katalog danych (testy, rozwój) |
| `LUMEN_DRY_RUN=1` | Lumen | blokuje uruchamianie gier i konfigurację emulatorów |
| `LUMEN_NO_PAD=1` | Lumen | bez obsługi padów w procesie głównym (testy) |
| `LUMEN_PAD_DEBUG=1` | Lumen | szczegóły padów Raw HID w logu (`input/rawhid.ts`) |
| `LUMEN_DEBUG` | Lumen | wpisy info logu także na konsolę (`logger.ts`) |
| `LUMEN_OFFLINE=1` | Lumen | symulacja braku sieci (`net.ts`) |
| `LUMEN_STEAM_PATH` | Lumen | folder Steama zamiast wykrytego; `none` — komputer bez Steama (`library/service.ts`) |
| `LUMEN_UPDATE_FEED` | Lumen | lokalne źródło wydań zamiast GitHuba (rozwój, testy aktualizatora) |
| `PORTABLE_EXECUTABLE_DIR` | Lumen | ustawia electron-builder w wersji przenośnej |
| `LUMEN_SIGNING_KEY_FILE` | `lumen/scripts/sign-release.mjs` | klucz do podpisu wydań Lumena |
| `EMUSTART_SIGNING_KEY` | CI (`windows.yml`) | klucz do podpisu wydań EmuStart |

## Logi

| Program | Plik | Rotacja |
|---|---|---|
| klient EmuStart | `logs\emustart.log` obok programu | 2 MB × 3 kopie (`boot.setup_logging`) |
| EmuStart Server (`--service`) | `logs\emustart.log` obok `EmuStartServer.exe` | jw. |
| panel serwera, `--login-link` | `%LOCALAPPDATA%\EmuStart Server\logs\panel.log` (`boot.user_logs`) | jw. |
| silnik w Lumenie | `logs\emustart.log` w katalogu `EMUSTART_HOME` | jw. |
| Lumen | `<LumenData>\logs\lumen.log`, poprzedni → `lumen.old.log` (`logger.ts`) | powyżej 2 MB |
| aktualizacja Lumena | `<LumenData>\logs\update.log` | — |

Lumen maskuje w swoim logu sekrety, m.in. token sesji silnika i tokeny Xbox (`registerSecret`). Pomocne
znaczniki w `lumen.log`: `[hang]` (okno nie odpowiada / znów odpowiada, pamięć procesów co 10 min —
`hangWatch.ts`), `[perf]` (zacięcia interfejsu i procesu głównego), `[deck]`, `[xbox]`, `[app]` (m.in. proces,
który uruchomił Lumena). Serwer zapisuje pamięć procesu co godzinę (`memwatch.py`).

## Ustawienia Lumena i pliki pomocnicze

- `<LumenData>\settings.json` (`store/settings.ts`, sprawdzane przy wczytaniu): m.in. tryb startu, motyw TV
  (`tvTheme`), układ listy TV dla grup (`tvLayouts`), aplikacja Azure dla Xbox (`xboxClientId`), katalog Game Pass
  (`xboxGamePass`), folder i języki gier GOG, Deck; sekrety (klucze API, token Xbox) — w `secrets.json`,
  szyfrowane, gdy Windows na to pozwala.
- `%LOCALAPPDATA%\Lumen` — pliki wykrywania drugiej kopii Lumena (`running.json`, `second-instance.json`,
  `second-instance-<PID>.answer`; `instances.ts`).
- Autostart wersji zainstalowanej: zadanie Harmonogramu z najwyższymi uprawnieniami (`elevation.ts`).

## Powiązane

- [EmuStart Server](../architektura/serwer-emustart.md)
- [Rozwiązywanie problemów](rozwiazywanie-problemow.md)
- Dokumentacja użytkownika: `emustart/docs/wiki/Pliki-i-dane.md`
