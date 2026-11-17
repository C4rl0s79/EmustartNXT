---
type: architektura
title: "Lumen — tryb TV i ustawienia"
description: "Układ TV Lumena: ekrany (systemy, podgrupy, lista gier, strona gry), trzy układy listy (lista, wstęga, plakaty) wybierane dla grupy, motywy wbudowane, sterowanie padem, Ustawienia w siedmiu działach z „Zaawansowane”, kopiuj / wklej."
tags: [lumen, tv-mode, react, navigation, settings, themes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T23:16:42.429Z
sources:
  - id: openwiki-source-e868c5f48de252372a102b58
    resource: repo://lumen/src/main/editMenu.ts
  - id: openwiki-source-21c4358c86ff6f976f631820
    resource: repo://lumen/src/renderer/src/screens/Settings.tsx
  - id: openwiki-source-e080b6221e297cf7c50b630e
    resource: repo://lumen/src/renderer/src/tv/gameParts.tsx
  - id: openwiki-source-995bad65fd78393a2ee6c0bb
    resource: repo://lumen/src/renderer/src/tv/themes.ts
  - id: openwiki-source-6557b9db6c3c9c21c234f34c
    resource: repo://lumen/src/renderer/src/tv/TvGamePage.tsx
  - id: openwiki-source-7ebb2eee42acf299ab5362e6
    resource: repo://lumen/src/renderer/src/tv/TvGames.tsx
generated: { by: "claude-code", at: "2026-11-16T23:16:42.429Z" }
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
pulpitu), Y — filtry i sortowanie (`TvFilters`, zapamiętane dla grupy), L3 — szukaj, R3 — ulubiona, LB / RB —
o stronę, LT / RT — skok po literach (`letters.ts`, według klucza sortowania), Start — menu.

Wydajność (decyzje z sesji z zacięciami): tło i logo gry wczytują się dopiero ~350 ms po zatrzymaniu wyboru,
wstęga używa małych kopii okładek, a animowane plakaty stają tylko w trakcie przewijania.

### Strona gry

`TvGamePage.tsx` otwiera się nad listą (lista zostaje zamontowana, B wraca na tę samą grę). Ma tło gry, logo,
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
Decka) prowadzą do nowych działów przez `PAGE_OF`. **Zaawansowane** zbiera pola, w które wpisuje się klucze
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
