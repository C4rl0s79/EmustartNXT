---
type: architektura
title: "Przegląd systemu: serwer, klienci i Lumen"
description: "Mapa całego systemu EmustartNXT: EmuStart Server, klient EmuStart na Windows, aplikacja Android i Lumen z silnikiem EmuStart — kto z kim rozmawia, przez jakie kanały i kto za co odpowiada."
tags: [architecture, overview, emustart, lumen, android, server]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-11T20:26:15.897Z
sources:
  - id: openwiki-source-39316019f7b366045ad545d4
    resource: repo://emustart/emustart/remote.py
  - id: openwiki-source-dc1c4e0ec4611cab17206a30
    resource: repo://emustart/server_main.py
  - id: openwiki-source-09a732d8bfcf69f944c1f1de
    resource: repo://lumen/docs/INTEGRATION.md
  - id: openwiki-source-9733b1fd9c40323c5ddf4535
    resource: repo://lumen/engine/engine_main.py
  - id: openwiki-source-af58033c474e8594fc1cde92
    resource: repo://lumen/engine/UPSTREAM.md
  - id: openwiki-source-2df32bc926e05bf8be1063ec
    resource: repo://lumen/src/main/emustart/engine.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-11T20:26:15.897Z" }
---

# Przegląd systemu: serwer, klienci i Lumen

EmustartNXT to jedno repozytorium dla całego systemu (`README.md`): `emustart/` (serwer, klient
Windows, aplikacja Android) i `lumen/` (launcher Electron z silnikiem EmuStart w `lumen/engine/`).
Historia obu dawnych repozytoriów (`C4rl0s79/EmuStart`, `C4rl0s79/Launcher`) jest zachowana.

## Komponenty i połączenia

```
                         ┌──────────────────────────────────────────┐
                         │ EmuStart Server  (emustart/server_main.py)│
                         │  EmuStartServer.exe --service             │
                         │  biblioteka, grafiki, konta, urządzenia,  │
                         │  emulatory, BIOS-y, zapisy, archiwum GOG  │
                         │  port 8740 (HTTP, tylko lokalnie dla /v1) │
                         │  port 8741 (HTTPS, API /v1 dla urządzeń)  │
                         └──────▲──────────────▲──────────────▲──────┘
                    HTTPS /v1   │              │              │  HTTPS /v1
          (przypięty certyfikat,│              │              │
           klucz urządzenia)    │              │              │
┌───────────────────────────────┴─┐  ┌─────────┴─────────┐  ┌─┴──────────────────────────────┐
│ Klient EmuStart (Windows)       │  │ Aplikacja Android │  │ Lumen (Electron)                │
│ emustart/main.py, pywebview     │  │ emustart/android  │  │ lumen/src/main …                │
│ UI: emustart/web (most pywebview│  │ WebView + most    │  │      │ IPC/HTTP 127.0.0.1        │
│ albo POST /api/<metoda>)        │  │ EmuAndroid        │  │      ▼  + token sesji            │
└─────────────────────────────────┘  └───────────────────┘  │ silnik EmuStart (bez okna)      │
                                                             │ lumen/engine/engine_main.py     │
                                                             └─────────────────────────────────┘
```

| Komponent | Punkt wejścia | Rozmawia z |
|---|---|---|
| EmuStart Server | `emustart/server_main.py` (`EmuStartServer.exe`) | klientami przez `/v1/…`; panel serwera przez `127.0.0.1` (`/admin/…`) |
| Klient Windows | `emustart/main.py` (`EmuStart.exe`) | serwerem przez `/v1/…`; własnym UI przez most pywebview |
| Aplikacja Android | `emustart/android/…/MainActivity.kt` | serwerem przez `/v1/…` (`Server.kt`); UI przez most `EmuAndroid` |
| Lumen | `lumen/src/main/index.ts` (`Lumen.exe`) | silnikiem przez `POST /api/<metoda>` na `127.0.0.1`; Steamem przez pliki i `steam://` |
| Silnik EmuStart | `lumen/engine/engine_main.py` (`EmuStartEngine.exe`) | serwerem przez `/v1/…` (jako urządzenie „Lumen”) |

Szczegóły: [EmuStart Server](serwer-emustart.md), [Klienci EmuStart](klienci-emustart.md),
[Lumen](lumen.md), [Most Lumen ↔ silnik](../integracje/most-lumen-silnik.md),
[API /v1](../przeplywy/api-v1.md).

## Jeden interfejs EmuStart, trzy mosty

Interfejs EmuStart (`emustart/web/`, czysty JS/HTML/CSS) jest ten sam w każdym kliencie; zmienia się
tylko most do kodu natywnego:

- Windows, okno — most pywebview do `Api` (`emustart/emustart/api.py`);
- Windows, `--browser` — `POST /api/<metoda>` do tego samego `Api`;
- Android — parametr `?android`, most `EmuAndroid` (Kotlin);
- Lumen — silnik wystawia `LumenApi` (rozszerzenie `Api`) przez `POST /api/<metoda>`; interfejs
  Lumena to jednak React (`lumen/src/renderer`), a nie `emustart/web` (`lumen/docs/INTEGRATION.md` §2:
  od Lumen 1.0.0 nie ma osobnego widoku z interfejsem EmuStart).

## Podział odpowiedzialności

- **Serwer** trzyma wszystko poza plikami gier w katalogu `server\` obok programu (konfiguracja,
  biblioteka, grafiki, konta) — `emustart/emustart/paths.py`.
- **Logika klienta EmuStart** (pobieranie gier, pamięć podręczna, emulatory, BIOS-y, uruchamianie,
  menu w grze, synchronizacja zapisów) jest w Pythonie: w kliencie Windows i — jako kopia — w silniku
  Lumena. Android ma własną implementację w Kotlinie.
- **Pliki lokalne czyta Lumen, nie silnik** (`README.md`, `lumen/docs/INTEGRATION.md`): grafiki gier,
  logotypy platform i wgrane grafiki czyta `lumen/src/main/localMedia.ts`; silnik służy do wymiany
  danych z serwerem i pobiera tylko brakujące pliki.

## Kopia silnika

`lumen/engine/` to kopia `emustart/` (dawniej `git subtree`, `lumen/engine/UPSTREAM.md`) z kilkoma
plikami własnymi Lumena. Obie kopie **nie są dziś identyczne**: `emustart/emustart/__init__.py` ma
wersję 0.63.5, a `lumen/engine/emustart/__init__.py` — 0.62.0; różnią się też m.in. `paths.py`
i `server.py` (zmiany na potrzeby silnika). Zob. [Most Lumen ↔ silnik](../integracje/most-lumen-silnik.md).

## Kierunek rozwoju

Według `README.md`: klient EmuStart ma zostać wchłonięty przez Lumena, a EmuStart ma pozostać
serwerem. Zmiana w jednym module (format danych, API `/v1`, zapisy) dotyczy wszystkich klientów —
zasada z `emustart/CLAUDE.md` („Jeden ekosystem”).
