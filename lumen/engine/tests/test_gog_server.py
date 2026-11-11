"""Archiwum depotów GOG na serwerze: indeks (kompletność, ścieżki, sekrety) i autoryzowane /v1/gog/…"""

from __future__ import annotations

import json
import os

import keyhelp
import pytest

from emustart import gogarchive as ga
from goghelp import BUILD, PID, all_chunk_files, build_archive
from test_three_devices import _req, srv  # noqa: F401  (fixture)


@pytest.fixture()
def arc(tmp_path):
    root = tmp_path / "_depots"
    info = build_archive(root)
    ga.INDEX.update(root="", builds={}, rejected=[], error="", running=False)
    yield root, info
    ga.INDEX.update(root="", builds={}, rejected=[], error="", running=False)


def _index(root):
    ga.refresh(str(root), wait=True)
    return ga.status()


def test_complete_archive_is_indexed(arc):
    root, _ = arc
    st = _index(root)
    assert st["error"] == "" and st["games"] == 1 and st["builds"] == 1 and not st["rejected"]
    g = ga.game(PID)
    b = g["builds"][0]
    assert b["build_id"] == BUILD and b["languages"] == ["en", "pl"]
    assert {d["id"]: d["has_files"] for d in b["dlcs"]} == {"2001": True, "2002": False}
    assert b["dependencies"] == ["MSVC2017"] and len(b["hash"]) == 64


@pytest.mark.parametrize("damage", ["state", "missing_chunk", "short_chunk", "missing_manifest"])
def test_incomplete_archive_is_not_published(tmp_path, damage):
    root = tmp_path / "_depots"
    build_archive(root, state="incomplete" if damage == "state" else "complete")
    if damage == "missing_chunk":
        all_chunk_files(root)[0].unlink()
    if damage == "short_chunk":
        p = all_chunk_files(root)[0]
        p.write_bytes(p.read_bytes()[:-1])
    if damage == "missing_manifest":
        next((root / "manifests" / "dep").rglob("*.json")).unlink()
    st = _index(root)
    assert st["builds"] == 0 and len(st["rejected"]) == 1
    assert ga.catalog() == []


def test_unsafe_manifest_path_is_rejected(tmp_path):
    root = tmp_path / "_depots"
    build_archive(root, extra_items=[{"type": "DepotFile", "path": "..\\..\\Windows\\evil.dll", "chunks": []}])
    st = _index(root)
    assert st["builds"] == 0 and "niebezpieczna ścieżka" in st["rejected"][0]["reason"]


def test_foreign_or_newer_format_is_refused(tmp_path):
    root = tmp_path / "x"
    root.mkdir()
    (root / "archive.json").write_text(json.dumps({"format": "goggui-depot-archive", "version": 9}))
    assert "obsługuje" in _index(root)["error"]
    (root / "archive.json").write_text(json.dumps({"format": "inne"}))
    assert "obcy format" in _index(root)["error"]


@pytest.mark.parametrize("p", ["C:\\Windows\\x", "\\\\nas\\share\\x", "a/../../x", "a/con.txt", "a/file.txt:ads",
                               "a/nazwa. ", "a/b\x01c", "", "/"])
def test_safe_rel_rejects(p):
    with pytest.raises(ga.UnsafePath):
        ga.safe_rel(p)


def test_safe_rel_accepts_relative():
    assert ga.safe_rel("\\bin\\game.exe") == "bin/game.exe"
    assert ga.safe_rel("./a/./b.txt") == "a/b.txt"


def test_manifest_has_no_secrets(arc):
    root, _ = arc
    _index(root)
    m = ga.build_manifest(PID, BUILD)
    raw = json.dumps(m)
    assert "SEKRET-NIE-WYSYLAC" not in raw and "clientSecret" not in raw and "clientId" not in raw
    assert m["hash"] == ga.game(PID)["builds"][0]["hash"]
    assert set(m["manifests"]) == {"depot", "dep"}


def test_changed_record_is_refused(arc):
    root, _ = arc
    _index(root)
    rp = root / "products" / PID / f"{BUILD}.json"
    rec = json.loads(rp.read_text())
    rec["title"] = "zmieniony"
    rp.write_text(json.dumps(rec))
    os.utime(rp, (1, 1))
    with pytest.raises(ga.Changed):
        ga.build_manifest(PID, BUILD)


