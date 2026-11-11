---
type: operacje
title: "Budowa, testy i wydania"
description: "Jak zbudować i przetestować EmuStart (build.ps1, PyInstaller, Gradle) i Lumena (npm run dist, vitest, typecheck), co robi CI w .github/workflows, jak powstają i są podpisywane wydania z tagami emustart-v… i lumen-v… oraz jak włączyć automatyczną aktualizację OpenWiki."
tags: [build, ci, release, testing, signing, github-actions, openwiki]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-11T20:26:15.897Z
sources:
  - id: openwiki-source-4e3e538728489e7a1208c697
    resource: repo://.github/workflows/android.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-c50d065f5235e5ffd41ee89b
    resource: repo://.github/workflows/windows.yml
  - id: openwiki-source-8157ecc58d2847ca6e5feddb
    resource: repo://emustart/build.ps1
  - id: openwiki-source-5938cfad97d428b6e016845b
    resource: repo://emustart/emustart/signing.py
  - id: openwiki-source-0489da0a61fcd248c992eb27
    resource: repo://lumen/package.json
  - id: openwiki-source-d69f512d6dbd56a78b25462c
    resource: repo://lumen/scripts/sign-release.mjs
generated: { by: "claude-code", at: "2026-11-11T20:26:15.897Z" }
---

# Budowa, testy i wydania

Repozytorium ma dwa niezależnie wydawane programy, rozróżniane **przedrostkiem tagu**:
`emustart-vX.Y.Z` (EmuStart: klient, serwer, APK) i `lumen-vX.Y.Z` (Lumen). Aktualizatory obu
programów czytają listę wydań `C4rl0s79/EmustartNXT` i wybierają najnowsze ze swoim przedrostkiem
(`lumen/src/main/updater.ts`; dla EmuStart — `emustart/CLAUDE.md`, sekcja „Wydania”).

## EmuStart (`emustart/`)

### Budowa lokalna

`emustart/build.ps1` (PowerShell, Windows):

1. `python -m pytest -q tests` (przy niepowodzeniach — ponowienie `--lf`);
2. `python -m PyInstaller --noconfirm --clean emustart.spec`;
3. ZIP-y: `dist\EmuStart-<wersja>-win64.zip` (`dist\EmuStart\EmuStart.exe`) i
   `dist\EmuStart-Server-<wersja>-win64.zip` (`dist\EmuStartServer\EmuStartServer.exe`).

Wymagania: Python 3.14 (CI: „compression.zstd jest od 3.14”), `pip install -r requirements.txt
pyinstaller pillow` (`.github/workflows/windows.yml`). Uruchamianie ze źródeł: `python main.py`,
`python server_main.py` — zob. [Klienci EmuStart](../architektura/klienci-emustart.md),
[EmuStart Server](../architektura/serwer-emustart.md); opis dla użytkownika:
`emustart/docs/wiki/Budowa-ze-źródeł.md`.

Wersja programu jest w `emustart/emustart/__init__.py`; APK bierze ją stamtąd.

### Testy

- `python -m pytest -q` w `emustart/` — przed PR porównać liczbę niepowodzeń z `main`
  (część testów działa tylko pod Windows) — `emustart/CLAUDE.md`.
- Zmiana w `web/`: `python main.py --browser` i przejście klawiaturą po interfejsie (Playwright/Chromium).

### CI

| Workflow | Wyzwalacz | Co robi |
|---|---|---|
| `.github/workflows/windows.yml` | push na `main` i PR (zmiany w `emustart/…`), tag `emustart-v*`, ręcznie | `windows-latest`, Python 3.14, `build.ps1` (testy + PyInstaller), ZIP-y jako artefakty; przy tagu: podpis i dołączenie do wydania |
| `.github/workflows/android.yml` | push na `main` (zmiany w Androidzie), ręcznie | `ubuntu-latest`, JDK 17, Gradle 8.11.1, `gradle -p android assembleRelease`; APK jako artefakt |

Przy tagu `emustart-v*` `windows.yml`:

1. podpisuje oba ZIP-y (`python tools/release_sign.py sign`, potem `verify`) kluczem z sekretu
   `EMUSTART_SIGNING_KEY`;
2. jeśli wydania jeszcze nie ma — tworzy je (`gh release create`) z opisem wyciętym z sekcji tej wersji
   w `emustart/CHANGELOG.md`;
3. dołącza ZIP-y i pliki `.sig` (`gh release upload --clobber`).

