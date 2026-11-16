"""Serie gier z IGDB (emustart/igdbseries.py — przeniesione z PyLinks Web): dopasowanie, franczyza / kolekcja,
data oryginału dla remake'u, kolejka w tle, trasy GET / POST /v1/series. Bez sieci — udawane IGDB."""

from __future__ import annotations

import threading
import time
import types

import pytest

from emustart import igdbseries as S
from emustart import paths, remote
from test_three_devices import MASTER, _req, srv  # noqa: F401  (fixture)

D = 86400
GAMES = {
    1: {"id": 1, "name": "Yakuza 0", "platforms": [6], "franchises": [10], "collections": [20, 21],
        "first_release_date": 1420070400, "game_type": 0},
    2: {"id": 2, "name": "Yakuza Kiwami", "platforms": [6], "franchises": [10], "collections": [20],
        "first_release_date": 1453939200, "game_type": 8},
    3: {"id": 3, "name": "Yakuza", "platforms": [8], "franchises": [10], "collections": [20],
        "first_release_date": 1134000000, "game_type": 0, "remakes": [2]},
    4: {"id": 4, "name": "Chrono Trigger+", "platforms": [19], "first_release_date": 1640000000, "game_type": 5,
        "collections": [30]},
    5: {"id": 5, "name": "Chrono Trigger", "platforms": [19], "first_release_date": 795000000, "game_type": 0,
        "collections": [30]},
    6: {"id": 6, "name": "Russian City Sim", "platforms": [6], "game_type": 0},
}
NAMES = {"franchises": {10: ("Yakuza", 9)}, "collections": {20: ("Yakuza", 8), 21: ("Yakuza Prequels", 1),
                                                           30: ("Chrono", 3)}}


class FakeIgdb:
    """Odpowiedzi na zapytania apicalypse, jakie wysyła detect()."""

    def __init__(self, fail=0, ext_fail=False):
        self.calls = []
        self.ext_fail = ext_fail         # pytanie po identyfikatorze sklepu kończy się błędem (np. nieznane pole)
        self.fail = fail                 # tyle pierwszych zapytań kończy się błędem IGDB (sieć, 429)

    def query(self, endpoint, body, strict=False):
        self.calls.append((endpoint, body))
        if self.fail:
            self.fail -= 1
            from emustart.art_sources import IgdbError
            raise IgdbError("429")
        if endpoint == "external_games":
            if self.ext_fail:
                from emustart.art_sources import IgdbError
                raise IgdbError("400")       # pytanie po identyfikatorze nie działa
            # Steam 777 → gra 5 (nowe pole źródła), GOG 888 → gra 1 (stare pole category), Steam 999 → brak
            links = [{"uid": "777", "external_game_source": 1, "game": 5}, {"uid": "888", "category": 5, "game": 1},
                     {"uid": "888", "category": 1, "game": 6}]        # ten sam numer w innym sklepie — pominięty
            return [r for r in links if f'"{r["uid"]}"' in body]
        if endpoint in NAMES:
            return [{"id": i, "name": n, "games": list(range(c))} for i, (n, c) in NAMES[endpoint].items()
                    if str(i) in body]
        if body.startswith("search"):
            q = body.split('"')[1].lower()
            return [g for g in GAMES.values() if q.split()[0] in g["name"].lower()]
        if "remakes =" in body:
            return [g for g in GAMES.values() if any(str(x) in body for x in g.get("remakes") or [])]
        if "where id = (" in body:
            ids = {int(x) for x in body.split("where id = (")[1].split(")")[0].split(",")}
            return [g for g in GAMES.values() if g["id"] in ids]
        return []


def q_of(fake):
    return lambda ep, body, strict=True: fake.query(ep, body, strict)


def test_pick_game_prefers_original_over_mod_and_rejects_weak_match():
    best, _ = S.pick_game("Chrono Trigger", "SNES", [GAMES[4], GAMES[5]])
    assert best["id"] == 5                                   # „Chrono Trigger+” (mod) przegrywa z oryginałem
    best, sim = S.pick_game("Sim City", "PC", [GAMES[6]])
    assert best is None and sim == 0.0                       # 0,57 < 0,80 — brak serii lepszy niż zła


def test_name_variants_no_intro_and_subtitle_head():
    v = [x for x, _ in S.name_variants("Legend of Zelda, The - A Link to the Past")]
    assert "The Legend of Zelda: A Link to the Past" in v
    assert ("Mother 2", False) in S.name_variants("Mother 2 - Giygas Strikes Back")


def test_detect_franchise_collection_and_remake_order():
    rows = S.detect(q_of(FakeIgdb()), [{"key": "pc|yakuza 0", "title": "Yakuza 0", "platform": "pc"},
                                       {"key": "pc|yakuza kiwami", "title": "Yakuza Kiwami", "platform": "pc"}])
    by = {r[0]: S._result(r) for r in rows}
    # seria = najwęższa kolekcja z co najmniej dwiema grami (nie jednoelementowa „Yakuza Prequels”), grupa = franczyza
    assert by["pc|yakuza 0"]["name"] == "Yakuza" and by["pc|yakuza 0"]["collection"] == "Yakuza"
    assert by["pc|yakuza 0"]["group"] == "Yakuza"
    k = by["pc|yakuza kiwami"]
    assert k["order_ts"] == GAMES[3]["first_release_date"]   # remake → data oryginału
    assert k["release_ts"] == GAMES[2]["first_release_date"]


