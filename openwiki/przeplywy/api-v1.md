---
type: przeplyw
title: "API /v1: urządzenia, konta, zapisy i grafiki"
description: "API urządzeń EmuStart Server pod /v1: wymóg HTTPS, logowanie urządzenia (enroll, challenge, token), biblioteka i pliki gier, synchronizacja zapisów, grafiki użytkowników, blokada profilu, folder profili, emulatory i BIOS-y oraz kody błędów."
tags: [api, v1, authentication, devices, savesync, protocol, emustart]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T19:02:08.485Z
sources:
  - id: openwiki-source-e6e190788e03541d74c05a32
    resource: repo://emustart/docs/SAVE_SYNC_DESIGN.md
  - id: openwiki-source-da0d05a6e7df92c8b78ca329
    resource: repo://emustart/emustart/enroll.py
  - id: openwiki-source-e1872d6a09c29595f1544c23
    resource: repo://emustart/emustart/ownart.py
  - id: openwiki-source-39316019f7b366045ad545d4
    resource: repo://emustart/emustart/remote.py
  - id: openwiki-source-a124d623671267edfd450054
    resource: repo://emustart/emustart/server.py
  - id: openwiki-source-453193849f1b78f45db49783
    resource: repo://emustart/emustart/userart.py
  - id: openwiki-source-0249de2a4b6e41f78c81c34c
    resource: repo://lumen/src/main/art/artSync.ts
generated: { by: "claude-code", at: "2026-11-18T00:22:21.680Z" }
---

# API /v1: urządzenia, konta, zapisy i grafiki

API `/v1/…` to jedyny kanał między urządzeniami (klient Windows, aplikacja Android, silnik Lumena)
a [EmuStart Server](../architektura/serwer-emustart.md). Routing jest w `emustart/emustart/server.py`
(`do_GET`, `do_POST`, `do_PUT`, `do_DELETE`), obsługa w `emustart/emustart/remote.py`.

## Transport

- `/v1` działa **tylko połączeniem szyfrowanym** (port TLS z przypiętym certyfikatem, port
  publiczny, tunel); zwykły HTTP tylko z tego samego komputera (`_v1_ok`). Inaczej: **403**.
- Port zwykły i szyfrowany przyjmują tylko LAN/Tailscale/loopback (`_near`); port publiczny tylko
  `/v1/`, `/media/`, `/assets/` z tokenem urządzenia (`emustart/emustart/public.py`).
- Nieznana ścieżka `POST /v1/…` → **404**.
- Serwer używa HTTP/1.1 z utrzymywaniem połączenia (pobieranie bloków gry bez nowego TCP)
  i zamyka bezczynne połączenie po 120 s (`_Handler`).

## Logowanie urządzenia (`emustart/emustart/enroll.py`)

Tożsamość = **konto + konkretne urządzenie**. Każda instalacja ma własną parę kluczy EC P-256;
klucz prywatny nie opuszcza urządzenia (Android Keystore; na Windows TPM, a bez niego klucz
zaszyfrowany DPAPI). Serwer zna tylko klucz publiczny.

```
urządzenie                                   serwer
  │ POST /v1/enroll/request                    │  mode "code": kod logowania (jednorazowy, 10 min)
  │  {mode, login_code | account+password,     │     z panelu („Dodaj urządzenie”) albo strony serwera
  │   name, class, pubkey}                     │  mode "existing": konto + hasło → rid + kod weryfikacyjny
  │                                            │
  │        (tylko "existing")                  │  GET  /v1/enroll/pending   — zatwierdzający widzi prośbę
  │                                            │  POST /v1/enroll/decide    — {id, allow, games}
  │ POST /v1/enroll/poll {rid} ───────────────▶│  → id urządzenia po zatwierdzeniu
  │                                            │
  │ POST /v1/auth/challenge {device} ─────────▶│  → wyzwanie (nonce)
  │ POST /v1/auth/token {device, nonce, sig} ─▶│  → token sesji (1 h)
  │ … Authorization: Bearer <token> …          │
  │ POST /v1/auth/logout ─────────────────────▶│
```

