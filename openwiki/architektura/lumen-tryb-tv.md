---
type: architektura
title: "Lumen — tryb TV i ustawienia"
description: "Układ TV Lumena: ekrany (systemy, podgrupy, lista gier, strona gry), trzy układy listy (lista, wstęga, plakaty) wybierane dla grupy, grafiki, filtry i sortowanie wspólne z pulpitem, motywy wbudowane, sterowanie padem, Ustawienia w siedmiu działach z „Zaawansowane”, kopiuj / wklej."
tags: [lumen, tv-mode, react, navigation, settings, themes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T19:02:08.485Z
sources:
  - id: openwiki-source-e868c5f48de252372a102b58
    resource: repo://lumen/src/main/editMenu.ts
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
  - id: openwiki-source-09c571f087696e3e2b1cfee0
    resource: repo://lumen/src/main/store/prefs.ts
  - id: openwiki-source-f1d754446827eee77cdff1aa
    resource: repo://lumen/src/renderer/src/lib/primary.ts
  - id: openwiki-source-8d8eb4637b8ad24e583b4a7c
    resource: repo://lumen/src/renderer/src/screens/Group.tsx
  - id: openwiki-source-21c4358c86ff6f976f631820
    resource: repo://lumen/src/renderer/src/screens/Settings.tsx
  - id: openwiki-source-7e5c6e51406f51842496057b
    resource: repo://lumen/src/renderer/src/tv/filters.ts
  - id: openwiki-source-e080b6221e297cf7c50b630e
    resource: repo://lumen/src/renderer/src/tv/gameParts.tsx
  - id: openwiki-source-5e75babc84cf5ff414c20fe0
    resource: repo://lumen/src/renderer/src/tv/letters.ts
  - id: openwiki-source-995bad65fd78393a2ee6c0bb
    resource: repo://lumen/src/renderer/src/tv/themes.ts
  - id: openwiki-source-60b01e1365e3b6ce63063912
    resource: repo://lumen/src/renderer/src/tv/tv.css
  - id: openwiki-source-75d0318f11821f4372c5ba8d
    resource: repo://lumen/src/renderer/src/tv/TvCoverflow.tsx
  - id: openwiki-source-6557b9db6c3c9c21c234f34c
    resource: repo://lumen/src/renderer/src/tv/TvGamePage.tsx
  - id: openwiki-source-7ebb2eee42acf299ab5362e6
    resource: repo://lumen/src/renderer/src/tv/TvGames.tsx
generated: { by: "claude-code", at: "2026-11-17T19:02:08.485Z" }
---

# Lumen — tryb TV i ustawienia

Tryb TV (`fullscreen` w `UiMode`) to drugi układ tego samego renderera React co pulpit
(`lumen/src/renderer/src/tv/`). Biblioteka, ustawienia, zadania i okna (np. „Opcje gry”) są wspólne; różni się
układ ekranów i sterowanie, nastawione na pad i duży ekran. Przełączanie: F10 albo View + Start (zob.
[Lumen — launcher Electron](lumen.md)).

## Ekrany

`TvApp.tsx` trzyma stan `screen`: `top` (karuzela grup i platform — `TvSystems`), `subs` (podgrupy, np.
PC → Steam / GOG / Xbox), `games` (lista gier — `TvGames`) i `settings` (ten sam `SettingsScreen` co na
pulpicie). Nad nimi otwierają się menu Start (`TvMenu`), wybór motywu (`TvThemes`) i edytor wyglądu (`TvLook`).

### Lista gier

`TvGames.tsx` pokazuje gry jednej grupy w jednym z trzech układów:

| Układ | Co widać |
|---|---|
| `list` | tytuły w kolumnie (styl EmuStart), obok okładka i zrzut ekranu (`TvPreview`) |
| `coverflow` | wstęga okładek w perspektywie, wybrana na środku (`TvCoverflow`) |
| `posters` | płaski rząd plakatów na dole ekranu (`TvCoverflow` z `flat`), logo gry na jej tle w lewym górnym rogu |

Układ to wybór gracza dla grupy (`Settings.tvLayouts[klucz grupy]`), a bez wyboru — układ motywu
(`theme.games.layout`). Zmienia się go w menu Start na liście gier („Układ listy”: z motywu → Lista → Wstęga →
Plakaty). Przy wybranej grze lista pokazuje tylko `TvSummary` — logo (albo tytuł) i jedną linię: stan, czas gry
albo „jeszcze nie grana”, rok i system; wszystkie szczegóły są na stronie gry. Stan gry na wierszu i plakacie to
jeden znacznik (`stateTag`: w grze → pobieranie → na dysku → lokalnie / zainstalowana).

Sterowanie listy: A — strona gry, X — „Graj” od razu (`usePrimaryAction`, ta sama główna akcja co w szczegółach
pulpitu), Y — filtry i sortowanie (`TvFilters`, zapamiętane dla grupy, wspólne z pulpitem — niżej), L3 — szukaj,
R3 — ulubiona, LB / RB — o stronę, LT / RT — skok po literach (`letters.ts`, według klucza sortowania), Start — menu.

### Wspólne z pulpitem: grafiki, filtry i sortowanie

Tryb TV i pulpit to dwa widoki tej samej biblioteki (ustalenie z 2026-11-17, Lumen 1.0.76). Różnią się
pokazaniem, nie danymi:

- **Grafiki gry.** Pulpit, Deck i tryb TV czytają jeden zbiór wyborów `prefs.art` (także grafiki grup biblioteki
  `navgrp:…`) i tę samą kolejność źródeł: żądanie obrazka gry idzie tą samą drogą w każdym widoku (`emuArt` /
  `artwork.resolve` w `lumen/src/main/index.ts`); osobną funkcję ma tylko grafika grupy (`groupArt`: wybór gracza,
  potem domyślna z serwera). Okno grafik otwarte w trybie TV zmienia te same grafiki co na pulpicie; tryb TV
  różni się tylko nazwami rodzajów („Okładka”, „Zrzut / tło”) i brakiem ikon. Lumen 1.0.9–1.0.75 trzymał osobne
  wybory TV (`artTv`); przy wczytaniu ustawień przechodzą one do `art` (`mergeTvArt` w
  `lumen/src/main/store/prefs.ts`): wybór tylko w TV — ten wybór, przy obu — nowszy według znacznika czasu.
- **Filtry i sortowanie grupy.** Jeden zapis na grupę (`lumen.filter.<id podgrupy>`, `filterId` w
  `tv/filters.ts`; cała grupa na karuzeli — jej „Wszystkie”, np. `fav/all`) czytany przez `TvGames` i pulpit
  (`screens/Group.tsx`). Filtr instalacji z paska pulpitu to pole „Pokaż” (`local` / `notlocal`), „Sortuj” —
  sortowanie (`title` / `last` / `added` / `time`); oba widoki filtrują i sortują tą samą funkcją `apply`. W oknie
  filtrów TV są więc też „tylko niezainstalowane” (gry EmuStart: „tylko poza cache”) i sortowanie „nowo dodane”.
  Stare osobne zapisy (≤ 1.0.75) są czytane raz: najpierw zapis TV grupy (`oldTvKeys`), bez niego — pulpitu, i od
  razu zapisywane jako wspólny, więc oba widoki widzą to samo.

Skok po literach bierze literę z klucza sortowania gry (`sortName`, bez „The / A / An”). Gry jednej serii stoją
na liście razem pod nazwą serii ([Serie gier](../przeplywy/serie-gier.md)), więc gra w takim bloku liczy się do
litery serii: `TvGames` pobiera klucze bloków przez `placedSeriesKeys(system.games)` — te same, których użyło
`arrangeSeries` przy układaniu grupy — i tylko przy sortowaniu po tytule (inne sortowanie i „Ostatnio grane”
rozrzucają serie, więc tam litera jest z tytułu). Bez tego skok zatrzymywał się w środku bloku serii (zgłoszenie
z listy Amiga WHDLoad). Litery z akcentem spoza polskiego alfabetu (É, Ü, Ø, Æ) liczą się jak litera bazowa, bo
tak sortuje lista; polskie (Ł, Ó…) są osobnymi literami.

Główną akcję gry (X na liście, „Graj” na stronie) wykonuje wspólne `runPrimary` (`lib/primary.ts`): akcja
niedostępna pokazuje powód zamiast działać. „Graj od początku” to `launchFromStart` — to samo w oknie „Opcje gry”.

Wydajność (decyzje z sesji z zacięciami): tło i logo gry wczytują się dopiero ~350 ms po zatrzymaniu wyboru,
wstęga używa małych kopii okładek, a animowane plakaty stają tylko w trakcie przewijania. Gdy wybór stoi,
`usePrefetchLogos` (`gameParts.tsx`) wczytuje do pamięci obrazów logo dwóch gier z każdej strony, więc krok w bok
pokazuje logo od razu; logo bez pliku (HTTP 404) nie jest pobierane ponownie, inny błąd — przy następnym
zatrzymaniu. Miejsce na logo pod listą (`.tv-summary__logo`) ma minimalną wysokość równą wysokości logo, więc
wczytane logo nie przesuwa wstęgi, a długi tytuł nadal może je powiększyć.

Wstęga (`coverflow`): odbicie okładki (motywy z `games.reflection`, np. Horyzont) to odwrócona kopia okładki
(`.tv-flow__mirror` w `TvCoverflow.tsx`) z maską zanikania, a nie `-webkit-box-reflect` — Chromium rysował nim
jedną klatkę, więc odbicie animowanej okładki stało. Kopia używa tego samego adresu obrazu, czyli tego samego
pliku z pamięci obrazów. Tło wybranej gry zajmuje w tym układzie górną połowę ekranu na całą szerokość (bez
powolnego przybliżania, które przycinało boki), z kryciem `var(--tv-flow-backdrop, 0.75)` — motyw może je ustawić;
najwyższa okładka ma 44vh (`--tv-flow-max`).

### Strona gry

`TvGamePage.tsx` otwiera się nad listą (lista zostaje zamontowana, B wraca na tę samą grę). Strona trzyma grę
po identyfikatorze, nie po pozycji na liście: zmiana filtra albo kolejności pod otwartą stroną (np. zdjęcie gry
z Ulubionych, uruchomienie przestawiające „ostatnio grane”) nie podmienia gry, a gra, która wypadła z grupy, jest
brana z całej biblioteki. Strona leży nad wstęgą (`z-index` strony 30, wstęga z `isolation: isolate`). Ma tło gry, logo,
rząd akcji — **Graj** (fokus na start, więc A, A nadal uruchamia grę), **Graj od początku** (gry EmuStart,
`emustart.launch` z `__od_poczatku__`), **Opcje gry…**, **Ulubiona**, a gdy gra je ma, **Dodatki** (GOG) i
**Wersje** (regionalne) — oraz opis i fakty w trzech kartach: „Na tym komputerze”, „Twoja gra”, „O grze”
(`useGameFacts` w `gameParts.tsx`; puste pola pominięte, oceny LaunchBox / Metacritic / Steam w jednej linii).
„Opcje gry” to wspólne okno `components/GameOptions.tsx`; parametr `start` otwiera je od razu na dodatkach albo
wersjach. Warstwa akcji strony jest modalna, więc lista pod nią nie reaguje na przyciski.

### Motywy wbudowane

`themes.ts` definiuje motywy: `emustart` (domyślny, układ `list`), `fantasy` („Kronika”, `list`) i `sf`
(„Horyzont”, `coverflow` z odbiciem). Motyw to paleta (zmienne CSS), wybór układu listy i własny arkusz
(`theme-css/*.css`, zakres `.tv[data-theme="…"]`); edytor wyglądu działa pod każdym motywem. Motywy z paczek
z serwera opisuje [Motywy trybu TV jako paczki z serwera](../przeplywy/motywy-tv.md); paczki deklarują tylko
`list` albo `coverflow`.

## Sterowanie padem i klawiaturą

`nav/input.ts` zamienia klawiaturę i pad na abstrakcyjne akcje (`confirm`, `back`, `x`, `y`, `lb`…) i rozsyła je
przez stos warstw (`useActions`): ekran, nad nim okna modalne. Warstwa modalna zatrzymuje akcje, więc ekran pod
oknem nie reaguje. Bez obsługi na warstwach działają domyślne: kierunki przesuwają fokus przestrzennie
(`nav/engine.ts`, `nav/spatial.ts`, elementy z `data-nav`, aktywna warstwa = ostatni `[data-layer]`), a
`confirm` klika element z fokusem albo otwiera klawiaturę ekranową dla pola tekstowego. Odpowiedniki klawiatury:
Enter — A, Esc — B, F — X, S — Y, Z — L3, U — R3, Q / E — LB / RB, PgUp / PgDn — LT / RT, O — Start.

## Ustawienia

`screens/Settings.tsx` ma siedem działów (`PAGES`): Wygląd, Biblioteka, Konta i sklepy, Pady i sterowanie,
Zachowanie i dane (z Deckiem), Aktualizacja i Zaawansowane. Dawne identyfikatory sekcji (np. `deck` z menu
Decka) prowadzą do nowych działów przez `PAGE_OF`, a fokus trafia od razu na tę sekcję (`data-section`). Każde
przejście między działami (`goToPage`, np. „Przejdź do Zaawansowane”) ustawia fokus w nowym dziale — przycisk,
który był wybrany, znika razem z poprzednim działem, a pad musi mieć gdzie wrócić. **Zaawansowane** zbiera pola, w które wpisuje się klucze
i identyfikatory (Steam Web API i inne SteamID64, SteamGridDB, IGDB, TheGamesDB, przenoszenie kluczy, własna
aplikacja Azure dla Xbox); na górze jest opis, co i dlaczego przeniesiono, a w dawnych miejscach odnośnik
„przeniesione do Zaawansowane” (`AdvancedNote`). Przy każdym kluczu jest zwinięty poradnik
(`components/KeyGuide.tsx`) z linkiem do pełnego poradnika na wiki GitHub i do strony usługi; linki otwiera
`app.openExternal` (tylko `https://`, przeglądarka bez uprawnień administratora). W trybie TV dział Wygląd ma
przyciski „Motyw…” i „Wygląd…” (zdarzenie `lumen:tv-open` obsługiwane w `TvApp`), a menu Start jest krótsze:
Ustawienia, Motyw, Zmień profil, Tryb pulpitu, Zadania, Wyjdź.

## Kopiuj i wklej

- Prawy przycisk myszy w oknie głównym: Wytnij / Kopiuj / Wklej / Zaznacz wszystko w polach tekstowych, Kopiuj
  przy zaznaczonym tekście (`main/editMenu.ts`; pasek menu okna jest wyłączony, więc Electron sam takiego menu
  nie daje). Deck ma własne menu prawego klawisza.
- Klawiatura ekranowa (`components/TextField.tsx`, `OnScreenKeyboard`): Ctrl+V / Shift+Insert, klawisz „Wklej”
  i RB na padzie wklejają schowek jako jedną linię bez spacji na brzegach; Ctrl+C / Ctrl+X nie działają dla haseł
  i kluczy.
- Tekst do czytania (opisy, wartości szczegółów i ustawień) da się zaznaczyć myszą; przyciski i listy — nie
  (`user-select` w `styles.css` i `tv/tv.css`).

## Testy

`lumen/tests/themes.test.ts` (motywy, odstępy wstęgi i płaskiego rzędu plakatów), `lumen/tests/letters.test.ts`
(skok po literach), `lumen/tests/nav.test.ts` (mapowanie klawiatury i pada). Opis dla gracza: wiki GitHub,
strona „Lumen-tryb-TV” (źródło `lumen/docs/wiki/Lumen-tryb-TV.md`).
