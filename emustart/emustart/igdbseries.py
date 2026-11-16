"""igdbseries — serie gier z IGDB dla Lumena (tryb serwera).

Przeniesione z PyLinks Web (pylinks/services/series.py), gdzie rozpoznawanie serii działało dobrze: z samej nazwy
nie da się wyczytać przynależności do serii („Yakuza 0”, „Yakuza Kiwami” i „Like a Dragon” to jedna seria,
a „Castlevania Judgment” nie należy do „Judgment”). IGDB trzyma to jawnie:
  * franczyza (`franchises`) — najszersza rodzina, kolekcja (`collections`) — podseria; nazwa serii = franczyza,
    a gdy jej brak — najwęższa kolekcja (jak PyLinksDeck: COALESCE(franchise, collection)),
  * `version_parent` — gra bazowa dla edycji (GOTY, Director's Cut),
  * `remakes` / `remasters` / `expanded_games` / `ports` — listy po stronie ORYGINAŁU; remake dostaje datę
    oryginału do układania (order_ts).

Wynik w bazie serwera (`<dane serwera>/series.sqlite`), klucz `system|tytuł` (system EmuStart albo „pc”). Serwer
sam sprawdza swoje gry — katalog GOG, potem bibliotekę emulatorów (`scan_server_games`, przy starcie i raz na dobę);
Lumen pobiera wynik (GET /v1/series) i dosyła tylko tytuły, których serwer nie zna (gry Steam: POST /v1/series).
Wątek w tle: limit IGDB 4 zapytania/s (art_sources.Igdb), zapis po każdej porcji. „Nie znaleziono” — ponownie po
RECHECK.

Decyzja użytkownika 2026-11-16: zapytania do IGDB robi serwer (jego klucze z grafik), wynik jeden dla wszystkich
klientów; ręczne poprawki gracza w Lumenie mają pierwszeństwo, bez wyniku IGDB — seria z tytułu jak dotąd.
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
import time
from collections import deque

log = logging.getLogger("emustart.igdbseries")

SERIES_MATCH_MIN = 0.80          # błędna seria gorsza niż jej brak (PyLinks: „Sim City” ≠ „Russian City Sim”)
RECHECK = 30 * 86400             # „nie znaleziono” — ponownie po miesiącu (IGDB się uzupełnia)
MAX_GAMES = 20000                # jedno pytanie Lumena
_MODS = {5, 12}                  # typy wpisów IGDB: Mod, Fork
_MAIN = 0

_SCHEMA = """CREATE TABLE IF NOT EXISTS series(
    key TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT NOT NULL,
    igdb_id INTEGER, igdb_name TEXT, franchise TEXT, collection TEXT,
    release_ts INTEGER, order_ts INTEGER, similarity REAL, ts REAL NOT NULL)"""

_lock = threading.Lock()
_queue: deque = deque()
_queued: set = set()
_worker: dict = {"thread": None}
CFG = None                       # () → config.json serwera (ustawiane przy pierwszym pytaniu z remote)


_conn: dict = {}


def _db() -> sqlite3.Connection:
    """Jedno połączenie na plik bazy (dostęp pod _db_lock); tabela tworzona raz."""
    from emustart import paths
    path = str(paths.DATA / "series.sqlite")
    con = _conn.get(path)
    if con is None:
        con = sqlite3.connect(path, timeout=10, check_same_thread=False)
        con.execute(_SCHEMA)
        _conn[path] = con
    return con


_db_lock = threading.RLock()


def source_of(platform: str) -> str:
    """„pc” (GOG, Steam, skróty) albo system EmuStart (es) — pierwsza część klucza."""
    p = str(platform or "").strip().lower()
    return "pc" if p in ("", "pc", "windows", "steam", "gog") else p


def platform_of(platform: str) -> str:
    """Źródło gry → nazwa platformy jak w art_sources (PC, SNES, PS1…) — do wyboru wydania w IGDB."""
    p = source_of(platform)
    if p == "pc":
        return "PC"
    from emustart import systems
    return str(systems.info(p).get("plat") or p).upper()             # aliasy folderów i wielkość liter


def key_of(title: str, platform: str) -> str:
    """Klucz wyniku: „snes|super metroid”, „pc|cyberpunk 2077” (Lumen liczy go tak samo: shared/series.ts)."""
    return f"{source_of(platform)}|{' '.join(str(title or '').lower().split())}"


STORES = {"steam": 1, "gog": 5}     # źródło wydania w IGDB (external_games: category / external_game_source)


def store_key(store: str, ext: str) -> str:
    """Klucz gry ze sklepu po jej identyfikatorze: „steam|203160”, „gog|1207658930” (zgłoszenie 2026-11-16: po
    tytule „Tomb Raider” ze Steam — reboot z 2013 — dopasowywał się do gry z 1996). Lumen liczy go tak samo."""
    return f"{store}|{ext}"


def _igdb_platform(plat: str):
    if plat == "PC":
        return 6
    from emustart import art_sources
    return art_sources.IGDB_PLATFORMS.get(plat)


GAME_FIELDS = ("id,name,platforms,collections,franchises,franchise,first_release_date,version_parent,game_type,"
               "alternative_names.name")


def _by_store_id(q, games: list) -> dict:
    """{(sklep, identyfikator): gra IGDB} — wydanie ze Steam / GOG po identyfikatorze sklepu, nie po tytule.
    Każdy błąd tego pytania (nieznane pole, limit) to pusty wynik: te gry dopasuje tytuł, jak dotąd."""
    out: dict = {}
    want = {(g["store"], g["ext"]) for g in games}
    if not want:
        return out
    try:
        links: dict = {}
        for part in _chunks(sorted({e for _, e in want}), 50):
            uids = ",".join(f'"{u}"' for u in part)
            for r in q("external_games", f"fields *; where uid = ({uids}); limit 500;", False) or []:
                src = r.get("external_game_source") or r.get("category")
                store = next((s for s, n in STORES.items() if n == src), None)
                game = r.get("game")
                game = game.get("id") if isinstance(game, dict) else game
                if store and game and (store, str(r.get("uid"))) in want:
                    links[(store, str(r.get("uid")))] = int(game)
        rows: dict = {}
        for part in _chunks(sorted(set(links.values())), 100):
            for r in q("games", f'fields {GAME_FIELDS}; where id = ({",".join(map(str, part))}); limit 100;', False) or []:
                rows[r["id"]] = r
        for k, gid in links.items():
            if gid in rows:
                out[k] = rows[gid]
    except Exception:
        log.info("serie IGDB: dopasowanie po identyfikatorze sklepu nieudane — po tytule", exc_info=True)
        return {}
    return out


# ── dopasowanie (PyLinks Web) ──

def _similarity(a: str, b: str) -> float:
    """Dice na bigramach (jak PyLinks); tytuł bez liter łacińskich i cyfr (ドラゴンクエスト) — tylko dokładna zgodność
    (bigramy z samych [a-z0-9] są puste i dawały 1,0 dla dowolnej pary)."""
    from emustart.art_sources import similarity
    latin = re.compile(r"[a-z0-9]")
    if not latin.search((a or "").lower()) or not latin.search((b or "").lower()):
        return 1.0 if " ".join((a or "").casefold().split()) == " ".join((b or "").casefold().split()) else 0.0
    return similarity(a, b)


_REV = re.compile(r"[ ]*([(][^)]*[)]|(?:-[ ]*|[ ]+)(?:ver|version|rev|revision)\b[.]?[ ]*[a-z0-9.]+)[ ]*$",
                  re.IGNORECASE)   # „Tekken 2 Ver.B”, nie „Tekken Revolution” ani „Driver 2”


def _without_revision(name: str) -> str:
    """„Tekken 2 Ver.B” → „Tekken 2”; „Street Fighter II (Rev A)” → „Street Fighter II”."""
    out = (name or "").strip()
    for _ in range(3):
        new = _REV.sub("", out).strip()
        if new == out:
            break
        out = new
    return out


def _sim_row(title: str, alt: str, row: dict) -> float:
    """Podobieństwo z nazwą główną i nazwami alternatywnymi („Seiken Densetsu 3” = „Trials of Mana”)."""
    names = [row.get("name", "")] + [a.get("name", "") for a in (row.get("alternative_names") or [])
                                     if isinstance(a, dict)]
    phrases = [t for t in (title, alt) if t]
    return max((_similarity(f, n) for f in phrases for n in names if n), default=0.0)


def pick_game(title: str, plat: str, rows: list, alt: str = ""):
    """Najlepsza gra: podobieństwo ≥ próg → zgodna platforma → nie mod / fork → gra główna, wcześniejsze wydanie."""
    named = [(_sim_row(title, alt, r), r) for r in rows if isinstance(r, dict)]
    named = [(s, r) for s, r in named if s >= SERIES_MATCH_MIN]
    if not named:
        return None, 0.0
    pid = _igdb_platform(plat)
    if pid is not None:
        same = [(s, r) for s, r in named if pid in (r.get("platforms") or [])]
        if same:
            named = same
    no_mods = [(s, r) for s, r in named if r.get("game_type") not in _MODS]
    if no_mods:
        named = no_mods
    best = max(s for s, _ in named)
    top = [(s, r) for s, r in named if s >= best - 0.02]
    s, r = min(top, key=lambda x: (-x[0], 0 if x[1].get("game_type") == _MAIN else 1,
                                   x[1].get("first_release_date") or 10**12))
    return r, s


def name_variants(name: str) -> list:
    """Kolejne frazy wyszukiwania (No-Intro „Legend of Zelda, The - …”, „ - ” → „: ”, łączniki, bez rewizji, sam
    tytuł przed podtytułem — tylko do szukania, nie do porównania)."""
    n = (name or "").strip()
    out = [n]
    m = re.match(r"^(.*?), (The|A|An)( - |: |$)(.*)$", n)
    if m:
        head, art, _sep, tail = m.groups()
        out.append(f"{art} {head}" + (f": {tail}" if tail else ""))
    for x in list(out):
        if " - " in x:
            out.append(x.replace(" - ", ": "))
    if re.search(r"[A-Za-z]-[A-Za-z]", n):
        out.append(re.sub(r"(?<=[A-Za-z])-(?=[A-Za-z])", " ", n))
    short = _without_revision(n)
    if short and short not in out:
        out.append(short)
    pairs = [(x, True) for x in out]
    for sep in (" - ", ": "):
        if sep in n:
            head = n.split(sep, 1)[0].strip()
            if len(head) >= 3:
                pairs.append((head, False))
    uniq, seen = [], set()
    for x, compare in pairs:
        if x and x not in seen:
            seen.add(x)
            uniq.append((x, compare))
    return uniq


def _franchises(r: dict) -> list:
    out = list(r.get("franchises") or [])
    if r.get("franchise") and r["franchise"] not in out:
        out.insert(0, r["franchise"])
    return out


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def _names(q, endpoint: str, ids) -> dict:
    """{id: (nazwa, liczba gier)}"""
    out = {}
    for part in _chunks(sorted(ids), 100):
        for r in q(endpoint, f'fields id,name,games; where id = ({",".join(map(str, part))}); limit 100;'):
            out[r["id"]] = (r.get("name", ""), len(r.get("games") or []))
    return out


def detect(q, games: list) -> list:
    """games: [{"key", "title", "platform"}] → wiersze do bazy. `q(endpoint, apicalypse) -> list`."""
    found = []
    by_ext = _by_store_id(q, [g for g in games if g.get("store") and g.get("ext")])
    for g in games:
        best, sim = by_ext.get((g.get("store"), g.get("ext"))), 1.0
        if best is not None:
            found.append((g, best, sim))
            continue
        sim = 0.0
        for phrase, compare in name_variants(g["title"]):
            esc = phrase.replace('"', " ")
            rows = q("games", f'search "{esc}"; fields id,name,platforms,collections,franchises,franchise,'
                              f'first_release_date,version_parent,game_type,alternative_names.name; limit 50;')
            best, sim = pick_game(g["title"], platform_of(g["platform"]), rows, alt=phrase if compare else "")
            if best is not None:
                break
        found.append((g, best, sim))
    parents = {int(b["version_parent"]) for _, b, _ in found if b and b.get("version_parent")}
    parent_info = {}
    for part in _chunks(sorted(parents), 100):
        for r in q("games", f'fields id,first_release_date,collections,franchises,franchise; '
                            f'where id = ({",".join(map(str, part))}); limit 100;'):
            parent_info[r["id"]] = r
    ids = sorted({int(b["id"]) for _, b, _ in found if b})
    original_ts: dict = {}
    for part in _chunks(ids, 50):
        lst = ",".join(map(str, part))
        for r in q("games", f'fields id,first_release_date,remakes,remasters,expanded_games,ports; '
                            f'where remakes = ({lst}) | remasters = ({lst}) | expanded_games = ({lst}) '
                            f'| ports = ({lst}); limit 100;'):
            for copy in [x for k in ("remakes", "remasters", "expanded_games", "ports") for x in (r.get(k) or [])]:
                ts = r.get("first_release_date")
                if ts and (copy not in original_ts or ts < original_ts[copy]):
                    original_ts[copy] = ts
    coll_ids: set = set()
    fr_ids: set = set()
    for _, best, _ in found:
        if best:
            src = parent_info.get(best.get("version_parent")) or {}
            coll_ids.update(best.get("collections") or src.get("collections") or [])
            fr_ids.update(_franchises(best) or _franchises(src))
    colls = _names(q, "collections", coll_ids)
    frans = _names(q, "franchises", fr_ids)
    now = time.time()
    out = []
    for g, best, sim in found:
        if not best:
            out.append((g["key"], g["title"], g["platform"], None, None, None, None, None, None, sim, now))
            continue
        par = parent_info.get(best.get("version_parent")) or {}
        c_ids = best.get("collections") or par.get("collections") or []
        f_ids = _franchises(best) or _franchises(par)
        # najwęższa kolekcja z co najmniej dwiema grami (jednoelementowa — np. „Yakuza Prequels” — zostawiłaby grę
        # samą); jednoelementowa tylko, gdy innej nie ma
        size = lambda c: colls.get(c, ("", 10**9))[1]                          # noqa: E731
        c_id = min(c_ids, key=lambda c: (size(c) < 2, size(c))) if c_ids else None
        f_id = f_ids[0] if f_ids else None
        rel = best.get("first_release_date")
        order = original_ts.get(best["id"]) or par.get("first_release_date") or rel
        out.append((g["key"], g["title"], g["platform"], best["id"], best.get("name", ""),
                    frans.get(f_id, ("", 0))[0] if f_id else None, colls.get(c_id, ("", 0))[0] if c_id else None,
                    rel, order, sim, now))
    return out


# ── pytanie Lumena i wątek w tle ──

def _result(row) -> dict | None:
    """Wiersz bazy → odpowiedź dla Lumena; None = gra spoza serii (sprawdzona).

    Seria = kolekcja IGDB (Baldur's Gate, Eye of the Beholder, Heroes of Might and Magic), grupa = franczyza
    (Dungeons & Dragons, Might and Magic) — zgłoszenie 2026-11-16: franczyza jako seria łączyła niezależne serie.
    Gra z franczyzą bez kolekcji: `name` puste, `group` — Lumen bierze serię z tytułu (remaster dołącza do serii
    oryginału, gra bez pary zostaje sama), nie worek z całej franczyzy."""
    _key, _t, _p, igdb_id, igdb_name, franchise, collection, rel, order, _sim, _ts = row
    if not igdb_id or not (collection or franchise):
        return None
    return {"name": collection or "", "group": franchise or "", "franchise": franchise or "",
            "collection": collection or "", "order_ts": int(order or 0), "release_ts": int(rel or 0),
            "igdb": igdb_name or ""}


def _want(games) -> dict:
    want: dict = {}
    for g in (games or [])[:MAX_GAMES]:
        if not isinstance(g, dict):
            continue
        title = " ".join(str(g.get("title") or "").split())[:300]
        if not title:
            continue
        src = source_of(str(g.get("platform") or ""))
        store, ext = str(g.get("store") or "").lower(), str(g.get("id") or "").strip()
        if store in STORES and ext.isdigit() and len(ext) <= 20:
            k = store_key(store, ext)
            want.setdefault(k, {"key": k, "title": title, "platform": src, "store": store, "ext": ext})
            continue
        want.setdefault(key_of(title, src), {"key": key_of(title, src), "title": title, "platform": src})
    return want


def _known(con, keys) -> dict:
    """{klucz: wynik | None} — sprawdzone (dawne „nie znaleziono” pominięte: do ponownego sprawdzenia)."""
    out: dict = {}
    stale = time.time() - RECHECK
    for part in _chunks(list(keys), 500):
        for row in con.execute(f"SELECT * FROM series WHERE key IN ({','.join('?' * len(part))})", part):
            if row[3] is None and row[10] < stale:
                continue
            out[row[0]] = _result(row)
    return out


def _status() -> int:
    with _lock:
        return len(_queue) + (1 if _worker.get("busy") else 0)


def progress(con) -> dict:
    """Postęp dla Lumena i panelu serwera (prośba 2026-11-16: „skąd mam wiedzieć, że działa?”): bieżący przebieg
    (`done` z `total` — sprawdzone w nim i ich suma z kolejką), cała baza (`checked`, `in_series`), czas ostatniej
    porcji i ostatni błąd IGDB (pusty, gdy następna porcja przeszła)."""
    checked, in_series, last = con.execute(
        "SELECT COUNT(*), SUM(CASE WHEN igdb_id IS NOT NULL AND (COALESCE(franchise, '') <> '' "
        "OR COALESCE(collection, '') <> '') THEN 1 ELSE 0 END), MAX(ts) FROM series").fetchone()
    with _lock:
        pending = len(_queue) + (len(_worker.get("batch") or ()) if _worker.get("busy") else 0)
        done = int(_worker.get("done") or 0)
        error = str(_worker.get("error") or "")
        t = _worker.get("thread")
        running = t is not None and t.is_alive()     # wątek, który padł, nie „sprawdza” w nieskończoność
    return {"running": running, "done": done, "total": done + pending, "checked": int(checked or 0),
            "in_series": int(in_series or 0), "last_batch": float(last or 0), "error": error}


def lookup(games: list, cfg_fn=None) -> dict:
    """POST: games [{"title", "platform"}] — tytuły spoza serwera (gry Steam) → {"ok", "enabled", "series":
    {klucz: wynik | None}, "pending"}. Niesprawdzone nie mają klucza w "series" — idą na początek kolejki."""
    _set_cfg(cfg_fn)
    enabled = _client() is not None
    want = _want(games)
    with _db_lock, _db() as con:
        series = _known(con, want)
    todo = [g for k, g in want.items() if k not in series]
    if enabled and todo:
        _enqueue(todo, front=True)
    with _db_lock, _db() as con:
        prog = progress(con)
    return {"ok": True, "enabled": enabled, "series": series, "pending": _status(), "progress": prog}


def all_series(cfg_fn=None) -> dict:
    """GET: wszystkie gry w seriach znane serwerowi → {"ok", "enabled", "series": {klucz: wynik}, "pending"}."""
    _set_cfg(cfg_fn)
    series: dict = {}
    standalone = []
    with _db_lock, _db() as con:
        for r in con.execute("SELECT * FROM series WHERE igdb_id IS NOT NULL"):
            res = _result(r)
            if res is None:
                standalone.append(r[0])     # IGDB zna grę, ale bez serii — Lumen nie zgaduje jej z tytułu
            else:
                series[r[0]] = res
        prog = progress(con)
    return {"ok": True, "enabled": _client() is not None, "series": series, "standalone": standalone,
            "pending": _status(), "progress": prog}


def status(cfg_fn=None) -> dict:
    """GET /v1/series/progress: sam postęp, bez listy serii — Lumen pyta o niego co chwilę, gdy pasek jest widoczny."""
    _set_cfg(cfg_fn)
    with _db_lock, _db() as con:
        prog = progress(con)
    return {"ok": True, "enabled": _client() is not None, "pending": _status(), "progress": prog}


def _set_cfg(cfg_fn) -> None:
    global CFG
    if cfg_fn is not None:
        CFG = cfg_fn


def server_games(cfg: dict) -> list:
    """Gry serwera do sprawdzenia: katalog GOG (najpierw), potem tytuły biblioteki emulatorów (bez wariantów)."""
    out = []
    try:
        from emustart import gogarchive
        out += [{"title": g["title"], "platform": "pc", "store": "gog", "id": g.get("product_id")}
                for g in gogarchive.catalog() if g.get("title")]
    except Exception:
        log.exception("serie: katalog GOG")
    try:
        from emustart import library
        rows = library.db().execute("SELECT DISTINCT es, title FROM games WHERE title <> ''").fetchall()
        out += [{"title": t, "platform": es} for es, t in rows]
    except Exception:
        log.exception("serie: biblioteka")
    return out


def scan_server_games(cfg_fn) -> int:
    """Niesprawdzone gry serwera do kolejki (w tle). Zwraca, ile dodano."""
    _set_cfg(cfg_fn)
    if _client() is None:
        return 0
    want = _want(server_games(cfg_fn()))
    with _db_lock, _db() as con:
        known = _known(con, want)
    todo = [g for k, g in want.items() if k not in known]
    _enqueue(todo)
    if todo:
        log.info("serie IGDB: %d gier serwera do sprawdzenia", len(todo))
    return len(todo)


def scheduler(cfg_fn) -> None:
    """Wątek serwera: gry serwera do sprawdzenia 15 min po starcie, potem raz na dobę (nowe gry, „nie znaleziono”)."""
    def loop():
        time.sleep(900)
        while True:
            try:
                scan_server_games(cfg_fn)
            except Exception:
                log.exception("serie IGDB")
            time.sleep(86400)
    threading.Thread(target=loop, daemon=True, name="serie-harmonogram").start()


def _client():
    """Klient IGDB z kluczami serwera albo None (brak kluczy — tylko seria z tytułu w Lumenie)."""
    if CFG is None:
        return None
    from emustart import art_sources
    ig = art_sources.Sources(CFG()).igdb
    return ig if ig.cid and ig.secret else None


def _enqueue(games: list, front: bool = False) -> None:
    """Do kolejki wątku w tle; `front` — gry z pytania Lumena przed resztą biblioteki serwera."""
    with _lock:
        for g in (reversed(games) if front else games):
            if g["key"] not in _queued:
                _queued.add(g["key"])
                if front:
                    _queue.appendleft(g)
                else:
                    _queue.append(g)
        t = _worker.get("thread")
        if t is None or not t.is_alive():
            _worker["done"] = 0                      # nowy przebieg — pasek od zera
            _worker["thread"] = threading.Thread(target=_run, daemon=True, name="serie-igdb")
            _worker["thread"].start()


RETRY_PAUSE = 120               # s — po błędzie IGDB (sieć, limit 429): porcja wraca do kolejki


def _run() -> None:
    ig = _client()
    if ig is None:
        with _lock:
            _queue.clear()
            _queued.clear()
            _worker["thread"] = None
        return
    done = fails = 0
    while True:
        with _lock:
            batch = [_queue.popleft() for _ in range(min(40, len(_queue)))]
            _worker["busy"] = bool(batch)
            _worker["batch"] = batch
            if not batch:
                _worker["thread"] = None             # pod blokadą: _enqueue po tym miejscu uruchomi nowy wątek
                if done:
                    log.info("serie IGDB: sprawdzono %d gier", done)
                return
        try:
            rows = detect(lambda ep, body, strict=True: ig.query(ep, body, strict=strict), batch)
            with _db_lock, _db() as con:
                con.executemany("INSERT OR REPLACE INTO series VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
            done += len(rows)
            fails = 0
            with _lock:
                for g in batch:
                    _queued.discard(g["key"])
                _worker["busy"] = False
                _worker["done"] = int(_worker.get("done") or 0) + len(batch)
                _worker["error"] = ""
        except Exception as ex:
            # błąd IGDB to nie „nie znaleziono”: nic nie zapisujemy, porcja na koniec kolejki, przerwa
            fails += 1
            log.info("serie IGDB: %s — ponowię za %d s", ex, RETRY_PAUSE)
            with _lock:
                _queue.extend(batch)
                _worker["busy"] = False
                _worker["error"] = f"IGDB: {ex}"[:200]
            if fails >= 5:
                with _lock:
                    for g in list(_queue):
                        _queued.discard(g["key"])
                    _queue.clear()
                    _worker["thread"] = None
                    _worker["error"] = "IGDB niedostępne — ponowię przy następnym sprawdzeniu (raz na dobę)"
                log.info("serie IGDB: IGDB niedostępne — wracam przy następnym sprawdzeniu")
                return
            time.sleep(RETRY_PAUSE)
