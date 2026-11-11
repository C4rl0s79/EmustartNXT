---
type: integracja
title: "Most Lumen ↔ silnik EmuStart"
description: "Jak Lumen uruchamia silnik EmuStart (EmuStartEngine.exe albo engine_main.py), uzgadnia port przez stdout, zabezpiecza wywołania tokenem sesji, woła POST /api/<metoda>, odbiera zdarzenia i restartuje silnik; pliki własne silnika i relacja kopii lumen/engine do emustart/."
tags: [lumen, engine, ipc, integration, emustart, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-11T20:46:08.589Z
sources:
  - id: openwiki-source-40546d6d119f4cf5e98eb99f
    resource: repo://emustart/emustart/clientdist.py
  - id: openwiki-source-d75b88eab7851fe64f602a5c
    resource: repo://emustart/emustart/updater.py
  - id: openwiki-source-931c6505100c05d7a9b392d9
    resource: repo://lumen/engine/emustart/lumen.py
  - id: openwiki-source-9733b1fd9c40323c5ddf4535
    resource: repo://lumen/engine/engine_main.py
  - id: openwiki-source-2df32bc926e05bf8be1063ec
    resource: repo://lumen/src/main/emustart/engine.ts
  - id: openwiki-source-d1b9ce3766cc38562686f8ba
    resource: repo://lumen/src/main/index.ts
generated: { by: "claude-code", at: "2026-11-11T20:46:08.589Z" }
---

# Most Lumen ↔ silnik EmuStart

Lumen nie przepisuje logiki EmuStart na TypeScript. Uruchamia klienta EmuStart jako **silnik bez okna**
(`lumen/engine/`) i woła jego metody lokalnym HTTP. Po stronie Lumena odpowiada za to
`EmustartEngine` (`lumen/src/main/emustart/engine.ts`), po stronie silnika — `engine_main.py`
i `LumenApi` (`lumen/engine/emustart/lumen.py`).

## Który silnik startuje

`resolveEngineCommand` (`engine.ts`):

1. wersja zbudowana: `resources\engine\EmuStartEngine\EmuStartEngine.exe` (PyInstaller,
   `lumen/engine/lumen-engine.spec`, bez pywebview);
2. ze źródeł: `engine/engine_main.py` uruchamiany Pythonem z ustawienia Lumena (Ustawienia → EmuStart),
   zmiennej `LUMEN_PYTHON`, a domyślnie przez `py -3` (Windows) / `python3`;
3. brak obu → stan `missing` z komunikatem „Nie znaleziono silnika EmuStart…”.

Przed startem Lumen sprawdza, czy z tego samego folderu danych nie korzysta już samodzielny EmuStart
(`emustartRunningFrom`) — wtedy stan `error` i prośba o zamknięcie go albo zmianę folderu.

## Start i handshake

`EmustartEngine.start()` uruchamia proces bez okna (`windowsHide`) ze zmiennymi:

| Zmienna | Znaczenie |
|---|---|
| `EMUSTART_HOME` | katalog danych silnika — ustawienie `emustartHome` albo domyślnie `<LumenData>\emustart` (`src/main/index.ts`) |
| `LUMEN_ENGINE_TOKEN` | losowy token sesji (24 bajty, hex), maskowany w logach Lumena (`registerSecret`) |
| `LUMEN_WINDOW_TITLE` | tytuł okna Lumena — menu w grze i powrót po grze wyciągają je na wierzch |
| `TEMP`, `TMP` | katalog `tmp` w danych Lumena |
| `PYTHONIOENCODING=utf-8`, `PYTHONUNBUFFERED=1` | wyjście silnika bez buforowania |

Silnik (`engine_main.py`, `main()`):

1. ustawia `server.ENGINE_TOKEN` z `LUMEN_ENGINE_TOKEN`, tworzy `LumenApi`;
2. startuje lokalny serwer HTTP na `127.0.0.1` z losowym portem (`server.start(0, dev_api=api)`);
3. wypisuje na stdout pierwszą linię `{"lumen_engine": 1, "port": …, "version": …}`;
4. w osobnym wątku czyta stdin — **EOF (zamknięcie Lumena, także awaryjne) kończy silnik**
   (`api._shutdown()`, potem `os._exit(0)`).

Lumen czyta stdout linia po linii (`onLine`): linia z `lumen_engine` i `port` → stan `ready`; linie
`{"lumen_event": …}` → zdarzenie `event`; inne linie (wyjście bibliotek) są ignorowane. Brak
handshake'u w **45 s** → proces jest zabijany.

Domyślnie silnik dopisuje `--pady=browser`: pady w interfejsie obsługuje Lumen (XInput), a menu
w grze (LB + A) zostaje w EmuStart.

## Wywołania `POST /api/<metoda>`

`EmustartEngine.call(method, args, timeoutMs = 30000)`:

- tylko w stanie `ready`; nazwa metody musi pasować do `^[a-z][a-z0-9_]*$`;
- `POST http://127.0.0.1:<port>/api/<metoda>`, treść = lista argumentów JSON, nagłówki
  `X-EmuStart: 1` i `X-Lumen-Token: <token>`;
- HTTP ≠ 2xx → `EngineError("EmuStart: <metoda> → HTTP <kod>")`; przekroczenie czasu →
  „EmuStart nie odpowiada (<metoda>).”;
- `LUMEN_DRY_RUN=1` blokuje `launch` i `configure_emulator` (tryb testowy).

Po stronie silnika `/api` przyjmuje zapytanie tylko z loopbacku, z poprawnym `Host`, z `X-EmuStart: 1`,
a gdy ustawiono `ENGINE_TOKEN` — także z pasującym `X-Lumen-Token` (porównanie stałoczasowe; opis
w `lumen/docs/INTEGRATION.md` §2). Metody to `Api` z EmuStart oraz zestawienia `lumen_*` z `LumenApi`
(m.in. `lumen_library`, `lumen_status`, `lumen_game_options`, `lumen_readiness`, `lumen_controllers`).

Akcje dostępne dla interfejsu React są wystawione kanałami IPC w `lumen/src/main/emustart/ipc.ts`
(lista dozwolonych akcji: gry, opcje gry, zapisy i stany, konto, profile); renderer nie woła silnika
bezpośrednio. Bibliotekę i stan z silnika (z kopią offline) zestawia `provider.ts`, a model EmuStart
→ wspólny `Game` mapuje `mapping.ts`.

## Awaria i zatrzymanie

- Proces zakończył się sam, gdy był `ready` → do **3** restartów z narastającą przerwą
  (1,5 s × numer próby); potem stan `error`. Brak modułów Pythona (`No module named …`) daje
  komunikat z poleceniem `pip install -r engine/requirements.txt`.
- `stop()` zamyka stdin silnika (silnik kończy zadania, np. wysyłkę zapisów) i po 8 s zabija proces.
- `restart()` = `stop()` + wyzerowanie licznika + `start()`; Lumen restartuje silnik m.in. po zmianie
  ustawień `emustartEnabled`, `emustartHome` lub `pythonPath`.

## Pliki własne silnika i kopia `emustart/`

`lumen/engine/` to kopia `emustart/` (pierwotnie `git subtree`, `lumen/engine/UPSTREAM.md`). Pliki
istniejące tylko w silniku:

| Plik | Rola |
|---|---|
| `engine_main.py` | start bez okna, handshake, koniec po EOF na stdin; `--diag-controllers` (diagnostyka padów) |
| `lumen-engine.spec` | budowa `EmuStartEngine.exe` (`npm run build:engine`) |
| `emustart/lumen.py` | `LumenApi` — zestawienia dla biblioteki, zadań i opcji gry, urządzenie „Lumen” na serwerze |
| `emustart/lumen_discs.py` | łączenie gier wielopłytowych w kopii biblioteki |
| `emustart/lumen_hide.py`, `emustart/lumen_pads.py` | ukrywanie gier, kontrolery i ich profile |
| `tests/test_lumen_*.py` | testy plików własnych (`npm run test:engine`) |

Według `lumen/docs/INTEGRATION.md` w silniku zmienione są też wspólne pliki: `emustart/paths.py`
(katalog danych z `EMUSTART_HOME`) i `emustart/server.py` (`X-Lumen-Token`). `.openwikiignore`
pomija kopie wspólnych plików, więc ta wiki opisuje je tylko na podstawie `INTEGRATION.md`.

### Stan kopii (sprawdzony w historii git, 2026-11-11)

- **Przy przenosinach do EmustartNXT (2026-11-10)** obie kopie miały EmuStart 0.62.0 i różniły się
  tylko zamierzonymi zmianami silnika w `paths.py` i `server.py`.
- **Po przenosinach** poprawki funkcji EmuStart 0.63.x (pad, indeks archiwum GOG, nazwy kolekcji)
  wprowadzano w obu kopiach w tych samych commitach. Numer wersji silnika (`__init__.py`) zostaje 0.62.0
  i nie jest podbijany przy wydaniach EmuStart.
- **Rozjazd z przenosin:** commit, który przestawił aktualizatory na EmustartNXT, zmienił
  `emustart/emustart/updater.py` i `emustart/emustart/clientdist.py` (tagi `emustart-v…`/`lumen-v…`,
  lista wydań), ale nie ich kopie w silniku — tam wciąż są dawne repozytoria `C4rl0s79/EmuStart`
  i `C4rl0s79/Launcher`. Lumen aktualizuje się własnym `updater.ts`, więc nie dotyczy to aktualizacji
  Lumena. Rozjazd nie ma dziś skutku: `lumen/src` nie woła metod `app_update_*` silnika (aktualizator
  EmuStart), a `clientdist` używa tylko panel serwera (`srvadmin.py`), którego silnik nie uruchamia.
- `lumen/engine/UPSTREAM.md` jest nieaktualny od przed przenosin (podaje v0.54.3 i
  `git subtree pull --prefix engine` ze starego repozytorium Launcher); w monorepo zmiany przenosi się
  ręcznie między `emustart/` i `lumen/engine/` (różne końce linii: LF i CRLF).

## Powiązane

- [Lumen — launcher Electron](../architektura/lumen.md)
- [Klienci EmuStart](../architektura/klienci-emustart.md)
- [Rozwiązywanie problemów](../operacje/rozwiazywanie-problemow.md) (silnik nie startuje)
