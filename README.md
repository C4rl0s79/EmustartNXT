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

## Wiki

[github.com/C4rl0s79/EmustartNXT/wiki](https://github.com/C4rl0s79/EmustartNXT/wiki) — strony dla gracza (Lumen,
EmuStart) i techniczne (z OpenWiki). Źródła są w repozytorium: `lumen/docs/wiki/`, `emustart/docs/wiki/`,
`openwiki/`; na wiki nie edytuj. Publikacja:

```
git clone https://github.com/C4rl0s79/EmustartNXT.wiki.git <folder>
python scripts/publish_wiki.py <folder> --push
```

Po każdym wydaniu: odświeżenie OpenWiki i publikacja wiki — procedura w `AGENTS.md` („Dokumentacja po wydaniu”).
