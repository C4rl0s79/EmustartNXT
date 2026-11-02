# Motywy trybu TV

Motyw zmienia wygląd i układ trybu TV. Wybór: **Menu → Motyw**. Przechodzenie po liście od razu
pokazuje motyw na całym ekranie, **A** go ustawia, a **B** wraca do motywu w użyciu. Wybór jest
zapisany w ustawieniach Lumen (`Settings.tvTheme`), osobno od „Wyglądu” EmuStart. Wygląd jest
wspólny z samodzielnym EmuStart i motyw go nie zmienia.

## Warstwy

| Warstwa | Gdzie | Co |
|---|---|---|
| 1. Paleta | `src/renderer/src/tv/themes.ts` → `palette` | kolory jako zmienne CSS na `.tv`; kontrast pilnują testy |
| 2. Warianty | `themes.ts` → `games.layout`, `games.reflection`, `ambient` | przetestowane układy: lista (`list`) albo wstęga okładek (`coverflow`), odbicie, ruchome tło (`embers`, `stars`) |
| 3. Arkusz motywu | `src/renderer/src/tv/theme-css/<id>.css` | własne style, zawsze w zakresie `.tv[data-theme='<id>']`; tylko motywy wbudowane |
| Edytor „Wygląd” | `look.ts`, `TvLook.tsx` | działa pod każdym motywem; klucze z `locks` motywu są w nim ukryte, żeby nie było ustawień, które nic nie robią |

## Kontrakt (pad musi zawsze działać)

- Zaznaczona gra jest wyraźnie oznaczona: wiersz-baner na liście, obwódka w kolorze akcentu we wstędze.
- Górny pasek i pasek podpowiedzi zostają na swoich miejscach i są widoczne.
- Kontrast tekstu i zaznaczenia wynosi co najmniej 4,5:1, a akcentu co najmniej 3:1 (`tests/themes.test.ts`).
- Ruch (tło, przewijanie, dryf grafiki) zatrzymuje się, gdy w Windows włączone jest ograniczanie animacji.

## Wbudowane motywy

- **EmuStart:** dotychczasowy wygląd; kolory i rozmiary z edytora „Wygląd”.
- **Kronika (fantasy):** układ listy jak w EmuStart. Złocony baner zaznaczenia, oprawione okładka i zrzut, iskry w tle. Czcionki Cinzel (nazwy, tytuły) i Alegreya (tekst).
- **Horyzont (SF):** pozioma wstęga okładek z odbiciem nad linią światła („horyzont”). Grafika gry na całym ekranie, gwiazdy w trzech warstwach, narożniki HUD. Czcionki Oxanium i Exo 2.

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
