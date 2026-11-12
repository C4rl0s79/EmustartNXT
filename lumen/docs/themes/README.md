# Motywy trybu TV Lumena — jak zrobić własny

Motyw to paczka `.zip` wgrywana w panelu serwera EmuStart (zakładka **Grafiki i opisy → Motywy TV Lumena**). Serwer
sprawdza paczkę przed zapisem; Lumen pobiera nowy lub zmieniony motyw przy najbliższym połączeniu (tylko zmienione
pliki), sprawdza go jeszcze raz i pokazuje w trybie TV: **Start → Motyw** (góra / dół — motyw, lewo / prawo —
animacje). Gotowy przykład: [`portal-nexus/`](portal-nexus/) — spakuj zawartość folderu (albo cały folder) do `.zip`.

## Zawartość paczki

```
theme.json      opis motywu (wymagany)
theme.css       wygląd (wymagany)
layers.html     dekoracje — cząsteczki, poświaty (opcjonalnie)
assets/…        obrazy png / jpg / webp / gif / svg, czcionki woff2
```

Limity: paczka ≤ 64 MB, plik ≤ 16 MB, ≤ 400 plików, po rozpakowaniu ≤ 128 MB. Inne pliki i ścieżki poza paczką —
paczka odrzucona (panel pokazuje powód).

## theme.json

| Pole | Znaczenie |
|---|---|
| `id` | małe litery, cyfry, `-` (do 40). Nie `emustart`, `fantasy`, `sf` (wbudowane). Nowa paczka z tym samym `id` zastępuje poprzednią. |
| `name`, `description`, `author`, `version` | nazwa (do 40 znaków), opis (do 300), autor, wersja (np. `1.0`) |
| `palette` | `bg`, `text`, `dim`, `accent`, `selText`, `selBg` — `#rrggbb`; `panel` — dowolny kolor (`rgba(…)`). Czytelność z kanapy: tekst, tekst przygaszony i zaznaczenie ≥ 4.5:1, akcent na tle ≥ 3:1 — inaczej paczka odrzucona. |
| `games.layout` | `list` (lista tytułów, okładka i zrzut obok) albo `coverflow` (wstęga okładek) |
| `games.reflection` | odbicie okładek na wstędze |
| `logoPlate`, `consoleBackdrop` | logo platform na płytce motywu; zdjęcie konsoli za karuzelą |
| `ambient` | wbudowane ruchome tło: `none`, `embers` (iskry Kroniki), `stars` (gwiazdy Horyzontu) |
| `locks` | klucze edytora „Wygląd”, o których decyduje motyw (ukryte w edytorze), np. `accent`, `bg`, `row` |
| `fonts` | `{ "text": […], "head": […] }` — czcionki do wyboru w edytorze, pierwsza domyślna. Wbudowane: `segoe`, `atkinson`, `manrope`, `bricolage`, `alegreya`, `cinzel`, `exo2`, `oxanium`, albo własne z `fontFaces`. |
| `fontFaces` | własne czcionki: `[{ "name": "orbitron", "file": "assets/fonts/orbitron.woff2" }]` |
| `animations` | poziomy, które motyw obsługuje: `off`, `low`, `med`, `high` |
| `categories` | domyślne grafiki karuzeli (niżej) |

## theme.css

Wszystko zawężaj do `.tv[data-theme='<id>']` — motyw nie może zmienić niczego poza trybem TV. Kolory z palety są
zmiennymi na `.tv`: `--tv-bg`, `--tv-text`, `--tv-dim`, `--tv-accent`, `--tv-sel-text`, `--tv-sel-bg`, `--tv-panel`;
czcionki: `--tv-font`, `--tv-font-head`. Najczęściej motywowane elementy:

| Klasa | Co to jest |
|---|---|
| `.tv-brand`, `.tv-pill` | górny pasek: napis Lumen, pigułki stanu |
| `.tv-syscard`, `.tv-syscard.is-current .sys-plate`, `.tv-sysinfo h1` | karuzela grup / platform i jej podpis |
| `.tv-row`, `.tv-row.sel`, `.tv-row.sel .g`, `.tv-tag` | lista gier, wybrany wiersz |
| `.tv-flow__item`, `.tv-flow__item.sel`, `.tv-flow__title h1` | wstęga okładek |
| `.tv-box .tv-boxart`, `.tv-snap .tv-snapart`, `.tv-info`, `.tv-desc` | okładka, zrzut, fakty, opis |
| `.tv-panel`, `.tv-menulist li.sel` | okna i menu |

Wzór: wbudowane motywy Lumena (`src/renderer/src/tv/theme-css/fantasy.css`, `sf.css`). Bez `!important` — style
motywu i tak są nakładane na właściwe elementy. Niedozwolone: `@import`, `expression(`, `behavior:`,
`-moz-binding`, `javascript:`; `url()` tylko do plików `assets/…` tej paczki, `data:image/…`, `data:font/…` i `#id`.

## layers.html — dekoracje

Wstawiane nad tłem, pod ekranami (`.tv-layers`, bez kliknięć). Tylko struktura i grafika: `div`, `span`, `i`, `b`,
`em`, `strong`, `p`, `img` (`src` tylko z `assets/`), SVG (`svg`, `g`, `path`, `circle`, `rect`, gradienty, rozmycie).
Atrybuty: `class`, `id`, `alt`, wymiary i atrybuty rysowania SVG. **Bez** skryptów, `on…`, `style=""`, odnośników,
`iframe` — paczka z nimi jest odrzucana, a Lumen i tak usuwa je przy wstawianiu. Animuj w `theme.css`.

**Poziomy animacji** (gracz: Start → Motyw → lewo / prawo; „wyłączone” zawsze przy ograniczonym ruchu w Windows):

| `.tv[data-anim]` | Co działa |
|---|---|
| `off` | nic się nie rusza (animacje dekoracji i tła wyłączone) |
| `low` | dekoracje bez klas `lv-med` / `lv-high`, wbudowane tło przygaszone |
| `med` (domyślnie) | dekoracje bez klasy `lv-high` |
| `high` | wszystko |

Oznacz cięższe dekoracje: `<div class="nx-grid lv-med">`, `<div class="nx-sparks lv-high">` (jak w przykładzie).

## categories — domyślne grafiki karuzeli

```json
"categories": {
  "grp:pc": "assets/categories/pc.webp",
  "pc/steam": "assets/categories/steam.webp",
  "grp:konsole@logo": "assets/categories/konsole-logo.png",
  "es:snes": "assets/categories/snes.webp"
}
```

Klucz: grupa biblioteki `grp:<id>` (PC, Konsole…), podgrupa `<grupa>/<podgrupa>` (np. `pc/steam`), platforma
EmuStart `es:<system>`; `@logo` na końcu — logo zamiast tła. Kolejność: własna grafika gracza (X → Grafika grupy)
→ motyw → domyślna z serwera → zdjęcie konsoli.

## Sprawdzenie

1. Spakuj folder do `.zip`, wgraj w panelu serwera — panel pokaże powód, jeśli czegoś nie przyjmie.
2. W Lumenie: tryb TV → Start → Motyw. Motyw z serwera ma dopisek „z serwera”; przy wyborze widać go od razu na
   całym ekranie (A — ustaw, B — wróć).
3. Sprawdź wszystkie poziomy animacji i oba układy ekranów (karuzela, lista gier).