@pytest.fixture
def fake_server(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "DATA", tmp_path)
    fake = FakeIgdb()
    monkeypatch.setattr(S, "_client", lambda: fake)
    S._queue.clear()
    S._queued.clear()
    return fake


def _wait_idle():
    end = time.time() + 10
    while time.time() < end:
        t = S._worker.get("thread")
        if not (t and t.is_alive()):
            return
        time.sleep(0.02)
    raise AssertionError("wątek serii nie skończył")


def test_lookup_queues_then_answers(fake_server):
    r = S.lookup([{"title": "Yakuza 0", "platform": "pc"}, {"title": "Sim City", "platform": "steam"}],
                 lambda: {})
    assert r["enabled"] and r["series"] == {}                 # pierwsze pytanie: w kolejce
    _wait_idle()
    r = S.lookup([{"title": "Yakuza 0", "platform": "pc"}, {"title": "Sim City", "platform": "steam"}])
    assert r["series"]["pc|yakuza 0"]["name"] == "Yakuza"
    assert "pc|sim city" in r["series"] and r["series"]["pc|sim city"] is None   # sprawdzona, bez serii
    n = len(fake_server.calls)
    S.lookup([{"title": "Yakuza 0", "platform": "pc"}])
    _wait_idle()
    assert len(fake_server.calls) == n                        # znana — bez nowych zapytań do IGDB
    assert set(S.all_series()["series"]) == {"pc|yakuza 0"}


def test_old_no_match_is_checked_again(fake_server):
    with S._db() as con:
        con.execute("INSERT INTO series VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    ("pc|yakuza 0", "Yakuza 0", "pc", None, None, None, None, None, None, 0.0, time.time() - 40 * D))
    S.lookup([{"title": "Yakuza 0", "platform": "pc"}], lambda: {})
    _wait_idle()
    assert S.all_series()["series"]["pc|yakuza 0"]["name"] == "Yakuza"


def test_scan_server_games_queues_library_titles_once(fake_server, monkeypatch):
    monkeypatch.setattr(S, "server_games", lambda cfg: [{"title": "Chrono Trigger", "platform": "snes"},
                                                        {"title": "Chrono Trigger", "platform": "snes"}])
    assert S.scan_server_games(lambda: {}) == 1
    _wait_idle()
    assert S.all_series()["series"]["snes|chrono trigger"]["name"] == "Chrono"
    assert S.scan_server_games(lambda: {}) == 0


def test_igdb_error_is_not_stored_as_no_match(fake_server, monkeypatch):
    """błąd IGDB (sieć, limit) nie zapisuje „nie znaleziono” na 30 dni: porcja wraca i jest sprawdzona później"""
    monkeypatch.setattr(S, "RETRY_PAUSE", 0)
    fake_server.fail = 2
    S.lookup([{"title": "Yakuza 0", "platform": "pc"}], lambda: {})
    _wait_idle()
    assert S.all_series()["series"]["pc|yakuza 0"]["name"] == "Yakuza"


def test_standalone_games_listed_separately(fake_server):
    S.lookup([{"title": "Russian City Sim", "platform": "pc"}], lambda: {})
    _wait_idle()
    r = S.all_series()
    assert "pc|russian city sim" in r["standalone"] and "pc|russian city sim" not in r["series"]


def test_revision_suffix_only_as_a_word_and_non_latin_titles():
    assert S._without_revision("Tekken Revolution") == "Tekken Revolution"
    assert S._without_revision("Driver 2") == "Driver 2"
    assert S._without_revision("Tekken 2 Ver.B") == "Tekken 2"
    assert S._similarity("ドラゴンクエスト", "ファイナルファンタジー") == 0.0
    assert S._similarity("ドラゴンクエスト", "ドラゴンクエスト") == 1.0


def test_without_keys_nothing_is_queued(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "DATA", tmp_path)
    monkeypatch.setattr(S, "_client", lambda: None)
    S._queue.clear()
    r = S.lookup([{"title": "Yakuza 0", "platform": "pc"}], lambda: {})
    assert {k: v for k, v in r.items() if k != "progress"} == {"ok": True, "enabled": False, "series": {}, "pending": 0}
    assert r["progress"]["checked"] == 0 and not r["progress"]["running"]
    assert not S._queue


def test_progress_counts_run_and_database(tmp_path, monkeypatch):
    """Pasek w Lumenie i panelu serwera (2026-11-16): przebieg (done z total), cała baza, ostatnia porcja, błąd."""
    monkeypatch.setattr(paths, "DATA", tmp_path)
    monkeypatch.setattr(S, "_conn", {})
    with S._db_lock, S._db() as con:
        con.executemany("INSERT INTO series VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
            ("pc|a", "A", "pc", 1, "A", "Saga", "", 0, 0, 1.0, 100.0),
            ("pc|b", "B", "pc", 2, "B", "", "", 0, 0, 1.0, 200.0),      # IGDB zna, bez serii
            ("pc|c", "C", "pc", None, "", "", "", 0, 0, 0.0, 150.0),    # nie znaleziono
        ])
    alive = types.SimpleNamespace(is_alive=lambda: True)
    monkeypatch.setattr(S, "_worker", {"thread": alive, "done": 40, "busy": True, "batch": [{}] * 40,
                                       "error": "IGDB: 429"})
    S._queue.clear()
    S._queue.extend([{"key": "x"}] * 20)
    try:
        with S._db_lock, S._db() as con:
            p = S.progress(con)
    finally:
        S._queue.clear()
    assert p == {"running": True, "done": 40, "total": 100, "checked": 3, "in_series": 1, "last_batch": 200.0,
                 "error": "IGDB: 429"}
    S._worker["thread"] = types.SimpleNamespace(is_alive=lambda: False)   # wątek padł — nie „sprawdza” dalej
    with S._db_lock, S._db() as con:
        assert S.progress(con)["running"] is False