# ── HTTP: autoryzacja, uprawnienia, przypięcie i ścieżki ──

def test_http_requires_auth_and_games_permission(srv, arc):  # noqa: F811
    root, _ = arc
    _index(root)
    assert _req(srv, "GET", "/v1/gog/games")[0] == 401
    assert _req(srv, "GET", "/v1/gog/games", "zly-token")[0] == 401
    _did, no_games = keyhelp.device("Gosc", games=False, name="bez gier")
    assert _req(srv, "GET", "/v1/gog/games", no_games)[0] == 403
    _did, tok = keyhelp.device("Gracz", games=True)
    st, body = _req(srv, "GET", "/v1/gog/games", tok)
    assert st == 200 and body["games"][0]["product_id"] == PID
    st, info = _req(srv, "GET", "/v1/info", tok)
    assert "gog" in info["features"]


def test_http_chunks_only_from_pinned_build(srv, arc):  # noqa: F811
    root, _ = arc
    _index(root)
    _did, tok = keyhelp.device("Gracz", games=True)
    st, man = _req(srv, "GET", f"/v1/gog/games/{PID}/builds/{BUILD}/manifest", tok)
    assert st == 200
    h = man["hash"]
    c = man["manifests"]["depot"][next(iter(man["manifests"]["depot"]))]["depot"]["items"][0]["chunks"][0]
    q = f"pid={PID}&build={BUILD}&hash={h}"
    st, data = _req(srv, "GET", f"/v1/gog/chunks/{c['compressedMd5']}?{q}", tok)
    assert st == 200 and isinstance(data, bytes) and len(data) == c["compressedSize"]
    # chunk spoza buildu (podrzucony do archiwum) — nie wydajemy
    stray = root / "chunks" / "ab" / "cd" / ("abcd" + "0" * 28)
    stray.parent.mkdir(parents=True, exist_ok=True)
    stray.write_bytes(b"x")
    assert _req(srv, "GET", f"/v1/gog/chunks/{'abcd' + '0' * 28}?{q}", tok)[0] == 404
    # inny hash (build zmienił się od przypięcia) — jednoznaczny błąd
    st, body = _req(srv, "GET", f"/v1/gog/chunks/{c['compressedMd5']}?pid={PID}&build={BUILD}&hash={'0' * 64}", tok)
    assert st == 409 and body.get("changed")
    # zniekształcone identyfikatory i próby wyjścia poza archiwum
    for path in (f"/v1/gog/chunks/..%2f..%2farchive.json?{q}", f"/v1/gog/games/..%2f{PID}",
                 f"/v1/gog/games/{PID}/builds/..%2f..%2farchive/manifest", f"/v1/gog/chunks/{c['compressedMd5']}?pid=../x&build={BUILD}&hash={h}"):
        assert _req(srv, "GET", path, tok)[0] == 404, path


def test_http_corrupt_chunk_on_server_is_reported(srv, arc):  # noqa: F811
    root, _ = arc
    _index(root)
    _did, tok = keyhelp.device("Gracz", games=True)
    man = _req(srv, "GET", f"/v1/gog/games/{PID}/builds/{BUILD}/manifest", tok)[1]
    c = man["manifests"]["depot"][next(iter(man["manifests"]["depot"]))]["depot"]["items"][0]["chunks"][0]
    p = ga.Archive(root).chunk_path(c["compressedMd5"])
    p.write_bytes(bytes(len(p.read_bytes())))               # ten sam rozmiar, zła treść
    st, body = _req(srv, "GET", f"/v1/gog/chunks/{c['compressedMd5']}?pid={PID}&build={BUILD}&hash={man['hash']}", tok)
    assert st == 409 and "uszkodzony" in body["error"]


# ── poprawki z przeglądu kodu ──

def _wait_index():
    import time
    for _ in range(250):
        if not ga.status()["running"]:
            return
        time.sleep(0.02)
    raise AssertionError("indeks nie skończył się")


