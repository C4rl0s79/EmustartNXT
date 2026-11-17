---
type: przepływ
title: "Motywy trybu TV jako paczki z serwera"
description: "Motywy trybu TV Lumena jako paczki .zip wgrywane w panelu serwera EmuStart: zawartość i zasady sprawdzania (themes.py), API /v1/themes, synchronizacja silnika do LumenData/themes, protokół lumen-theme://, bezpieczne wstawianie layers.html i poziomy animacji."
tags: [lumen, themes, tv-mode, server, security, sync]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T23:16:42.429Z
sources:
  - id: openwiki-source-440e015926744b0614a1b597
    resource: repo://emustart/emustart/themes.py
  - id: openwiki-source-6b342b77a0702cf1f98d8bb5
    resource: repo://lumen/src/main/themes.ts
  - id: openwiki-source-b688504e9e4eff8e37a598ee
    resource: repo://lumen/src/renderer/src/lib/themeLayers.ts
  - id: openwiki-source-3e83ad3e84c0b4bfbc76fbec
    resource: repo://lumen/src/renderer/src/tv/usePackages.ts
generated: { by: "claude-code", at: "2026-11-17T16:11:28.167Z" }
---

# Motywy trybu TV jako paczki z serwera

Oprócz motywów wbudowanych ([Lumen — tryb TV](../architektura/lumen-tryb-tv.md)) tryb TV Lumena przyjmuje motywy
z **paczek `.zip`**, które administrator wgrywa w panelu serwera EmuStart. Każde urządzenie z Lumenem pobiera je
z serwera. Przewodnik autora motywu: `lumen/docs/themes/README.md` (przykład: `lumen/docs/themes/portal-nexus/`
z generatorami w `lumen/docs/themes/tools/`).

## Zawartość paczki

| Plik | Co |
|---|---|
| `theme.json` | opis: id, nazwa, wersja, paleta, układ listy (`list` / `coverflow`), czcionki, blokady edytora „Wygląd”, ruch tła, domyślne grafiki kategorii… |
| `theme.css` | wygląd zawężony do `.tv[data-theme="<id>"]` |
| `layers.html` | opcjonalnie: dekoracje (cząsteczki, poświaty) — bez skryptów |
| `assets/…` | obrazy (png, jpg, webp, gif, svg) i czcionki (woff2) |

## Sprawdzanie (`emustart/emustart/themes.py`)

Lumen działa jako administrator, więc motyw nie może wnieść kodu ani zasobów spoza paczki. Zasady:

- tylko powyższe pliki, ścieżki wewnątrz paczki, limity rozmiaru (zip do 64 MB, plik do 16 MB, do 400 plików,
  rozpakowane do 128 MB); id `^[a-z0-9][a-z0-9-]{0,39}$`, bez id wbudowanych (`emustart`, `fantasy`, `sf`);
- CSS bez `@import`, `expression(`, `behavior:`, `-moz-binding`, `javascript:`; `url()` tylko do `assets/…`,
  `data:image/…`, `data:font/…` albo `#id`;
- `layers.html` — tylko dozwolone znaczniki i atrybuty, obrazy wyłącznie z `assets/`;
- SVG bez skryptów, `foreignObject`, zdarzeń `on…` i odwołań na zewnątrz;
- paleta czytelna z kanapy: tekst, tekst przygaszony i zaznaczenie co najmniej 4,5:1, akcent 3:1.

Na serwerze motyw leży w `<serwer>/themes/<id>/`, a indeks w `<serwer>/themes/index.json` (id, nazwa, wersja,
pliki z SHA-256).

## Przepływ

1. **Panel serwera** (`emustart/web/server.html`, `server.js`) — wgranie paczki; `themes.py` sprawdza ją i zapisuje.
2. **API:** `GET /v1/themes` — indeks; `GET /v1/themes/<id>/<plik>` — plik, tylko z indeksu
   (`remote._themes`; zob. [API /v1](api-v1.md)). Serwer ogłasza funkcję `themes` w `/v1/info`.
3. **Silnik w Lumenie** (`themes_sync`, ta sama `themes.py` w kopii silnika): pobiera tylko zmienione pliki, każdy
   zgodny z SHA-256 z indeksu, i sprawdza cały motyw tymi samymi zasadami co serwer — do `LumenData/themes/<id>/`.
4. **Proces główny Lumena** (`lumen/src/main/themes.ts`): synchronizacja po starcie silnika i co 30 minut, lista
   motywów dla interfejsu i pliki przez protokół `lumen-theme://` — wyłącznie pliki z listy paczki
   (`.theme-info.json`), ścieżka sprawdzana jeszcze raz. Postęp synchronizacji widać jako pasek „motywy TV”
   (`serverActivity`).
5. **Interfejs** (`tv/usePackages.ts`, `tv/themes.ts`): motywy „z serwera” w wyborze motywu, czcionki z paczki;
   dekoracje `layers.html` wstawia `lib/themeLayers.ts`, budując elementy od nowa z listy dozwolonych znaczników
   i atrybutów — nic z paczki nie trafia do strony jako HTML.

## Animacje

Ustawienie `tvAnim` (wył. / niskie / średnie / wysokie) steruje ruchem tła i dekoracji; przy ograniczonym ruchu
w Windows (`prefers-reduced-motion`) animacje są wyłączone bez względu na ustawienie (`usePackages.ts`).

## Testy

`emustart/tests/test_themes.py` (sprawdzanie paczek, serwer), `lumen/tests/themePackages.test.ts`,
`lumen/tests/themeStore.test.ts`, `lumen/tests/themes.test.ts`.
