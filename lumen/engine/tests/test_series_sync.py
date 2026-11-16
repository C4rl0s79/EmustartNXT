"""Silnik Lumena: series_sync — wynik serii z serwera (GET /v1/series) i dosłanie tytułów Steam (POST)."""

from __future__ import annotations

import json
import types

from emustart import netsrc
from emustart.api import Api


def _api():
    ns = types.SimpleNamespace(_cfg={})
    ns._series_get = lambda *a, **k: Api._series_get(ns, *a, **k)
    return ns


def test_gets_server_series_and_posts_only_steam_titles(monkeypatch):
    posted = []
    monkeypatch.setattr(netsrc, "endpoint", lambda cfg: ("h", 1, "k"))
    monkeypatch.setattr(netsrc, "_request", lambda ep, path, timeout=5, gzip=False: (
        200, json.dumps({"ok": True, "enabled": True, "pending": 3,
                         "series": {"snes|chrono trigger": {"name": "Chrono", "order_ts": 1, "release_ts": 1}}}).encode(), 0))

    def post(cfg, path, data):
        posted.append((path, data))
        return {"ok": True, "pending": 1, "series": {"pc|yakuza 0": {"name": "Yakuza", "order_ts": 2}, "pc|tetris": None}}
    monkeypatch.setattr(netsrc, "authed_post", post)
    r = Api.series_sync(_api(), [{"title": "Yakuza 0", "platform": "pc"}, {"title": ""},
                                 {"title": "Chrono Trigger", "platform": "snes"}])   # znana — nie wysyłana
    assert r["ok"] and r["pending"] == 3 and r["own_pending"] == 0
    assert set(r["series"]) == {"snes|chrono trigger", "pc|yakuza 0"}
    assert posted == [("/v1/series", {"games": [{"title": "Yakuza 0", "platform": "pc"}]})]


def test_old_server_and_no_server(monkeypatch):
    monkeypatch.setattr(netsrc, "endpoint", lambda cfg: None)
    assert not Api.series_sync(_api(), [])["ok"]
    monkeypatch.setattr(netsrc, "endpoint", lambda cfg: ("h", 1, "k"))
    monkeypatch.setattr(netsrc, "_request", lambda ep, path, timeout=5, gzip=False: (404, b"", 0))
    r = Api.series_sync(_api(), [])
    assert not r["ok"] and "starszą" in r["reason"]


def test_without_server_keys_nothing_is_posted(monkeypatch):
    monkeypatch.setattr(netsrc, "endpoint", lambda cfg: ("h", 1, "k"))
    monkeypatch.setattr(netsrc, "_request", lambda ep, path, timeout=5, gzip=False: (
        200, b'{"ok": true, "enabled": false, "series": {}, "pending": 0}', 0))
    monkeypatch.setattr(netsrc, "authed_post", lambda *a: (_ for _ in ()).throw(AssertionError("bez kluczy IGDB")))
    assert Api.series_sync(_api(), [{"title": "Yakuza 0", "platform": "pc"}])["enabled"] is False


def test_series_progress(monkeypatch):
    """Pasek „Serie z IGDB” (2026-11-16): sam postęp z serwera; stary serwer i brak sieci — powód."""
    prog = {"running": True, "done": 40, "total": 100, "checked": 3, "in_series": 1, "last_batch": 1.0, "error": ""}
    monkeypatch.setattr(netsrc, "endpoint", lambda cfg: ("h", 1, "k"))
    seen = []

    def req(ep, path, timeout=5, gzip=False):
        seen.append(path)
        return 200, json.dumps({"ok": True, "enabled": True, "pending": 60, "progress": prog}).encode(), 0
    monkeypatch.setattr(netsrc, "_request", req)
    assert Api.series_progress(_api()) == {"ok": True, "enabled": True, "progress": prog}
    assert seen == ["/v1/series/progress"]
    monkeypatch.setattr(netsrc, "_request", lambda ep, path, timeout=5, gzip=False: (404, b"", 0))
    assert "starszą" in Api.series_progress(_api())["reason"]

    def down(ep, path, timeout=5, gzip=False):
        raise ConnectionRefusedError()
    monkeypatch.setattr(netsrc, "_request", down)
    assert Api.series_progress(_api()) == {"ok": False, "reason": "Brak połączenia z serwerem EmuStart."}
