---
type: architektura
title: "Lumen — launcher Electron"
description: "Budowa Lumena: proces główny Electron, preload window.lumen, renderer React w dwóch układach (pulpit i TV), Deck na pulpicie, wspólna biblioteka Steam + EmuStart + GOG, katalog LumenData i aktualizator z wydań lumen-v…."
tags: [lumen, electron, react, deck, updater, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T21:56:42.171Z
sources:
  - id: openwiki-source-0e32751ee2661d39a58dab3e
    resource: repo://lumen/electron-builder.yml
  - id: openwiki-source-dd19cbf3973f6a821a32df97
    resource: repo://lumen/src/main/core/jobs.ts
  - id: openwiki-source-5a39473792996e9404198864
    resource: repo://lumen/src/main/core/uiMode.ts
  - id: openwiki-source-ea05cc17602f2ac1fc801500
    resource: repo://lumen/src/main/core/unifiedLibrary.ts
  - id: openwiki-source-28e1d925162697c2b875247f
    resource: repo://lumen/src/main/dataDir.ts
  - id: openwiki-source-5302eff1bb3714b91bee1699
    resource: repo://lumen/src/main/deckWindow.ts
  - id: openwiki-source-740669e92b73cb34609f9e8a
    resource: repo://lumen/src/main/details/wikipedia.ts
  - id: openwiki-source-6f89370f7dc09be72fbc87a4
    resource: repo://lumen/src/main/elevation.ts
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
  - id: openwiki-source-a4c7f9f77c5cd84030de0eb0
    resource: repo://lumen/src/main/instances.ts
  - id: openwiki-source-c7a3b7dae932c5a9a714e05a
    resource: repo://lumen/src/main/updater.ts
  - id: openwiki-source-1ad07c49b6016e10a33d1af2
    resource: repo://lumen/src/preload/index.ts
  - id: openwiki-source-dc5952af8e1e43cd550b6c95
    resource: repo://lumen/src/renderer/src/deck/DeckPanel.tsx
  - id: openwiki-source-7bdeef8798e03468fa7ab86d
    resource: repo://lumen/src/renderer/src/lib/artCache.ts
  - id: openwiki-source-e080b6221e297cf7c50b630e
    resource: repo://lumen/src/renderer/src/tv/gameParts.tsx
  - id: openwiki-source-de906671f09d6ccb0be869a2
    resource: repo://lumen/src/shared/deck.ts
generated: { by: "claude-code", at: "2026-11-18T00:22:21.680Z" }
---

# Lumen — launcher Electron

Lumen (`lumen/`) to aplikacja kliencka dla Windows: gry **Steam**, gry na emulowane platformy
z **serwera EmuStart**, gry **GOG** z archiwum serwera oraz gry **Xbox / Microsoft Store** i katalog
**PC Game Pass** w jednej bibliotece. Stos: Electron 44, React 19,
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
  xbox/           gry Xbox / Microsoft Store, katalog PC Game Pass, konto Xbox
  art/, launchbox/, input/ (XInput, Raw HID), store/ (settings, prefs, jsonFile)
  dataDir.ts, updater.ts, releaseSigning.ts, deckWindow.ts, desktopLayer.ts, localMedia.ts, logger.ts,
  elevation.ts (uprawnienia administratora), instances.ts (druga kopia), hangWatch.ts, editMenu.ts, themes.ts,
  series.ts
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
(`EmustartProvider`), GOG z serwera EmuStart (`GogProvider`) i — gdy jest — Xbox (`XboxProvider`, zob.
[Xbox i Microsoft Store](../integracje/xbox-microsoft-store.md)). **Gry nigdy nie są łączone po tytule** —
wydania Steam, GOG, Xbox i emulatorowe tego samego tytułu są osobnymi pozycjami z własnymi id i akcjami.
Serie gier (z IGDB przez serwer) idą do okien osobnym kanałem, nie w migawce biblioteki — zob.
[Serie gier](../przeplywy/serie-gier.md).
Identyfikatory: `steam:<appid>`, `shortcut:<appid32>`, `emu:<game_id>` (id z serwera, takie samo na
każdym urządzeniu) — `lumen/docs/INTEGRATION.md` §3.

Wspólna lista zadań (pobieranie Steam, uruchamianie/pobieranie/emulatory/zapisy EmuStart, instalacje GOG) jest
w `src/main/core/jobs.ts`. Pobieranie Steam ma bajty z `appmanifest_<id>.acf`; prędkość i czas do końca liczy
`RateMeter` z kolejnych odczytów (okno 30 s, zegar monotoniczny, liczniki stojące dłużej niż okno — bez prędkości),
a `UnifiedLibrary` odświeża zadania co 10 s, gdy trwa pobieranie Steam.

## Opis i szczegóły gry (strona gry)

Kanał IPC `gameDetails` (`src/main/index.ts`) zbiera opis i fakty gry w dwóch krokach (od Lumena 1.0.77):

1. **Własne źródła** (`ownDetails`, osobna funkcja na rodzaj gry):

   | Gra | Źródło | Braki uzupełnia |
   |---|---|---|
   | EmuStart | silnik (`game_detail`) | LaunchBox (po identyfikatorze) |
   | GOG | folder gry GOG Managera na serwerze | LaunchBox (Windows, potem MS-DOS) |
   | skrót Steam spoza sklepu | LaunchBox (platforma z tagów skrótu) | — |
   | Xbox / Microsoft Store | strona produktu w katalogu Microsoft ([Xbox](../integracje/xbox-microsoft-store.md)) | LaunchBox |
   | Steam | sklep Steam (pamięć `cache/meta`) | gra, której sklep nie zwraca — LaunchBox |

2. **Wikipedia — ostatnie źródło dla każdej gry** (`withWikipedia`, `src/main/details/wikipedia.ts`), gdy po
   kroku 1 nadal nie ma opisu: wyszukiwanie „<tytuł> gra” w polskiej, potem „<tytuł> video game” w angielskiej
   Wikipedii (jak `metadata.from_wikipedia` na serwerze EmuStart), artykuł o tytule podobnym w co najmniej 75 %
   i z tymi samymi numerami części (`wikiCandidates`: „Final Fantasy” ≠ „Final Fantasy V”), streszczenie bez stron
   ujednoznaczniających. Wynik i brak artykułu są zapisywane w `cache/meta/wikipedia.json` (artykuł — 90 dni,
   brak — 7 dni; czyszczone razem z pamięcią podręczną).
   Wikimedia odmawia (HTTP 429) przy serii zapytań, więc zapytania idą pojedynczo (najnowsza gra pierwsza),
   a po odmowie jest przerwa 2–30 min (`pauseAfter429`). Strona gry czeka na Wikipedię najwyżej 5 s
   (`WIKI_WAIT_MS`); wolniejsze szukanie kończy się w tle i opis pokazuje się przy następnym otwarciu.
   „Wikipedia też nie ma artykułu” Lumen pisze tylko po faktycznym sprawdzeniu — brak sieci, przerwa i wolna
   odpowiedź nic nie dodają (odpowiedź `hit` / `miss` / `unknown`).

**Nazwa do szukania** (`detailsTitle`): nazwa w LaunchBox ustawiona przez administratora serwera, potem gra
wybrana w oknie grafik („Dopasowanie w SteamGridDB”, `prefs.art[id].sgdbGameName`), potem nazwa ze sklepu.
Zmiana dopasowania czyści fakty LaunchBox gry, a strona gry na pulpicie (`screens/Details.tsx`) i w trybie TV
(`useDetails` w `tv/gameParts.tsx`) pobiera opis na nowo. W trybie TV opis jest trzymany przez sesję tylko wtedy,
gdy go znaleziono — błąd albo strona bez opisu są pytane ponownie. Pozycje demonstracyjne (`demo:`) nie są nigdzie
szukane. Pod opisem strona gry podaje źródło („Opis: katalog Microsoft Store”, „Opis: Wikipedia (…)”; przy opisie
z Wikipedii inne źródła figurują jako „Szczegóły: …”). Testy: `lumen/tests/details.test.ts`.

## Dwa układy jednego interfejsu

`UiModeManager` (`src/main/core/uiMode.ts`): jeden renderer React, dwa układy — **pulpit** (wygląd
Lumena) i **TV** (pełny ekran, `src/renderer/src/tv` — opis w
[Lumen — tryb TV i ustawienia](lumen-tryb-tv.md)). Przełączenie zmienia tylko
układ i pełny ekran okna; zadania żyją w rdzeniu i silniku, więc trwają dalej, a wybrana gra
„przechodzi” między układami. Skróty (`src/main/index.ts`): **F10** albo View+Start — przełączenie
układu, F11 — pełny ekran okna, F12 — DevTools (w trybie deweloperskim).

## Deck

`DeckWindow` (`src/main/deckWindow.ts`) to opcjonalny interfejs na pulpicie: belka nad tapetą i pod
oknami aplikacji (`desktopLayer.ts`), bez fokusu, poza Alt+Tab i paskiem zadań, na ekranie głównym.
Okno istnieje tylko, gdy Deck jest włączony w ustawieniach. Deck dostaje migawkę tylko z gier na tym
komputerze, gier w trakcie pobierania (`onDeck` w `src/shared/deck.ts`) i 40 ostatnio granych, oraz listę zadań
(kanał `jobsChanged`): kafelek pobieranej gry ma pasek z procentem, prędkością i czasem do końca (`tileProgress`
w `deck/DeckPanel.tsx`; każdy kafelek śledzi tylko swoje zadanie). Autostart z Windows (`--deck`): w wersji zainstalowanej, działającej jako
administrator — zadanie Harmonogramu z najwyższymi uprawnieniami i opóźnieniem po zalogowaniu
(`elevation.ts`; wpis Run nie uruchomiłby programu wymagającego uprawnień), ze źródeł — wpis Run w rejestrze
użytkownika.

Gdy Deck działa, zamknięcie okna głównego (albo „Wyjdź” w menu TV) chowa Lumena do zasobnika zamiast
kończyć program — `hidesToTray()` w `src/main/index.ts`.

## Lumen jako administrator

Wersja zainstalowana startuje z manifestem `requireAdministrator` (`electron-builder.yml`) — jedno okno UAC przy
starcie zamiast okna przy każdym kroku instalacji gier GOG. Programy gracza nie dostają tych uprawnień: silnik
uruchamia gry i emulatory przez `unelevated.popen` (zob. [Klienci EmuStart](klienci-emustart.md)), a Lumen
otwiera adresy (`steam://…`, `https://…`) przez Eksploratora (`openUnelevated` w `elevation.ts`). Czy Lumen ma
uprawnienia, sprawdza `isElevated()` (kod wyjścia `fltmc.exe`).

**Druga kopia** (`instances.ts`): nowa kopia zostawia prośbę w plikach `%LOCALAPPDATA%\Lumen`
(`running.json`, `second-instance.json`, odpowiedź `second-instance-<PID>.answer`), a działająca pokazuje okno
wyboru. Działająca kopia niczego nie uruchamia z prośby (prośbę może zapisać każdy proces użytkownika — byłoby to
obejście UAC); przy „przełącz” sama się zamyka, a nowa startuje. Osobny profil `LUMEN_USER_DATA` nie oddaje
startu działającemu Lumenowi.

## Diagnostyka i wydajność

- `hangWatch.ts`: „nie odpowiada / znów odpowiada” z czasem dla okna głównego i Decka, awarie procesów Electrona,
  co 10 minut pamięć procesów — w logu.
- `lib/perf.ts` (czujnik zacięć `[perf]` w interfejsie) i `perfTime.ts` (czas pracy procesu głównego).
- `lib/artCache.ts`: grafiki `lumen-art://` wczytywane w tle (`fetch` → blob → `decode()`) i trzymane w pamięci do
  256 MB — `<img>` dekodował duże i animowane pliki kawałkami na wątku interfejsu.

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
(`migrateDataDir`, lista `MIGRATED_ENTRIES`). Po sprawdzeniu drugiej kopii (wyżej) proces kończy się także, gdy
nie dostanie blokady jednej kopii Electrona (`app.requestSingleInstanceLock()`).

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

- [Lumen — tryb TV i ustawienia](lumen-tryb-tv.md)
- [Most Lumen ↔ silnik EmuStart](../integracje/most-lumen-silnik.md)
- [Xbox i Microsoft Store](../integracje/xbox-microsoft-store.md)
- [Przegląd systemu](przeglad-systemu.md)
- `lumen/docs/INTEGRATION.md` (pełny opis integracji i stan sprawdzenia), `lumen/docs/MIGRATION.md`,
  `lumen/docs/TESTING.md`
