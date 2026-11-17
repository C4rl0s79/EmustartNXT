---
type: przepływ
title: "Serie i kolekcje gier"
description: "Serie gier w Lumenie: serwer EmuStart dopasowuje gry w IGDB (seria = kolekcja, grupa = franczyza, data oryginału), udostępnia wynik przez /v1/series, silnik pobiera go metodą series_sync, a Lumen układa gry jednej serii razem — z kluczem z platformą, kolejnością po dacie oryginału i ręcznymi poprawkami gracza. Od EmuStart 0.67.0 / Lumen 1.0.75 Lumen wysyła swoje kategorie na serwer (/v1/collections), a APK pokazuje „★ Serie” i „★ Kolekcje”."
tags: [series, collections, igdb, server, lumen, android, library, sorting]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T17:27:24.312Z
sources:
  - id: openwiki-source-a03805cf993ff2b37b1a1f8c
    resource: repo://emustart/emustart/igdbseries.py
  - id: openwiki-source-f45e046b1b58142eb978eeae
    resource: repo://emustart/emustart/usercollections.py
  - id: openwiki-source-0249de2a4b6e41f78c81c34c
    resource: repo://lumen/src/main/art/artSync.ts
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
  - id: openwiki-source-65eabe37ea024bbd1d8fe067
    resource: repo://lumen/src/main/series.ts
  - id: openwiki-source-f891089b004ed1194d67eb3d
    resource: repo://lumen/src/shared/series.ts
generated: { by: "claude-code", at: "2026-11-17T19:02:08.485Z" }
---

# Serie i kolekcje gier

Na listach Lumena gry jednej serii stoją razem, pod nazwą serii, w kolejności wydania. Przynależności do serii nie
da się wyczytać z samego tytułu, więc źródłem jest **IGDB** — zapytania robi **serwer EmuStart** swoimi kluczami
(te same co do grafik), a wynik jest jeden dla wszystkich klientów. Bez wyniku IGDB seria powstaje z tytułu,
a ręczne poprawki gracza mają pierwszeństwo.

## Serwer (`emustart/emustart/igdbseries.py`)