- Kod logowania jest przypisany do konta i zastępuje zatwierdzenie; gdy żadne konto nie jest
  administratorem, konto zalogowane kodem nim zostaje.
- Nowe konto powstaje tylko z zaproszenia (strona serwera) albo w panelu — urządzenie nie zakłada kont.
- Prośba czeka 24 h (zapisana na dysku). Do zatwierdzenia urządzenie widzi tylko stan swojej prośby.
- Administrator zatwierdza wszystko; zwykłe konto — tylko nowe urządzenia swojego konta.
- `POST /v1/enroll/*` i `/v1/auth/{challenge,token,logout}` obsługuje `remote` (`server.py`, `do_POST`);
  na porcie publicznym bez tokenu dostępne są tylko `enroll/request`, `enroll/poll`,
  `auth/challenge`, `auth/token`.

Klient Windows trzyma token w pamięci i odnawia go przed wygaśnięciem
(`netsrc.session_token`); gdy serwer niedawno odmówił (urządzenie nieznane/unieważnione), nie
próbuje od razu ponownie. Inny certyfikat pod adresem serwera → błąd `CertMismatch`
(`emustart/emustart/netsrc.py`).

## GET `/v1/…` (`remote.handle`)

Każde zapytanie musi być autoryzowane (inaczej **401** „brak lub zły klucz serwera”). Wybrane trasy:

| Trasa | Odpowiedź |
|---|---|
| `/v1/info` | nazwa i wersja serwera, `api: 1`, lista `features` (m.in. `library`, `savesync`, `lock`, `themes`, `series`, `collections`; `nas`, `savemgr`, `profiles` przy folderze profili; `gog`, gdy indeks archiwum GOG ma buildy), adresy serwera (`endpoints`), port i odcisk TLS |
| `/v1/library`, `/v1/library?es=…&since=…` | systemy / gry systemu dla komputera bez folderów z grami (403, gdy konto nie pobiera gier) |
| `/v1/systems`, `/v1/systems/<es>/games`, `/v1/games/<id>`, `/v1/games/<id>/file/<ścieżka>` | systemy, gry, szczegóły, plik gry z obsługą `Range` (wiele strumieni, wznawianie) |
| `/v1/find`, `/v1/sysinfo?es=…` | wyszukiwanie gier, opis platformy |
| `/v1/emulators/…`, `/v1/emuprofiles`, `/v1/bios` | emulatory z magazynu serwera (manifest, archiwum), profile emulatorów, BIOS-y |
| `/v1/savesync/<platforma>/<gra>/manifest`, `…/status` | stan paczek zapisów |
| `/v1/nas/scan`, `list`, `stat`, `file` | folder profili (zapisy, ustawienia; plik zstd, nagłówek `X-Mtime`) |
| `/v1/profiles`, `/v1/savemgr/catalog`, `/v1/gog/…` | profile graczy, menedżer zapisów, archiwum GOG |
| `/v1/files/d/<token>` | pobranie paczki zapisów (adres z manifestu), z `Range` |
| `/v1/series`, `/v1/series/progress` | serie gier z IGDB znane serwerowi (z polem `progress`) / sam postęp sprawdzania — zob. [Serie i kolekcje gier](serie-gier.md) |
| `/v1/collections` | kolekcje konta (kategorie Lumena) ze wszystkich jego urządzeń: `{"collections": [{name, games: [game_id]}]}`; konto z tokenu urządzenia albo tokenu profilu (`X-EmuStart-Account` + `X-Profile-Token`) — od 0.67.0, dla APK |
| `/v1/themes/…` | paczki motywów trybu TV Lumena — zob. [Motywy trybu TV](motywy-tv.md) |

## POST / PUT / DELETE