Wyzwalacz tagów w `android.yml` jest **wyłączony** (`# tags: ["emustart-v*"]` — „do przeniesienia
sekretów podpisu APK do EmustartNXT”), więc wydania nie dostają dziś APK z CI. Sekrety podpisu APK
używane przez workflow: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`.

> W `lumen/engine/.github/workflows/` leżą stare kopie workflowów z repozytorium EmuStart. GitHub
> uruchamia tylko workflowy z `.github/workflows/` w katalogu głównym, więc te kopie nie działają.

### Podpis wydań (`emustart/emustart/signing.py`)

Ed25519. Podpisywana jest wiadomość `emustart-release-v1\n<nazwa pliku>\n<sha256 hex>` — podpis jednego
pliku nie pasuje do innego. Plik `<nazwa>.sig` (base64) leży obok pliku w wydaniu. Klucz publiczny
jest wbudowany w program (`RELEASE_PUBKEY`), prywatny — tylko w sekrecie CI. Ten sam moduł zna
osobny klucz Lumena: serwer sprawdza nim instalator Lumena przed udostępnieniem go do pobrania
(`emustart/emustart/clientdist.py`).

### Procedura wydania (z `emustart/CLAUDE.md`)

PR z wydaniem = podbita wersja w `emustart/__init__.py` + wpis w `CHANGELOG.md`. Tag `emustart-vX.Y.Z`
wypycha się dopiero po scaleniu PR do `main`.

## Lumen (`lumen/`)

### Budowa i uruchamianie

Skrypty z `lumen/package.json`:

| Polecenie | Działanie |
|---|---|
| `npm install` | zależności (Node.js 22+) |
| `npm run dev` | aplikacja z przeładowaniem na żywo; silnik ze źródeł (`py -3 engine/engine_main.py`) |
| `npm run build` / `npm start` | build produkcyjny / podgląd |
| `npm run build:engine` | `EmuStartEngine.exe` (PyInstaller, `engine/lumen-engine.spec`) |
| `npm run dist` | silnik + electron-vite + electron-builder → `release/Lumen-<wersja>-portable.zip`, `release/Lumen-<wersja>-setup.exe` |
| `npm run dist:dir` | jak `dist`, ale tylko rozpakowana aplikacja (`release/win-unpacked`) |

Silnik ze źródeł wymaga Pythona 3.12+ i `pip install -r engine/requirements.txt` (`lumen/README.md`).

### Testy

- `npm test` — vitest; `npm run typecheck` — `tsc --noEmit`;
- `npm run test:engine` — `pytest` w `lumen/engine/tests`.

**Lumen nie ma workflowu CI** — w `.github/workflows/` są tylko `windows.yml`, `android.yml`
i `openwiki-update.yml`; testy Lumena uruchamia się lokalnie.

### Wydanie Lumena (lokalnie, bez CI)

1. Wersja w `lumen/package.json` (+ `package-lock.json`).
2. `npm run dist`.
3. Podpis: `node scripts/sign-release.mjs release/Lumen-X.Y.Z-portable.zip release/Lumen-X.Y.Z-setup.exe`
   — klucz prywatny Ed25519 z pliku wskazanego przez `LUMEN_SIGNING_KEY_FILE`; skrypt sprawdza, czy
   pasuje do `RELEASE_PUBKEY` w `src/main/releaseSigning.ts`, i podpisuje wiadomość
   `lumen-release-v1\n<nazwa>\n<sha256>`.
4. Tag `lumen-vX.Y.Z` i wydanie GitHub z czterema plikami (zip, exe, oba `.sig`).

> **TODO: do weryfikacji** — kroki 1 i 4 wynikają z praktyki opiekuna, nie z pliku w repozytorium.

## Automatyczna aktualizacja OpenWiki

`.github/workflows/openwiki-update.yml` (push na `main` poza `openwiki/**`, ręcznie):

- działa tylko, gdy ustawiono zmienne repozytorium `OPENWIKI_PROVIDER` i `OPENWIKI_MODEL_ID` oraz
  sekret z kluczem dostawcy (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `GEMINI_API_KEY` albo `COPILOT_API_KEY`); bez `OPENWIKI_PROVIDER` push pomija zadanie;
- instaluje `openwiki@0.9.0`, uruchamia `openwiki code --update --print` z wyłączoną telemetrią;
- usuwa `openwiki/.run.json` i otwiera PR (gałąź `openwiki/update`) wyłącznie ze zmianami w `openwiki/`,
  bez auto-merge;
- wymaga ustawienia Settings → Actions → General → „Allow GitHub Actions to create and approve pull
  requests”.

Bez dostawcy w CI wiki aktualizuje się lokalnie (Claude Code z integracją OpenWiki).

## Powiązane

- [Przegląd systemu](../architektura/przeglad-systemu.md)
- [Konfiguracja, porty, ścieżki i logi](konfiguracja-porty-i-sciezki.md)
- [Lumen — aktualizator](../architektura/lumen.md#aktualizator)
