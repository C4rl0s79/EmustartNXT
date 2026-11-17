---
type: przepływ
title: "Gry GOG z archiwum serwera"
description: "Gry GOG w Lumenie bez GOG Galaxy i bez CDN GOG: archiwum depotów GOG Managera indeksowane na serwerze EmuStart, instalacja chunkami prosto do folderu gry, finalizacja kroków skryptów (rejestr, biblioteki systemowe, Execute) z jednym oknem UAC, uruchamianie (także bez launchera), zapisy przez serwer i odinstalowanie."
tags: [gog, server, lumen, engine, install, uac, saves]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-17T16:11:28.167Z
sources:
  - id: openwiki-source-b06ce04c9f503411e93f380d
    resource: repo://emustart/emustart/gogadmin.py
  - id: openwiki-source-53b1890bf695c580d786793a
    resource: repo://emustart/emustart/gogarchive.py
  - id: openwiki-source-db2d48f235f15661b03b9623
    resource: repo://emustart/emustart/gogexec.py
  - id: openwiki-source-b838c72bfa4df685685e38e9
    resource: repo://emustart/emustart/gogfinal.py
  - id: openwiki-source-b64024bf04376d0b275ac214
    resource: repo://emustart/emustart/goginstall.py
  - id: openwiki-source-4f8116fc21f8acbfcb3dc65d
    resource: repo://emustart/emustart/gogsaves.py
  - id: openwiki-source-8bd3c9138154900e2ed25a05
    resource: repo://lumen/src/main/gog/provider.ts
generated: { by: "claude-code", at: "2026-11-17T16:11:28.167Z" }
---

# Gry GOG z archiwum serwera

Gry GOG nie pochodzą z GOG Galaxy ani z CDN GOG. Archiwum depotów tworzy zewnętrzny program **GOG Manager**
(format `goggui-depot-archive` v1); serwer EmuStart je **tylko czyta**, a klient (silnik w Lumenie albo klient
EmuStart) instaluje grę z chunków pobieranych z serwera. Zainstalowana gra działa bez serwera.

## Serwer: archiwum i indeks (`emustart/emustart/gogarchive.py`)

Układ archiwum (folder `gog_depots_dir` w `config.json` serwera): `archive.json`, `chunks/ab/cd/<compressedMd5>`
(chunk skompresowany zlib), `manifests/depot|dep/…/<id>.json` (manifesty Galaxy v2, w tym zależności `__redist`),
`products/<pid>/<build>.json` (zakres: języki, DLC, depoty) i `.meta.json` (zawiera dane klienta Galaxy — nie są
publikowane).

`build_index` sprawdza dla każdego rekordu stan „complete”, obecność manifestów i **każdego chunka** z rozmiarem,
i liczy `content_hash` buildu. Klient instaluje build przypięty do tego hasha, a serwer wydaje chunki tylko
z przypiętego, nadal zgodnego buildu. Niekompletny rekord nie jest publikowany (panel pokazuje powód); niezmieniony
build bierze się z pamięci indeksu. Zbiory chunków trzyma `ChunkSet` (posortowane tablice skrótów i rozmiarów,
~24 B na chunk). API: `GET /v1/gog/…` ([API /v1](api-v1.md)); funkcja `gog` w `/v1/info` pojawia się, gdy indeks
ma buildy. Panel serwera pokazuje też gry z biblioteki GOG Managera bez rekordu w archiwum („Bez archiwum”).

## Klient: instalacja (`goginstall.py`, `goglib.py`)

`goglib.py` to warstwa gier GOG w kliencie: katalog z serwera z kopią offline, kolejka zadań (instalacja,
wznowienie, DLC, naprawa), stan i uruchamianie; metody `Api.gog_*` wołają tylko ten moduł. Przepływ instalacji
(`goginstall.py`):

1. manifest buildu z serwera (przypięty hashem) + wybór języków i DLC;
2. plan: depoty, kolizje plików między językami, rozmiar, miejsce na dysku;
3. chunk z serwera → MD5 danych skompresowanych → dekompresja (limit = rozmiar z planu) → MD5 danych → zapis
   **wprost w pliku docelowym** pod przesunięciem z planu (bez kopii w TEMP; plik nie jest wcześniej rozciągany
   zerami — to wydłużało start dużych gier);
4. weryfikacja wszystkich plików (MD5 każdego fragmentu) → finalizacja → stan `installed`.

Pamięć: najwyżej `WORKERS * INFLIGHT` chunków naraz. Rejestr instalacji: `<dane>/gog/installs/<pid>.json`
(stan, build, hash, katalog, języki, DLC, pliki, finalizacja), kopia manifestu `<dane>/gog/manifests/<pid>/…`
— weryfikacja i odinstalowanie działają bez serwera. Gry GOG nie należą do pamięci podręcznej gier emulowanych.

## Finalizacja: kroki skryptów gry (`gogfinal.py`, `gogexec.py`, `goginno.py`, `gogadmin.py`)

Instalacja z depotów omija instalator GOG, więc kroki z `goggame-<id>.script` wykonuje EmuStart — tylko znane akcje,
nigdy dowolne programy z manifestu:

- `supportData` (kopie plików w katalogu gry; folder zapisów bez źródła, np. `{app}/cloud_saves`, jest
  wypełniany plikami z `save/` depotu — tylko brakującymi, także przy każdym starcie gry), `setIni`, `setRegistry`
  (HKCU od razu; HKLM — krok administratora), `savePath`;
