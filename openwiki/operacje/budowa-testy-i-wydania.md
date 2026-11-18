---
type: operacje
title: "Budowa, testy i wydania"
description: "Jak zbudować i przetestować EmuStart (build.ps1, PyInstaller, Gradle) i Lumena (npm run dist, vitest, typecheck), co robi CI w .github/workflows, jak powstają i są podpisywane wydania z tagami emustart-v… i lumen-v… oraz jak włączyć automatyczną aktualizację OpenWiki."
tags: [build, ci, release, testing, signing, github-actions, openwiki]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T15:15:29.370Z
sources:
  - id: openwiki-source-4e3e538728489e7a1208c697
    resource: repo://.github/workflows/android.yml
  - id: openwiki-source-405b8b710d216259d5c49bbb
    resource: repo://.github/workflows/lumen.yml
  - id: openwiki-source-6d4b4e707b8d60b6ccfa3425
    resource: repo://.github/workflows/openwiki-update.yml
  - id: openwiki-source-c50d065f5235e5ffd41ee89b
    resource: repo://.github/workflows/windows.yml
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-3a86e937b3bdf9fc386b02ba
    resource: repo://emustart/android/app/build.gradle.kts
  - id: openwiki-source-8157ecc58d2847ca6e5feddb
    resource: repo://emustart/build.ps1
  - id: openwiki-source-5938cfad97d428b6e016845b
    resource: repo://emustart/emustart/signing.py
  - id: openwiki-source-0e32751ee2661d39a58dab3e
    resource: repo://lumen/electron-builder.yml
  - id: openwiki-source-0489da0a61fcd248c992eb27
    resource: repo://lumen/package.json
  - id: openwiki-source-f2d8491c8ff6aa07a5172ec8
    resource: repo://lumen/README.md
  - id: openwiki-source-d69f512d6dbd56a78b25462c
    resource: repo://lumen/scripts/sign-release.mjs
  - id: openwiki-source-ee4b9047b69765a31df0868a
    resource: repo://scripts/publish_wiki.py
generated: { by: "claude-code", at: "2026-11-18T00:22:21.680Z" }
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
| `.github/workflows/android.yml` | push na `main` (zmiany w Androidzie), tag `emustart-v*`, ręcznie | `ubuntu-latest`, JDK 17, Gradle 8.11.1, `gradle -p android assembleRelease`; APK jako artefakt; przy tagu: podpis wydania i dołączenie do wydania |

Przy tagu `emustart-v*` `windows.yml`:

1. podpisuje oba ZIP-y (`python tools/release_sign.py sign`, potem `verify`) kluczem z sekretu
   `EMUSTART_SIGNING_KEY`;
2. jeśli wydania jeszcze nie ma — tworzy je (`gh release create`) z opisem wyciętym z sekcji tej wersji
   w `emustart/CHANGELOG.md`;
3. dołącza ZIP-y i pliki `.sig` (`gh release upload --clobber`).