def test_reverified_record_keeps_pinned_build(arc):
    root, _ = arc
    _index(root)
    h = ga.INDEX["builds"][(PID, BUILD)]["hash"]
    rp = root / "products" / PID / f"{BUILD}.json"
    rec = json.loads(rp.read_text())
    rec["verified"] = "2030-01-01T00:00:00"                          # GOG Manager: ponowna weryfikacja
    rp.write_text(json.dumps(rec, indent=1))
    os.utime(rp, (2, 2))
    assert ga.pinned(PID, BUILD, h)["hash"] == h                    # ten sam build — instalacje trwają dalej
    assert ga.build_manifest(PID, BUILD)["hash"] == h


def test_path_change_during_indexing_is_not_lost(arc, tmp_path, monkeypatch):
    import threading
    root, _ = arc
    other = tmp_path / "_depots2"
    build_archive(other)
    gate = threading.Event()
    real = ga.build_index

    def slow(r, deep=False, publish=None):
        if r == str(root):
            gate.wait(5)
        return real(r, deep, publish)
    monkeypatch.setattr(ga, "build_index", slow)
    ga.refresh(str(root))                       # indeksowanie A trwa…
    ga.refresh(str(other))                      # …admin zmienia ścieżkę na B
    gate.set()
    _wait_index()
    assert ga.status()["root"] == str(other) and ga.status()["builds"] == 1


def test_clearing_path_during_indexing_unpublishes(arc, monkeypatch):
    import threading
    root, _ = arc
    gate = threading.Event()
    real = ga.build_index

    def slow(r, deep=False, publish=None):
        gate.wait(5)
        return real(r, deep, publish)
    monkeypatch.setattr(ga, "build_index", slow)
    ga.refresh(str(root))
    ga.refresh("")                              # admin wyłącza GOG w trakcie indeksowania
    assert ga.status()["builds"] == 0
    gate.set()
    _wait_index()
    assert ga.status()["root"] == "" and ga.status()["builds"] == 0 and ga.catalog() == []


def test_complete_build_is_published_during_indexing(arc):
    root, _ = arc
    got = []
    res = ga.build_index(str(root), publish=lambda e, add: got.append(e))
    assert [e["build_id"] for e in got] == [BUILD] and (PID, BUILD) in res["builds"]


def test_chunk_sizes_listed_per_folder_and_relisted_once(arc):
    root, _ = arc
    sizes = ga.ChunkSizes(ga.Archive(root))
    md5 = next(p.name for p in (root / "chunks").rglob("*") if p.is_file())
    assert sizes.get(md5) == (root / "chunks" / md5[:2] / md5[2:4] / md5).stat().st_size
    missing = md5[:4] + "0" * 28
    late = root / "chunks" / md5[:2] / md5[2:4] / missing
    late.write_bytes(b"x")                       # dopisany po pierwszym listowaniu (GOG Manager w trakcie)
    assert sizes.get(missing) == 1               # brak → jedno ponowne listowanie folderu
    late.unlink()


def test_build_with_missing_chunk_is_withdrawn_after_chunk_pass(arc):
    root, _ = arc
    next(p for p in (root / "chunks").rglob("*") if p.is_file()).unlink()
    events = []
    res = ga.build_index(str(root), publish=lambda e, add: events.append((e["build_id"], add)))
    assert events == [(BUILD, True), (BUILD, False)]            # najpierw udostępniony, po sprawdzeniu wycofany
    assert not res["builds"] and "brakujące chunki: 1" in res["rejected"][0]["reason"]


# ── pamięć podręczna indeksu (niezmieniony build nie jest sprawdzany od nowa) ──

def _count(monkeypatch, name):
    calls = []
    real = getattr(ga, name)

    def wrap(*a, **k):
        calls.append(a[1:3])
        return real(*a, **k)
    monkeypatch.setattr(ga, name, wrap)
    return calls


def test_unchanged_build_comes_from_cache(arc, monkeypatch):
    root, _ = arc
    _index(root)
    h = ga.INDEX["builds"][(PID, BUILD)]["hash"]
    assert ga._cache_path().is_file()
    recs, chunks = _count(monkeypatch, "index_record"), _count(monkeypatch, "chunk_problem")
    st = _index(root)                                            # restart serwera / „Odśwież indeks”
    assert (recs, chunks) == ([], [])
    assert st["builds"] == 1 and not st["rejected"]
    e = ga.INDEX["builds"][(PID, BUILD)]
    assert e["hash"] == h and e["chunks"] is None                # lista chunków dopiero przy zapytaniu o build
    assert ga.game(PID)["builds"][0]["languages"] == ["en", "pl"]


