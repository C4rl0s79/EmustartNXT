---
type: przewodnik
title: "Szybki start — mapa wiki EmustartNXT"
description: "Punkt wejścia do wiki EmustartNXT: czym jest system EmuStart + Lumen, jak go uruchomić ze źródeł i która strona odpowiada na które pytanie."
tags: [quickstart, overview, navigation, emustart, lumen]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T00:45:56.894Z
sources:
  - id: openwiki-source-405b8b710d216259d5c49bbb
    resource: repo://.github/workflows/lumen.yml
  - id: openwiki-source-c50d065f5235e5ffd41ee89b
    resource: repo://.github/workflows/windows.yml
  - id: openwiki-source-f2d8491c8ff6aa07a5172ec8
    resource: repo://lumen/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-17T00:45:56.894Z" }
---

# Szybki start — mapa wiki EmustartNXT

**EmustartNXT** to jedno repozytorium systemu do grania na emulowanych platformach i w gry Steam/GOG
(`README.md`):

- `emustart/` — **EmuStart**: serwer gier (`server_main.py` → `EmuStartServer.exe`), klient Windows
  (`main.py` → `EmuStart.exe`, interfejs `web/`), aplikacja Android (`android/`), testy (`tests/`),
  dokumentacja użytkownika (`docs/wiki/`);
- `lumen/` — **Lumen**: launcher Electron + React z silnikiem EmuStart bez okna (`lumen/engine/`).

Kierunek: klient EmuStart przechodzi do Lumena, EmuStart zostaje serwerem.

## Uruchomienie ze źródeł (skrót)

| Komponent | Polecenie (katalog) | Wymagania |
|---|---|---|
| EmuStart Server | `python server_main.py --service` (`emustart/`) | Python 3.14, `pip install -r requirements.txt` |
| Klient EmuStart | `python main.py --window` albo `--browser` (`emustart/`) | jw. |
| Lumen | `npm install`, potem `npm run dev` (`lumen/`) | Node.js 22+, Python 3.12+ z `engine/requirements.txt` |
| Android | `gradle -p android assembleRelease` (`emustart/`) | JDK 17, Gradle 8.11.1 (jak w CI) |

Szczegóły i wydania: [Budowa, testy i wydania](operacje/budowa-testy-i-wydania.md). Oba programy wydaje
GitHub Actions: EmuStart przy tagu `emustart-v…` (`.github/workflows/windows.yml`), Lumen przy tagu
`lumen-v…` (`.github/workflows/lumen.yml`). Po każdym wydaniu odświeża się tę wiki i publikuje wiki GitHub — procedura w `AGENTS.md`
(„Dokumentacja po wydaniu”).

## Która strona odpowiada na pytanie

| Pytanie | Strona |
|---|---|
| Z czego składa się system i kto z kim rozmawia? | [Przegląd systemu](architektura/przeglad-systemu.md) |
| Jak działa serwer, jego tryby, porty i zabezpieczenia? | [EmuStart Server](architektura/serwer-emustart.md) |
| Jak działają klient Windows i aplikacja Android? | [Klienci EmuStart](architektura/klienci-emustart.md) |
| Jak zbudowany jest Lumen (uprawnienia, druga kopia, Deck, dane, aktualizacje)? | [Lumen — launcher Electron](architektura/lumen.md) |
| Jak działa tryb TV (listy, strona gry, motywy, pad), Ustawienia i kopiuj / wklej? | [Lumen — tryb TV i ustawienia](architektura/lumen-tryb-tv.md) |
| Skąd są gry Xbox, Game Pass i jak działa logowanie kontem Xbox? | [Xbox i Microsoft Store](integracje/xbox-microsoft-store.md) |
| Jak Lumen rozmawia z silnikiem EmuStart? | [Most Lumen ↔ silnik](integracje/most-lumen-silnik.md) |
| Jakie są trasy `/v1`, jak logują się urządzenia, jak działa synchronizacja zapisów? | [API /v1](przeplywy/api-v1.md) |
| Jak gry GOG trafiają z archiwum serwera na komputer (instalacja, UAC, uruchamianie)? | [Gry GOG z archiwum serwera](przeplywy/gry-gog.md) |
| Skąd są serie gier i jak Lumen je układa? | [Serie gier](przeplywy/serie-gier.md) |
| Jak działają motywy TV z serwera i co je zabezpiecza? | [Motywy trybu TV](przeplywy/motywy-tv.md) |
| Gdzie są `config.json`, dane, logi; jakie porty i zmienne środowiskowe? | [Konfiguracja, porty, ścieżki i logi](operacje/konfiguracja-porty-i-sciezki.md) |
| Jak zbudować, przetestować i wydać (tagi `emustart-v…`, `lumen-v…`), jak opublikować wiki GitHub? | [Budowa, testy i wydania](operacje/budowa-testy-i-wydania.md) |
| Urządzenie nie widzi serwera / silnik nie startuje / Xbox odmawia / brak muzyki MIDI? | [Rozwiązywanie problemów](operacje/rozwiazywanie-problemow.md) |

## Inne źródła w repozytorium

- `emustart/docs/wiki/` i `lumen/docs/wiki/` — dokumentacja użytkownika EmuStart i Lumena; razem z tą wiki
  publikowana na [wiki GitHub](https://github.com/C4rl0s79/EmustartNXT/wiki) (`scripts/publish_wiki.py`).
- `lumen/docs/themes/README.md` — jak zrobić motyw trybu TV.
- `emustart/docs/SAVE_SYNC_DESIGN.md`, `emustart/docs/GOG.md` — projekty synchronizacji zapisów i GOG.
- `lumen/docs/INTEGRATION.md`, `ARCHITECTURE.md`, `MIGRATION.md`, `TESTING.md` — dokumentacja Lumena.
- `emustart/CLAUDE.md` — zasady pracy (zakres zmian, sprawdzanie przed PR, wydania, „jeden ekosystem”);
  plan i stan prac — `emustart/CHANGELOG.md` → `[Nieopublikowane]`.

## Znane rozbieżności dokumentacji z kodem

Skutki przenosin do monorepo (2026-11-10):

- `updater.py` i `clientdist.py` w kopii silnika (`lumen/engine/`) wciąż wskazują dawne repozytoria —
  zob. [Most Lumen ↔ silnik](integracje/most-lumen-silnik.md#stan-kopii-sprawdzony-w-historii-git-2026-11-11).
- Workflow Android nie reaguje na tagi `emustart-v…` (sekrety podpisu APK nieprzeniesione) —
  zob. [Budowa, testy i wydania](operacje/budowa-testy-i-wydania.md).

Starsze niż monorepo:

- Docstring `emustart/emustart/remote.py` mówi o API „przez HTTP”; od 0.43 `/v1` wymaga HTTPS.
- `lumen/engine/UPSTREAM.md` opisuje stan subtree (v0.54.3) z dawnego repozytorium Launcher.
- Komentarz „LB + A” w `lumen/engine/engine_main.py` — od 0.62.0 skrót menu w grze to Select + A.

Miejsca oznaczone w wiki **TODO: do weryfikacji** nie dały się potwierdzić w kodzie.
