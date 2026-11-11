# Instrukcje dla OpenWiki — EmustartNXT

Plik pisany ręcznie; OpenWiki go zachowuje przy każdej generacji. Wiki pisz **po polsku** (jak reszta dokumentacji
projektu: `emustart/docs/`, `emustart/CHANGELOG.md`).

## Repozytorium

Jedno repozytorium dla całego systemu:

- `emustart/` — EmuStart: serwer (`server_main.py`), klient Windows (`main.py`, `web/`), pakiet `emustart/emustart/`,
  aplikacja Android (`android/`, Kotlin), testy `tests/`, dokumentacja `docs/` (w tym `docs/wiki/`).
- `lumen/` — Lumen: launcher Electron + React (`src/main`, `src/renderer`, `src/preload`, `src/shared`) i silnik
  `lumen/engine/` — kopia EmuStart uruchamiana bez okna (`engine_main.py`, `lumen-engine.spec`, moduły `lumen*.py`).
  Kopia jest celowo pominięta w `.openwikiignore`: opisz ją jako kopię `emustart/` i opisz tylko pliki własne silnika.
- `.github/workflows/` — CI EmuStart (Windows, Android).

## Co ma być w wiki (priorytety)

1. Architektura: serwer EmuStart, klient EmuStart na PC, klient Android, Lumen (z silnikiem) — kto z kim rozmawia.
2. Przepływ danych i komunikacja: API `/v1/…` serwera, uwierzytelnianie urządzeń i kont, synchronizacja zapisów,
   biblioteka gier, archiwum GOG, grafiki; most Lumen ↔ silnik (IPC, wywołania `/api/<metoda>`).
3. Instalacja i uruchomienie każdego komponentu (także budowa ze źródeł i wydania: tagi `emustart-v…`, `lumen-v…`).
4. Konfiguracja: pliki konfiguracyjne, zmienne środowiskowe, porty, ścieżki danych, uprawnienia.
5. API, polecenia, protokół i obsługa błędów.
6. Troubleshooting: zapora i sieć LAN, wykrywanie serwera i urządzeń, logi (gdzie leżą), typowe błędy.

## Zasady

- Opisuj tylko to, co jest w kodzie, testach albo istniejącej dokumentacji repozytorium. Nie wymyślaj funkcji,
  endpointów, zmiennych, portów ani kroków instalacji.
- Czego nie da się potwierdzić w kodzie, oznacz dosłownie: **TODO: do weryfikacji**.
- Podawaj ścieżki plików, z których pochodzi informacja.
- Nie przepisuj sekretów, kluczy, tokenów ani adresów prywatnych serwerów z kodu czy dokumentów.