def test_cached_build_serves_only_its_chunks(arc):
    root, _ = arc
    _index(root)
    _index(root)
    h = ga.INDEX["builds"][(PID, BUILD)]["hash"]
    f = all_chunk_files(root)[0]
    assert ga.chunk_bytes(PID, BUILD, h, f.name) == f.read_bytes()
    with pytest.raises(ga.ArchiveError):
        ga.chunk_bytes(PID, BUILD, h, "0" * 32)                  # nie należy do buildu
    ga.INDEX["builds"][(PID, BUILD)]["chunks"] = None
    assert ga.build_manifest(PID, BUILD)["hash"] == h            # manifest buildu też uzupełnia listę
    assert f.name in ga.INDEX["builds"][(PID, BUILD)]["chunks"]


class _Crash(BaseException):
    """Serwer zamknięty w trakcie indeksu (przechodzi przez `except Exception`)."""


def test_cache_survives_restart_in_the_middle_of_the_index(arc, monkeypatch):
    root, _ = arc
    second = "778"                                               # drugi build tej samej gry
    d = root / "products" / PID
    rec = json.loads((d / f"{BUILD}.json").read_text(encoding="utf-8"))
    (d / f"{second}.json").write_text(json.dumps({**rec, "build_id": second}), encoding="utf-8")
    (d / f"{second}.meta.json").write_bytes((d / f"{BUILD}.meta.json").read_bytes())
    monkeypatch.setattr(ga, "CACHE_SAVE_EVERY", 1)
    real = ga.chunk_problem
    seen = []

    def crash_on_second(*a, **k):
        seen.append(1)
        if len(seen) == 2:
            raise _Crash()
        return real(*a, **k)
    monkeypatch.setattr(ga, "chunk_problem", crash_on_second)
    with pytest.raises(_Crash):
        _index(root)                                             # restart przed końcem pierwszego indeksu
    saved = json.loads(ga._cache_path().read_text(encoding="utf-8"))["builds"]
    assert sorted(saved) == [f"{PID}/{BUILD}"]                   # to, co sprawdzone, jest w pamięci
    monkeypatch.setattr(ga, "chunk_problem", real)
    ga.INDEX.update(running=False)
    recs = _count(monkeypatch, "index_record")
    st = _index(root)                                            # następny start
    assert recs == [(PID, second)]                               # sprawdzana tylko reszta
    assert st["builds"] == 2 and not st["rejected"]


def test_changed_record_is_indexed_again(arc, monkeypatch):
    root, _ = arc
    _index(root)
    rp = root / "products" / PID / f"{BUILD}.json"
    os.utime(rp, (5, 5))                                         # GOG Manager zapisał rekord ponownie
    recs = _count(monkeypatch, "index_record")
    _index(root)
    assert recs == [(PID, BUILD)]


def test_cache_of_other_root_or_deep_index_is_ignored(arc, tmp_path, monkeypatch):
    root, _ = arc
    _index(root)
    other = tmp_path / "_depots2"
    build_archive(other)
    recs = _count(monkeypatch, "index_record")
    _index(other)                                                # inna ścieżka archiwum
    assert recs == [(PID, BUILD)]
    recs.clear()
    ga.refresh(str(other), deep=True, wait=True)                 # „dokładnie”: zawsze pełne sprawdzenie
    assert recs == [(PID, BUILD)]


def test_missing_chunk_after_caching_fails_the_install_not_the_index(arc):
    root, _ = arc
    _index(root)
    f = all_chunk_files(root)[0]
    f.unlink()
    st = _index(root)
    assert st["builds"] == 1                                     # ufamy weryfikacji GOG Managera…
    h = ga.INDEX["builds"][(PID, BUILD)]["hash"]
    with pytest.raises(FileNotFoundError):                       # …brak wychodzi przy wysyłce (HTTP 404/błąd)
        ga.chunk_bytes(PID, BUILD, h, f.name)
    ga.refresh(str(root), deep=True, wait=True)
    assert ga.status()["builds"] == 0                            # „dokładnie” wycofuje build
