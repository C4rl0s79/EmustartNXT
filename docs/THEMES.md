# Motywy trybu TV

Motyw zmienia wygląd i układ trybu TV. Wybór: **Menu → Motyw**. Przechodzenie po liście od razu
pokazuje motyw na całym ekranie, **A** go ustawia, a **B** wraca do motywu w użyciu. Wybór jest
zapisany w ustawieniach Lumen (`Settings.tvTheme`), osobno od „Wyglądu” EmuStart. Wygląd jest
wspólny z samodzielnym EmuStart i motyw go nie zmienia.

## Warstwy

| Warstwa | Gdzie | Co |
|---|---|---|
| 1. Paleta | `src/renderer/src/tv/themes.ts` → `palette` | kolory jako zmienne CSS na `.tv`; kontrast pilnują testy |
| 2. Warianty | `themes.ts` → `games.layout`, `games.reflection`, `ambient`, `logoTint` | przetestowane układy: lista (`list`) albo wstęga okładek (`coverflow`), odbicie, ruchome tło (`embers`, `stars`), logo platform przemalowane na barwę motywu (`--tv-logo-fill`) |
| 3. Arkusz motywu | `src/renderer/src/tv/theme-css/<id>.css` | własne style, zawsze w zakresie `.tv[data-theme='<id>']`; tylko motywy wbudowane |
| Edytor „Wygląd” | `look.ts`, `TvLook.tsx` | **osobny dla każdego motywu**; klucze z `locks` motywu są w nim ukryte, żeby nie było ustawień, które nic nie robią |

## Wygląd per motyw i czcionki

- Każdy motyw ma własny „Wygląd”: rozmiary, czcionki, wysokości. Zmiana w Kronice nie dotyka EmuStart ani Horyzontu.
  - **EmuStart:** zapisuje się jak dotąd we wspólnym „Wyglądzie” z samodzielnym EmuStart. W ustawieniach Lumen (`Settings.tvLooks.emustart`) zapisują się tylko klucze Lumena, czyli czcionki, bo EmuStart ich nie zna.
  - **Pozostałe motywy:** zapisują cały wygląd w `Settings.tvLooks.<id>`. Zapisane jest tylko to, co różni się od ustawień domyślnych motywu.
- **„Czcionka tekstu” i „Czcionka nagłówków”:** każdy motyw oferuje swoją listę krojów (`themes.ts` → `fonts`, pierwszy jest domyślny), a w każdej jest Atkinson Hyperlegible, krój zaprojektowany dla najlepszej czytelności. Wszystkie kroje są wbudowane (`look.ts` → `FONTS`).
- **Jeden wzór rozmiaru** dla wszystkich motywów: `clamp(18px, 2,2vh, 64px)` × „Cały interfejs” — ok. 24 px przy 1080p, ok. 48 px przy 4K (czytelne z ok. 3 m).
- **Bezpieczna ramka (overscan):** górny pasek, treść i podpowiedzi trzymają `--tv-safe-x` (5vw) od boków i `--tv-safe-y` (3vh) od góry i dołu; tło i grafiki mogą sięgać krawędzi.
- **Zaznaczenie bez własnego koloru motywu** (lista w EmuStart, menu i „Wygląd” tam, gdzie motyw ich nie nadpisuje): pasek zaczyna się od akcentu przyciemnionego o 25% (`--tv-sel-start`) i kończy na `--tv-accent-soft`; biały tekst ma ≥ 4,5:1 na obu końcach dla każdego akcentu i tła z „Wyglądu” (`tests/selContrast.test.ts`).
- **Wyrównana wysokość małych liter** (`font-size-adjust: 0.52`): ta sama wielkość daje podobnie duży tekst w Segoe, Alegrei czy Exo 2. Nagłówki zachowują proporcje swojego kroju.

## Kontrakt (pad musi zawsze działać)

- Zaznaczona gra jest wyraźnie oznaczona: wiersz-baner na liście, obwódka w kolorze akcentu we wstędze.
- Górny pasek i pasek podpowiedzi zostają na swoich miejscach i są widoczne.
- Kontrast tekstu i zaznaczenia wynosi co najmniej 4,5:1, a akcentu co najmniej 3:1 (`tests/themes.test.ts`).
- Ruch (tło, przewijanie, dryf grafiki) zatrzymuje się, gdy w Windows włączone jest ograniczanie animacji.

## Wbudowane motywy

- **EmuStart:** dotychczasowy wygląd; kolory i rozmiary z edytora „Wygląd”.
- **Kronika (fantasy):** układ listy jak w EmuStart.
  - złocony baner zaznaczenia i iskry w tle;
  - okładka i zrzut w gotyckich łukach ze złotą ramą i maswerkiem;
  - opis na papirusie: atrament, inicjał, drewniane wałki;
  - logo platform w złocie;
  - czcionki Cinzel (nazwy, tytuły) i Alegreya (tekst).
- **Horyzont (SF):** pozioma wstęga okładek z odbiciem nad linią światła („horyzont”).
  - pod wstęgą panel z tytułem i opisem (ok. 9 linii) oraz kolumna danych gry;
  - grafika gry w tle, gwiazdy w trzech warstwach, narożniki HUD;
  - logo platform w lodowym gradiencie;
  - czcionki Oxanium i Exo 2.

W obu motywach tekst rośnie z wysokością ekranu: na 4K nie ma limitu 20 px, który ma domyślny wygląd.

**Logo platform:** logo z serwera jest używane jako maska CSS i wypełniane barwą motywu (`SystemLogo.tsx`). Protokół `lumen-art` odpowiada więc z nagłówkiem CORS, bo `mask-image` pobiera grafiki w trybie CORS. Własne grafiki logo dla motywu (pliki per platforma) to możliwe rozszerzenie.

Czcionki są wbudowane w aplikację (`@fontsource-variable/*`), więc Lumen niczego nie pobiera z sieci.

## Wstęga okładek (`TvCoverflow.tsx`)

- **Okładki:** zaznaczona stoi na środku w skali 1,08. Sąsiednie są obrócone o 58° w skali 0,8, każda z własną perspektywą, więc wszystkie boczne wyglądają tak samo.
- **Odstępy:** wyliczone tak, żeby okładki się nie zasłaniały: pierwsza boczna 0,86 W od środka, każda następna 0,55 W dalej, gdzie W to szerokość okładki. Pilnuje tego test.
- **Pad:** ←/→ przesuwa wstęgę, LB/RB skacze o 5 gier, LT/RT do następnej litery. A, X, Y i R3 działają jak na liście.

## Nowy motyw

1. Dopisz motyw do `THEMES` w `themes.ts`: id, nazwa, opis, paleta, warianty i `locks`.
2. Dodaj `theme-css/<id>.css` (selektory tylko pod `.tv[data-theme='<id>']`) i zaimportuj go w `TvApp.tsx`.
3. Uruchom `npm test`: testy sprawdzą kontrast, poprawność `locks` i odstępy wstęgi.

## Dalej (nie zrobione)

- Animowane grafiki z SteamGridDB: `src/main/art/sgdb.ts` zapytanie wysyła `types: 'static'` i nie dopuszcza GIF-ów. Filtr `epilepsy` musi zostać.
- Stronicowanie list grafik SGDB: dziś pobierana jest tylko pierwsza strona.
- Edytor rozmieszczenia ramek na siatce.
- Motywy z pliku (import przez pad-picker) i synchronizacja przez serwer EmuStart.
- Motyw dla pulpitu.
