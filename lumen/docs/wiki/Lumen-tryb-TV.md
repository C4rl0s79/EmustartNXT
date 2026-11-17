# Lumen — tryb TV

Tryb TV jest dla pada i dużego ekranu. Każdy ekran ma na dole pasek z przyciskami, które w danej chwili działają.

## Lista gier

Po wybraniu grupy (np. PC → Steam albo system emulatora) pokazuje się lista gier. Przy wybranej grze jest tylko
**logo** (albo tytuł) i **jedna linia**: stan (● zainstalowana / pobrana / na serwerze), czas gry albo
„jeszcze nie grana”, rok i system. Wszystkie szczegóły są na **stronie gry**.

| Przycisk | Klawiatura | Działanie |
|---|---|---|
| A | Enter | **Strona gry** (szczegóły i wszystkie opcje) |
| X | F | **Graj** od razu, bez wchodzenia na stronę gry |
| Y | S | Filtry i sortowanie (zapamiętane dla grupy — te same co na pulpicie) |
| L3 | Z | Szukaj w tytułach |
| R3 | U | Ulubiona / usuń z ulubionych |
| LB / RB | Q / E | O stronę |
| LT / RT | PgUp / PgDn | Skok do poprzedniej / następnej litery (gry jednej serii stoją razem pod nazwą serii i liczą się do jej litery) |
| B | Esc | Wstecz |
| Start | O | Menu |

### Układ listy

Każda grupa może mieć własny układ — **menu Start → „Układ listy”** (A zmienia):

- **z motywu** — układ, który wybrał motyw (domyślnie);
- **Lista** — tytuły w kolumnie, okładka i zrzut ekranu obok (wygodna przy tysiącach gier emulatora);
- **Wstęga** — okładki w perspektywie, wybrana na środku, nad nimi tło wybranej gry w górnej połowie ekranu; w motywie
  Horyzont okładki mają odbicie (animowane okładki odbijają się razem z ruchem);
- **Plakaty** — logo gry na jej tle w lewym górnym rogu, płaski rząd plakatów na dole; kropka na plakacie
  pokazuje stan (zielona — gotowa do gry, niebieska — pobieranie albo w grze).

### Wspólne z pulpitem

Tryb TV i pulpit to dwa widoki tej samej biblioteki (od Lumena 1.0.76):

- **Grafiki gier** są te same w trybie TV, na pulpicie i w Decku. Zmiana grafiki w **Opcje gry → Grafiki** w trybie
  TV zmienia ją też na pulpicie i odwrotnie. Tryb TV pokazuje okładkę w całości.
- **Filtry i sortowanie** grupy są wspólne: filtr ustawiony na pulpicie działa w trybie TV i odwrotnie. W filtrach
  są też „tylko niezainstalowane” (gry EmuStart: „tylko poza cache”) i sortowanie „nowo dodane”.

## Strona gry

A na liście otwiera stronę gry: tło gry, logo, przyciski i opis z miejscem do czytania.

- **Graj** (fokus od razu tutaj — A, A uruchamia grę), **Graj od początku** (gry EmuStart: bez wczytania stanu),
  **Opcje gry…** (emulator, wersje, zapisy, grafiki, seria, kategorie…), **Ulubiona**, a gdy gra je ma —
  **Dodatki** (GOG) i **Wersje** (regionalne).
- Szczegóły w trzech kartach: **Na tym komputerze** (stan, rozmiar, emulator, zapisy), **Twoja gra** (ostatnio,
  czas gry, uruchomienia), **O grze** (rok, gatunek, producent, wydawca, gracze, wiek, oceny w jednej linii).
- X — Graj, Y — Opcje gry, R3 — Ulubiona, B — z powrotem na listę, na tę samą grę.
- **Skąd opis** (także na stronie gry na pulpicie): sklep Steam, GOG Manager, serwer EmuStart, a dla gier Xbox —
  katalog Microsoft Store; czego tam brak, Lumen bierze z bazy LaunchBox, a gdy nadal nie ma opisu — z Wikipedii
  (polskiej, potem angielskiej). Pod opisem widać, skąd pochodzi. Jeśli opis pasuje do innej gry albo go nie ma,
  wybierz właściwą grę w **Opcje gry… → Grafiki → Zmień dopasowanie gry** (potrzebny
  [klucz SteamGridDB](Klucz-SteamGridDB)) — pod tą nazwą Lumen szuka też opisu.
  Wikipedia przyjmuje tylko kilka zapytań naraz; gdy odmówi, opis pojawi się przy następnym otwarciu gry.

## Ustawienia

Siedem działów zamiast czternastu: **Wygląd** (tryb interfejsu, motyw i wygląd trybu TV), **Biblioteka**
(EmuStart, systemy, szybki dostęp, grafiki, LaunchBox), **Konta i sklepy** (EmuStart, Steam, GOG, Xbox),
**Pady i sterowanie**, **Zachowanie i dane** (w tym Deck), **Aktualizacja** i **Zaawansowane**.

**Zaawansowane** zbiera pola, w które wpisuje się klucze i identyfikatory (Steam Web API, SteamGridDB, IGDB,
TheGamesDB, inne SteamID64, przenoszenie kluczy, własna aplikacja Azure). W miejscach, gdzie były wcześniej, został
odnośnik „przeniesione do Zaawansowane” z przyciskiem, który tam prowadzi. Przy każdym polu jest krótki poradnik
i link do pełnego na tej wiki — [Klucze API](Klucze-API).

## Kopiuj i wklej

Klucze najwygodniej wkleić: skopiuj klucz w przeglądarce (Ctrl+C) i wklej go w polu w Lumenie (Ctrl+V albo prawy
przycisk myszy → Wklej). Na klawiaturze ekranowej (pad) jest klawisz **Wklej**.