| Trasa | Moduł | Działanie |
|---|---|---|
| `POST /v1/savesync/upload/init`, `upload/commit`, `manifests`, `<platforma>/<gra>/resolve`, `…/slot` | `savesync` | wysyłka paczki zapisów, rozstrzyganie konfliktów, sloty |
| `PUT /v1/files/u/<token>` | `savesync` | treść paczki (adres z `upload/init`) |
| `POST /v1/userart/…` | `userart` | grafiki użytkowników i wybory grafik |
| `POST /v1/series` | `igdbseries` | tytuły spoza biblioteki serwera (gry Steam, skróty) do sprawdzenia w IGDB — na początek kolejki |
| `POST /v1/collections` | `usercollections` | zestaw kolekcji urządzenia (Lumen) `{"items": [{id, name, games}]}` — zastępuje poprzedni zestaw tego urządzenia; zła lista albo `Content-Length` → 400 |
| `POST /v1/lock/take`, `renew`, `release`, `status` | `plock` | jedna gra naraz na profil |
| `PUT`/`DELETE /v1/nas/file?p=…` | `remote` | zapis atomowy pliku w folderze profili (poprzednia wersja do kopii, ostatnie 10) |

## Synchronizacja zapisów (`emustart/docs/SAVE_SYNC_DESIGN.md`)

Serwer jest **jedynym źródłem prawdy** („jak Steam Cloud”): każda paczka ma jedną aktualną rewizję.
Klucz paczki: `konto + platform_id + game_id + emulator_id + core_id + bundle_kind`, gdzie konto
i urządzenie pochodzą z tokenu sesji (nie z treści zapytania; inne konto tylko z jego tokenem
w `X-Profile-Token`), `game_id = savesync.game_id(system, nazwa gry)` jest taki sam na każdym
urządzeniu, `core_id` jest obowiązkowy dla RetroArcha, a `bundle_kind` to `saves`, `states` albo
`memcards`. Paczka to pełny zestaw plików, zmiany wykrywa SHA-256 zestawu. Rozbieżne zmiany
z dwóch urządzeń to **konflikt rozstrzygany przez gracza**; przegrana wersja zostaje w historii
na serwerze.

## Wybory grafik (`emustart/emustart/userart.py`)

`POST /v1/userart/choices` wymienia wybory grafik konta: klient wysyła swoje wybory `{key, choice, at}`, serwer
przyjmuje nowsze (`at`) i oddaje wszystkie wybory konta. Od EmuStart 0.68.0 jest **jeden wybór na grę i rodzaj
grafiki** (klucz `desktop|<gra>|<rodzaj>`), bo pulpit, Deck i tryb TV Lumena pokazują te same grafiki
([Lumen — tryb TV](../architektura/lumen-tryb-tv.md)). Zgodność ze starszymi klientami (Lumen ≤ 1.0.75, klient
EmuStart ≤ 0.67.0), które znały osobne wybory trybu TV:

- klucz `tv|…` z zapytania jest zapisywany jako ten sam wybór `desktop|…` (nowszy wygrywa); pusty wybór `tv|…`
  znaczył „TV bez własnej grafiki” i jest pomijany, więc nie usuwa wspólnej grafiki;
- stare wpisy `tv|…` w indeksie konta są przy synchronizacji łączone z `desktop|…` (nowszy zostaje);
- odpowiedź podaje każdy wybór także pod `tv|…` — tylko w odpowiedzi, nie w danych serwera.

Klient EmuStart (`ownart.py`) wysyła swoje grafiki jako `desktop|…`. Lumen (`lumen/src/main/art/artSync.ts`)
traktuje `tv|…` z serwera jak ten sam wybór i pomija pusty `tv|…`.

## Kody błędów

| Kod | Kiedy |
|---|---|
| 401 | brak lub zły token urządzenia (`remote.handle`) |
| 403 | `/v1` zwykłym HTTP spoza tego komputera; adres spoza LAN/Tailscale; konto bez prawa pobierania gier |
| 404 | nieznana trasa `/v1` (POST) lub `/api` |

Odpowiedzi błędów są w JSON z polem `error` albo `reason`; aplikacja Android rozpoznaje serwer
EmuStart po polu `reason` w odpowiedzi na `POST /v1/auth/challenge`.

## Powiązane

- [EmuStart Server](../architektura/serwer-emustart.md)
- [Klienci EmuStart](../architektura/klienci-emustart.md)
- [Rozwiązywanie problemów](../operacje/rozwiazywanie-problemow.md)
- `emustart/docs/SAVE_SYNC_DESIGN.md`, `emustart/docs/GOG.md`