def test_routes_need_the_server_key(srv, fake_server):  # noqa: F811
    st, _ = _req(srv, "GET", "/v1/series")
    assert st == 401
    key = MASTER                                              # wspólny klucz serwera (ten komputer)
    st, r = _req(srv, "POST", "/v1/series", key, body={"games": [{"title": "Yakuza 0", "platform": "pc"}]})
    assert st == 200 and r["ok"]
    _wait_idle()
    st, r = _req(srv, "GET", "/v1/series", key)
    assert st == 200 and r["series"]["pc|yakuza 0"]["name"] == "Yakuza"
    assert r["progress"]["checked"] == 1 and r["progress"]["in_series"] == 1
    st, _ = _req(srv, "GET", "/v1/series/progress")
    assert st == 401
    st, r = _req(srv, "GET", "/v1/series/progress", key)
    assert st == 200 and r["ok"] and "series" not in r and r["progress"]["checked"] == 1
    st, info = _req(srv, "GET", "/v1/info", key)
    assert "series" in info["features"]


def test_series_is_collection_group_is_franchise():
    """Zgłoszenie 2026-11-16: franczyza (Dungeons & Dragons) nie jest serią — seria to kolekcja; bez kolekcji —
    pusta nazwa (Lumen bierze serię z tytułu), franczyza jako grupa; bez obu — gra spoza serii."""
    def row(fr, co):
        return ("pc|x", "X", "pc", 7, "X", fr, co, 1, 1, 1.0, 0.0)
    r = S._result(row("Dungeons & Dragons", "Eye of the Beholder"))
    assert (r["name"], r["group"]) == ("Eye of the Beholder", "Dungeons & Dragons")
    r = S._result(row("Dungeons & Dragons", None))
    assert (r["name"], r["group"]) == ("", "Dungeons & Dragons")
    assert S._result(row(None, None)) is None
    assert S._result(row(None, "Tex Murphy"))["group"] == ""


def test_store_id_wins_over_title():
    """Zgłoszenie 2026-11-16: gra ze Steam / GOG dopasowana po identyfikatorze sklepu, nie po tytule (Steam
    „Tomb Raider” 2013 ≠ gra z 1996); pytanie po identyfikatorze nieudane — po tytule, jak dotąd."""
    games = [{"key": "steam|777", "title": "Yakuza 0", "platform": "pc", "store": "steam", "ext": "777"},
             {"key": "gog|888", "title": "Chrono Trigger", "platform": "pc", "store": "gog", "ext": "888"},
             {"key": "steam|999", "title": "Yakuza Kiwami", "platform": "pc", "store": "steam", "ext": "999"}]
    by = {r[0]: r for r in S.detect(q_of(FakeIgdb()), games)}
    assert by["steam|777"][3] == 5 and by["gog|888"][3] == 1 and by["steam|999"][3] == 2
    S._ext_fails["n"] = 0
    by = {r[0]: r for r in S.detect(q_of(FakeIgdb(ext_fail=True)), games)}
    assert set(by) == set()                                 # chwilowy błąd: gry ze sklepu później, nic nie zapisane
    for _ in range(S.EXT_GIVE_UP):
        by = {r[0]: r for r in S.detect(q_of(FakeIgdb(ext_fail=True)), games)}
    assert by["steam|777"][3] == 1                          # pytanie nie działa — po tytule „Yakuza 0”
    S._ext_fails["n"] = 0
    want = S._want([{"title": "Tomb Raider", "platform": "pc", "store": "steam", "id": "203160"},
                    {"title": "Tomb Raider", "platform": "pc"}, {"title": "X", "store": "steam", "id": "1; drop"}])
    assert set(want) == {"steam|203160", "pc|tomb raider", "pc|x"}