- `Execute` (`gogexec.py`): typowe skrypty `.cmd` tłumaczone na odwracalne kroki — `REG ADD`, reguła zapory
  `netsh`, `regsvr32`, składnik Windows `DISM` (DirectPlay), `sdbinst -u`; inne programy uruchamiane bez zmian;
- wpisy `[Registry]` z instalatorów Inno `galaxy_*.exe` odczytywane z ich nagłówka bez uruchamiania (`goginno.py`);
- biblioteki systemowe z zależności (`__redist`: Visual C++, DirectX) — osobny, jawny krok administratora (wykrywanie zainstalowanych: `runtime_installed`).

**Kroki administratora** zbiera `gogadmin.py`. Gdy proces ma uprawnienia administratora (zainstalowany Lumen
działa jako administrator), wykonuje je od razu, bez okna. Bez uprawnień zapisuje listę do
`<dane>/gog/admin/<pid>/steps.json` i uruchamia ten sam program z `--gog-admin=<plik>` i `--gog-admin-sha=<skrót>`
przez „runas” — jedno okno UAC na całą listę; skrót w wierszu poleceń chroni przed podmianą pliku między zapisem
a zgodą. Proces podniesiony przyjmuje tylko znane rodzaje kroków (`reg_set`, `reg_put`, `reg_del`) i tylko klucze
`HKLM\Software\…`. Przed wykonaniem `capture` zapamiętuje poprzednie wartości, a deinstalator je przywraca albo
usuwa dodane (`undo_steps`); deinstalator przywraca też HKCU sprzed instalacji, a pliki poza folderem gry
(Dokumenty, AppData) usuwa tylko na wybór gracza.

**Naprawa rejestru `GOG.com\Games` (etap 6, EmuStart 0.66.3 / Lumen 1.0.74).** Wpisy `HKLM\Software\GOG.com\Games\<id>`
(nazwa, ścieżka, plik gry — czytają je PyLinks, łatki i narzędzia GOG) dostaje każda nowa instalacja jako kroki
„compat”. Gry zainstalowane wcześniej (przed Lumenem 1.0.58) ich nie miały. Lumen jako administrator raz przy
starcie woła `gog_repair_registry` (`api.py` → `goglib.repair_registry` → `goginstall.repair_registry`, przed
`gog_admin_pending` / `gog_finish_admin_all` w `lumen/src/main/gog/provider.ts`):
- gra EmuStart, która nigdy nie miała kroków „compat” rejestru, a jej klucz jest niekompletny (brak nazwy, ścieżki
  albo pliku gry, albo ścieżka do innego folderu), dostaje te same kroki co nowa instalacja (`registry_repair_acts`;
  gry z zadaniem w toku — przy następnym starcie);
- martwy klucz gry spoza EmuStart (nie gra EmuStart, nie jej DLC, nie klucz zapisany jej skryptem) — bez `PATH`
  albo z `PATH` do folderu, którego nie ma, gdy jego dysk jest podłączony — jest usuwany od razu
  (`orphan_registry_steps`); usunięte wartości trafiają do `<dane>/gog/admin/removed-keys.json`.
Bez uprawnień administratora (klient EmuStart) wywołanie nic nie robi.

## Uruchamianie

Zadanie gry z `goggame-<id>.info` (`pick_play_task` w `gogfinal.py`): główne zadanie kategorii „game”, potem
dowolne zadanie gry, główne, pierwsze z plikiem; tylko plik `.exe` wewnątrz katalogu gry. Gdy widoczne zadanie
główne to launcher, a plik gry jest **jednym** ukrytym zadaniem „game” (Cyberpunk 2077, Wiedźmin 3 —
REDprelauncher), gra startuje bez launchera; kilka wariantów (np. Resident Evil 2) — launcher zostaje. Launcher
i inne zadania są do wyboru w „Uruchom…” (Lumen, `gog_play_tasks`), gry DOSBox mają też „Uruchom z diagnostyką”
i MIDI per gra ([Klienci EmuStart](../architektura/klienci-emustart.md)). Gra startuje przez `unelevated.popen` —
bez uprawnień administratora. Śledzenie sesji: proces gry albo dowolny proces z plikiem w katalogu gry.

## Zapisy (`gogsaves.py`)

Zapisy i ustawienia gier GOG synchronizuje wyłącznie serwer EmuStart (`savesync`, ten sam mechanizm co zapisy gier
emulowanych: wersje, konflikty, offline). Reguły ścieżek: ręczne gracza → poprawka serwera → ludusavi-manifest
(serwer: `saverules.py`, odświeżany raz na tydzień); dopasowanie po productId. Na serwer idą ścieżki względne
wewnątrz zbioru, więc drugi komputer odtwarza pliki we własnym folderze. Wpisy rejestru nie są synchronizowane.

## Lumen

Gra GOG ma w bibliotece id `gog:<productId>` (`lumen/src/main/gog/provider.ts`); akcje idą kanałami IPC
`lumen/src/main/gog/ipc.ts` do metod `gog_*` silnika ([Most Lumen ↔ silnik](../integracje/most-lumen-silnik.md)).
`LUMEN_DRY_RUN=1` blokuje uruchamianie gier.

## Testy

`emustart/tests/test_gog_*.py` — m.in. instalacja i wznowienie (`test_gog_install`), indeks i chunki
(`test_gog_server`, `test_gog_chunkset`), kroki administratora (`test_gog_admin`), akcje skryptów
(`test_gog_script_actions`, `test_gog_exec`), biblioteki systemowe (`test_gog_runtimes`), start i wybór zadania
(`test_gog_launch`), zapisy początkowe (`test_gog_save_seed`), odinstalowanie (`test_gog_uninstall`).
