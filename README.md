# EmustartNXT

Jedno repozytorium projektu EmuStart + Lumen (plan z 3.11.2026: koniec osobnych repozytoriów,
podwójnych wydań i kopii silnika przez `git subtree`).

| Katalog | Co | Skąd (historia zachowana) |
|---|---|---|
| `emustart/` | EmuStart — serwer, klient Windows, aplikacja Android (`android/`) | github.com/C4rl0s79/EmuStart |
| `lumen/` | Lumen — launcher (Electron, React), z Deckiem (interfejs na pulpicie) | github.com/C4rl0s79/Launcher |

Zasada: lokalne pliki (grafiki, logotypy, media) czyta Lumen; silnik EmuStart służy do wymiany
danych z serwerem. Kierunek: klient EmuStart wchłonięty przez Lumena, EmuStart — serwer.

Instrukcje budowania i uruchamiania: `emustart/README.md`, `lumen/README.md`.
