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
| Y | S | Filtry i sortowanie (zapamiętane dla grupy) |
| L3 | Z | Szukaj w tytułach |
| R3 | U | Ulubiona / usuń z ulubionych |
| LB / RB | Q / E | O stronę |
| LT / RT | PgUp / PgDn | Skok do poprzedniej / następnej litery |
| B | Esc | Wstecz |
| Start | O | Menu |

### Układ listy

Każda grupa może mieć własny układ — **menu Start → „Układ listy”** (A zmienia):

- **z motywu** — układ, który wybrał motyw (domyślnie);
- **Lista** — tytuły w kolumnie, okładka i zrzut ekranu obok (wygodna przy tysiącach gier emulatora);
- **Wstęga** — okładki w perspektywie, wybrana na środku;
- **Plakaty** — logo gry na jej tle w lewym górnym rogu, płaski rząd plakatów na dole; kropka na plakacie
  pokazuje stan (zielona — gotowa do gry, niebieska — pobieranie albo w grze).

## Strona gry

A na liście otwiera stronę gry: tło gry, logo, przyciski i opis z miejscem do czytania.

- **Graj** (fokus od razu tutaj — A, A uruchamia grę), **Graj od początku** (gry EmuStart: bez wczytania stanu),
  **Opcje gry…** (emulator, wersje, zapisy, grafiki, seria, kategorie…), **Ulubiona**, a gdy gra je ma —
  **Dodatki** (GOG) i **Wersje** (regionalne).
- Szczegóły w trzech kartach: **Na tym komputerze** (stan, rozmiar, emulator, zapisy), **Twoja gra** (ostatnio,
  czas gry, uruchomienia), **O grze** (rok, gatunek, producent, wydawca, gracze, wiek, oceny w jednej linii).
- X — Graj, Y — Opcje gry, R3 — Ulubiona, B — z powrotem na listę, na tę samą grę.

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