Przy tagu `emustart-v*` `android.yml` buduje podpisane APK, podpisuje je też podpisem wydania
(`tools/release_sign.py`, sekret `EMUSTART_SIGNING_KEY` — serwer sprawdza go przed udostępnieniem APK), czeka,
aż `windows.yml` założy wydanie, i dołącza APK z `.sig`. Wyzwalacz tagów był wyłączony do przeniesienia sekretów
podpisu APK z dawnego repozytorium EmuStart; od 2026-11-17 (EmuStart 0.66.2) są w EmustartNXT — ten sam klucz co
dotychczasowa aplikacja, więc telefon instaluje APK jako aktualizację. Sekrety podpisu APK używane przez Gradle
(`emustart/android/app/build.gradle.kts`): `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (bez niego alias `emustart`), `ANDROID_KEY_PASSWORD` (bez niego hasło magazynu); bez
`ANDROID_KEYSTORE_B64` APK jest podpisane kluczem debug.

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

Zbudowany `Lumen.exe` ma w manifeście `requestedExecutionLevel: requireAdministrator` (`lumen/electron-builder.yml`)
— jedno okno UAC przy starcie; gry, Steam i emulatory startują bez uprawnień (zob.
[Lumen](../architektura/lumen.md)). Uruchomienie ze źródeł (`npm run dev`) działa bez uprawnień administratora.

### Testy

- `npm test` — vitest; `npm run typecheck` — `tsc --noEmit`; w CI vitest działa z `--testTimeout=30000`
  (pierwszy dynamiczny `import()` na maszynie CI potrafi trwać ponad domyślne 5 s);
- `npm run test:engine` — `pytest` w `lumen/engine/tests`.

### CI i wydanie Lumena (`.github/workflows/lumen.yml`)

| Zadanie | Wyzwalacz | Co robi |
|---|---|---|
| `test` | PR i push na `main` (zmiany w `lumen/**`), tag `lumen-v*`, ręcznie | `windows-latest`, Node 24, Python 3.14 (+ `pillow` do testów grafik): `npm ci`, `npm run typecheck`, `npm test`, `pytest` w `lumen/engine/tests` |
| `build` | tag `lumen-v*` albo ręcznie, po `test` | silnik (`python -m PyInstaller … lumen-engine.spec`) i Lumen (`electron-vite build`, `electron-builder --publish never`) |

Przy tagu `lumen-vX.Y.Z` zadanie `build` dodatkowo:

1. sprawdza, że `X.Y.Z` zgadza się z wersją w `lumen/package.json` (inaczej błąd);
2. podpisuje `Lumen-X.Y.Z-portable.zip` i `Lumen-X.Y.Z-setup.exe` skryptem
   `scripts/sign-release.mjs` — klucz Ed25519 (PEM) z sekretu `LUMEN_SIGNING_KEY`, zapisany na czas kroku
   do pliku tymczasowego; skrypt sprawdza zgodność z `RELEASE_PUBKEY` w `src/main/releaseSigning.ts`
   i podpisuje wiadomość `lumen-release-v1\n<nazwa>\n<sha256>`;
3. zakłada wydanie (jeśli go nie ma) z opisem z treści adnotowanego tagu i dołącza oba pliki z `.sig`.

Ręczne uruchomienie buduje to samo bez podpisu i wydania (pliki jako artefakty przebiegu). Procedura
opiekuna (`lumen/README.md`, „Wydanie (GitHub Actions)”): PR z wersją w `package.json` i
`package-lock.json`, po scaleniu adnotowany tag `git tag -a lumen-vX.Y.Z --cleanup=verbatim -F <notatki>`
(`--cleanup=verbatim` zachowuje nagłówki Markdown `#`) i jego push.

Awaryjnie lokalnie: `npm run dist`, potem `scripts/sign-release.mjs` z kluczem w `LUMEN_SIGNING_KEY_FILE`.

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

## Wiki GitHub (`scripts/publish_wiki.py`)

Wiki projektu na GitHubie (`C4rl0s79/EmustartNXT.wiki.git`) jest składana z plików repozytorium i nie edytuje się
jej ręcznie (`README.md`, sekcja „Wiki”):

- `emustart/docs/wiki/*.md` — strony gracza EmuStart; ich `Home.md` staje się stroną „EmuStart”;
- `lumen/docs/wiki/*.md` — strony gracza Lumena (tryb TV, poradniki kluczy API, do których linkuje aplikacja —
  `lumen/src/renderer/src/components/KeyGuide.tsx`);
- `openwiki/` — strony „Technika-…” (mapa nazw `OPENWIKI_PAGES` w skrypcie): bez nagłówka YAML, linki `.md`
  przepisane na strony wiki, pliki źródłowe jako linki do GitHuba; strony `index.md` katalogów prowadzą do
  „Dla-deweloperów” (z `quickstart.md`).

Skrypt tworzy `Home` i `_Sidebar`, przerywa przy dwóch stronach o tej samej nazwie albo linku do nieznanej strony
OpenWiki, usuwa strony, które sam kiedyś zapisał (znacznik w pierwszej linii), a których nie ma już w źródłach,
i zostawia strony dodane ręcznie. Użycie: `git clone https://github.com/C4rl0s79/EmustartNXT.wiki.git <folder>`,
potem `python scripts/publish_wiki.py <folder>` (podgląd: pliki w kopii wiki, bez dodawania do gita) albo z `--push`
(commit i push; wysyła też commit z wcześniejszego przebiegu, którego push się nie udał). Nowa strona OpenWiki
wymaga wpisu w `OPENWIKI_PAGES`.

### Dokumentacja po wydaniu (`AGENTS.md`)

Wydanie EmuStart albo Lumena jest zakończone dopiero po odświeżeniu dokumentacji: przebieg OpenWiki `update`
w języku `pl` z `main` (w Claude Code: `/openwiki`), nowa strona OpenWiki dopisana do `OPENWIKI_PAGES`, zmiany dla
gracza w `lumen/docs/wiki/` albo `emustart/docs/wiki/`, PR z gałęzi `docs/wiki-<wersja>`, a po scaleniu
`python scripts/publish_wiki.py <kopia wiki> --push`. Gdy OpenWiki nie ma nic do zmiany — tylko publikacja, jeśli
zmieniły się strony gracza (`AGENTS.md`, sekcja 7; odnośniki w `emustart/CLAUDE.md` i `README.md`).

## Powiązane

- [Przegląd systemu](../architektura/przeglad-systemu.md)
- [Konfiguracja, porty, ścieżki i logi](konfiguracja-porty-i-sciezki.md)
- [Lumen — aktualizator](../architektura/lumen.md#aktualizator)
