---
type: architektura
title: "Lumen — launcher Electron"
description: "Budowa Lumena: proces główny Electron, preload window.lumen, renderer React w dwóch układach (pulpit i TV), Deck na pulpicie, wspólna biblioteka Steam + EmuStart + GOG, katalog LumenData i aktualizator z wydań lumen-v…."
tags: [lumen, electron, react, deck, updater, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-11T20:46:08.589Z
sources:
  - id: openwiki-source-5a39473792996e9404198864
    resource: repo://lumen/src/main/core/uiMode.ts
  - id: openwiki-source-ea05cc17602f2ac1fc801500
    resource: repo://lumen/src/main/core/unifiedLibrary.ts
  - id: openwiki-source-28e1d925162697c2b875247f
    resource: repo://lumen/src/main/dataDir.ts
  - id: openwiki-source-5302eff1bb3714b91bee1699
    resource: repo://lumen/src/main/deckWindow.ts
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
  - id: openwiki-source-c7a3b7dae932c5a9a714e05a
    resource: repo://lumen/src/main/updater.ts
  - id: openwiki-source-1ad07c49b6016e10a33d1af2
    resource: repo://lumen/src/preload/index.ts
generated: { by: "claude-code", at: "2026-11-11T20:46:08.589Z" }
---

# Lumen — launcher Electron

Lumen (`lumen/`) to aplikacja kliencka dla Windows: gry **Steam**, gry na emulowane platformy
z **serwera EmuStart** i gry **GOG** z serwera w jednej bibliotece. Stos: Electron 44, React 19,
TypeScript, electron-vite, electron-builder (`lumen/package.json`, `lumen/docs/ARCHITECTURE.md`).
Logika emulacji nie jest przepisana na TypeScript — wykonuje ją **silnik EmuStart** (`lumen/engine/`,
Python) uruchamiany jako proces bez okna; zob. [Most Lumen ↔ silnik](../integracje/most-lumen-silnik.md).

## Warstwy

```
src/shared/     typy i kontrakt IPC (types.ts, api.ts), nawigacja biblioteki, pad, Deck
src/main/       proces główny (Node): okno, IPC, Steam, grafiki, LaunchBox, GOG, silnik EmuStart
  core/           unifiedLibrary.ts, jobs.ts, uiMode.ts — wspólny rdzeń
  steam/          pliki VDF/ACF, rejestr, steam://, Web API, kolekcje, skróty
  library/        biblioteka Steam (scalanie, watcher, first-seen, tryb demo)
  emustart/       engine.ts, provider.ts, mapping.ts, ipc.ts, versions.ts
  gog/            gry GOG z serwera EmuStart
  art/, launchbox/, input/ (XInput, Raw HID), store/ (settings, prefs, jsonFile)
  dataDir.ts, updater.ts, releaseSigning.ts, deckWindow.ts, desktopLayer.ts, localMedia.ts, logger.ts
src/preload/    contextBridge → window.lumen
src/renderer/   UI React: index.html (aplikacja), deck.html (Deck)
```

- **Preload** (`src/preload/index.ts`) wystawia jeden obiekt `window.lumen` przez
  `contextBridge.exposeInMainWorld('lumen', api)`; renderer działa w sandboxie z `contextIsolation`
  (`docs/ARCHITECTURE.md`).
- **Pady**: domyślnie proces główny odpytuje XInput przez `koffi` (`src/main/input/xinput.ts`),
  Gamepad API Chromium jest opcją w ustawieniach (`docs/ARCHITECTURE.md`, uzasadnienie: Chromium
  przejmował urządzenia HID i wyłączał pad podłączany w trakcie).

## Wspólna biblioteka

`UnifiedLibrary` (`src/main/core/unifiedLibrary.ts`) zestawia gry Steam (`LibraryService`), EmuStart
(`EmustartProvider`) i GOG z serwera EmuStart (`GogProvider`). **Gry nigdy nie są łączone po tytule** —
wydania Steam, GOG i emulatorowe tego samego tytułu są osobnymi pozycjami z własnymi id i akcjami.
Identyfikatory: `steam:<appid>`, `shortcut:<appid32>`, `emu:<game_id>` (id z serwera, takie samo na
każdym urządzeniu) — `lumen/docs/INTEGRATION.md` §3.

Wspólna lista zadań (pobieranie Steam, uruchamianie/pobieranie/emulatory/zapisy EmuStart) jest
w `src/main/core/jobs.ts`.

## Dwa układy jednego interfejsu

`UiModeManager` (`src/main/core/uiMode.ts`): jeden renderer React, dwa układy — **pulpit** (wygląd
Lumena) i **TV** (pełny ekran, wygląd EmuStart, `src/renderer/src/tv`). Przełączenie zmienia tylko
układ i pełny ekran okna; zadania żyją w rdzeniu i silniku, więc trwają dalej, a wybrana gra
„przechodzi” między układami. Skróty (`src/main/index.ts`): **F10** albo View+Start — przełączenie
układu, F11 — pełny ekran okna, F12 — DevTools (w trybie deweloperskim).

## Deck

`DeckWindow` (`src/main/deckWindow.ts`) to opcjonalny interfejs na pulpicie: belka nad tapetą i pod
oknami aplikacji (`desktopLayer.ts`), bez fokusu, poza Alt+Tab i paskiem zadań, na ekranie głównym.
Okno istnieje tylko, gdy Deck jest włączony w ustawieniach. Autostart z Windows zapisuje w rejestrze
użytkownika wpis `Lumen.exe --deck` (bez uprawnień administratora).

Gdy Deck działa, zamknięcie okna głównego (albo „Wyjdź” w menu TV) chowa Lumena do zasobnika zamiast
kończyć program — `hidesToTray()` w `src/main/index.ts`.

## Dane: `LumenData`

`chooseDataDir` (`src/main/dataDir.ts`), wywoływane na starcie `src/main/index.ts`:

| Sytuacja | Katalog danych |
|---|---|
| zmienna `LUMEN_USER_DATA` (testy, rozwój) | wskazany katalog |
| wersja przenośna (`PORTABLE_EXECUTABLE_DIR`) | `<folder exe>\LumenData` |
| uruchomienie ze źródeł (`!app.isPackaged`) | domyślny `userData` Electrona (`%APPDATA%\Lumen`) |
| wersja zainstalowana | `<folder exe>\LumenData`; gdy folder jest tylko do odczytu — `%APPDATA%\Lumen` z ostrzeżeniem |

W tym katalogu są ustawienia (`settings.json`, `prefs.json`, `secrets.json`), `first-seen.json`,
logi (`logs/`), pliki tymczasowe (`tmp/` — także `TEMP`/`TMP` dla procesów potomnych, w tym silnika)
oraz dane silnika EmuStart z pamięcią gier, emulatorami i BIOS-ami. Starsze pliki są przenoszone
(`migrateDataDir`, lista `MIGRATED_ENTRIES`). Lumen pozwala na jedną instancję
(`app.requestSingleInstanceLock()`).

## Aktualizator

`src/main/updater.ts` (jak `emustart/updater.py`):

1. czyta listę wydań `C4rl0s79/EmustartNXT` (do 5 stron po 30) i bierze najnowsze z tagiem
   `lumen-v…` — `/releases/latest` mogłoby wskazać wydanie EmuStart; gdy żadnego nie ma, sprawdza
   stare repozytorium `C4rl0s79/Launcher`;
2. pobiera plik pasujący do wersji (zip/setup/portable) do `LumenData\update`, sprawdza rozmiar,
   SHA-256 z GitHuba i podpis Ed25519 (`<plik>.sig`, `releaseSigning.ts`);
3. skrypt PowerShell poza procesem czeka na zamknięcie Lumena i silnika, robi kopię programu,
   podmienia pliki (nie dotyka `LumenData`), w razie błędu przywraca kopię; log
   `LumenData\logs\update.log`.

Budowa i wydanie Lumena: [Budowa, testy i wydania](../operacje/budowa-testy-i-wydania.md).

## Powiązane

- [Most Lumen ↔ silnik EmuStart](../integracje/most-lumen-silnik.md)
- [Przegląd systemu](przeglad-systemu.md)
- `lumen/docs/INTEGRATION.md` (pełny opis integracji i stan sprawdzenia), `lumen/docs/MIGRATION.md`,
  `lumen/docs/TESTING.md`