- **Dopasowanie** przeniesione z PyLinks Web: warianty nazwy, próg podobieństwa `SERIES_MATCH_MIN = 0.80` (błędna
  seria gorsza niż jej brak), bez modów i forków; dla edycji (GOTY, Director's Cut) gra bazowa z `version_parent`;
  remake / remaster / port dostaje do układania datę oryginału (`order_ts`).
- **Seria = kolekcja, grupa = franczyza:** nazwą serii jest najwęższa kolekcja IGDB z co najmniej dwiema grami,
  a franczyza to grupa nad seriami (`_result`: `name` = kolekcja, `group` = franczyza). Franczyza jako seria łączyła
  niezależne serie (np. „Dungeons & Dragons” — Baldur's Gate, Eye of the Beholder). Gra z samą franczyzą: puste
  `name` — Lumen bierze serię z tytułu.
- **Baza:** `<dane serwera>/series.sqlite`, klucz `system|tytuł` (system EmuStart albo `pc`).
- **Harmonogram:** wątek w tle sprawdza gry serwera (katalog GOG, potem biblioteka emulatorów) 15 minut po
  starcie i raz na dobę; limit IGDB 4 zapytania/s, zapis po każdej porcji; „nie znaleziono” — ponownie po 30 dniach
  (`RECHECK`).
- **API:** `GET /v1/series` — wszystkie znane serie z polem `progress`; `GET /v1/series/progress` — sam postęp;
  `POST /v1/series` — tytuły spoza serwera (gry Steam, skróty) na początek kolejki ([API /v1](api-v1.md)).
  Postęp widać też na karcie grafik w panelu serwera. Bez kluczy IGDB na serwerze serie powstają z tytułów.

## Lumen

**Pobieranie** (`lumen/src/main/series.ts`, `SeriesService`): metoda silnika `series_sync` dosyła tytuły, których
serwer nie zna, i odbiera wynik; zapis w pliku (działa bez serwera). Odświeżanie co 6 godzin, a co 3 minuty, gdy
serwer jeszcze sprawdza tytuły tego Lumena. Wynik trafia do okien **osobnym kanałem** — pełna mapa raz, potem
tylko zmiany — a nie w migawce biblioteki (każda zmiana wysyłała ponad 40 tys. gier do okna i Decka). Postęp:
pasek pod „EmuStart” i Ustawienia → Konta i sklepy → EmuStart → „Serie z IGDB” (z powodem braku serii).

**Rozpoznawanie i układanie** (`lumen/src/shared/series.ts`, czyste funkcje):

- seria **nie miesza platform**: klucz zawiera zakres (`seriesScope` — `steam`, `gog`, skrót albo `es:<system>`);
  mieszanie platform to ręczne grupy;
- klucz bez przedrostków marki („Sid Meier's”, „Tom Clancy's”…), znaków ™®©, z „&” = „and”, a tytuł bez dopisków
  wydania (Gold / Enhanced / Definitive / GOTY Edition, Remastered, HD…);
- seria stoi na liście **pod własną nazwą** (`arrangeSeries`), nie w miejscu pierwszej gry;
  `arrangeSeries` zapamiętuje dla zwróconej listy klucze, pod którymi postawił bloki serii
  (`placedSeriesKeys(lista)`; lista nie z `arrangeSeries` — `undefined`); skok po literach w trybie TV bierze z nich
  literę gry w bloku, więc nie zatrzymuje się w środku serii ([Lumen — tryb TV](../architektura/lumen-tryb-tv.md));
- kolejność (`orderSeries`): miejsce ustawione przez gracza, potem data oryginału z IGDB dla każdej gry, która ją
  ma, gry bez niej — między znane po numerze części (arabskim lub rzymskim), dalej data wydania i tytuł.

**Poprawki gracza** (`prefs.series`, `SeriesPref`): inna nazwa serii, „nie należy do serii”, miejsce w serii,
grupa. Okno „Seria” (`lumen/src/renderer/src/modals/SeriesEditor.tsx`, z Opcji gry): grupa → seria → gry tej
platformy, które gracz ma (jedna pozycja na grę, z rokiem oryginału i źródłem), wybór serii i grupy z listy
z wyszukiwaniem, „Utwórz serię” na miejscu, przesuwanie gry „Wcześniej / Później”.

## Kolekcje kont (od EmuStart 0.67.0, Lumen 1.0.75)

Kategorie Lumena są lokalne, ale ich skład z grami EmuStart trafia na serwer, żeby APK mógł je pokazać.

- **Lumen** (`emuCollections` w `lumen/src/main/art/artSync.ts`, `syncCollections` w `lumen/src/main/index.ts`):
  po każdej synchronizacji grafik (co 10 minut) wysyła własne kategorie (`kind: custom`) z grami EmuStart; gra to
  `sid` = `savesync.game_id(system, nazwa)`, a grupa wersji (`emugrp:`) — wszystkie jej wersje. Kolekcje Steam
  i kategorie bez gier EmuStart nie są wysyłane. Silnik: `collections_sync` → `artsync.collections` →
  `POST /v1/collections`; starszy serwer (404) — tylko wpis w logu.
- **Serwer** (`emustart/emustart/usercollections.py`, plik `<dane serwera>/collections.json`): każde urządzenie konta
  ma własny zestaw; nowy zestaw zastępuje tylko zestaw tego urządzenia (drugi komputer bez tych kategorii ich nie
  kasuje). `GET /v1/collections` łączy zestawy po nazwie (bez wielkości liter, pisownia z najnowszego zestawu), bez
  powtórzeń gier. Nie liczą się urządzenia odwołane ani nieaktywne od 90 dni; zestaw wysłany z tokenem profilu innego
  konta (gracz zalogowany na cudzym komputerze) jest zapisany pod tym kontem i też się liczy.
- **APK** pokazuje serie i kolekcje jako „★ Serie” i „★ Kolekcje” na ekranie systemów (seria = kolekcja IGDB
  z co najmniej dwoma tytułami tego samego systemu) — [Klienci EmuStart](../architektura/klienci-emustart.md).
  Ręczne poprawki serii z Lumena nie trafiają na serwer, więc APK pokazuje serie z IGDB.

## Testy

`emustart/tests/test_igdb_series.py`, `emustart/tests/test_series_sync.py`, `emustart/tests/test_usercollections.py`,
`lumen/tests/series.test.ts`, `lumen/tests/seriesSync.test.ts`, `lumen/tests/prefs.test.ts` (kolekcje dla APK).
