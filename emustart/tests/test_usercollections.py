"""Kolekcje kont (emustart/usercollections.py): Lumen wysyła kategorie z grami EmuStart, APK je pobiera."""

from __future__ import annotations

import json

import keyhelp
import pytest

from emustart import paths, savesync, usercollections
from test_three_devices import _req, srv  # noqa: F401  (fixture)

MARIO = savesync.game_id("snes", "Super Mario World")
ZELDA = savesync.game_id("snes", "Legend of Zelda, The - A Link to the Past")
SONIC = savesync.game_id("megadrive", "Sonic the Hedgehog")


@pytest.fixture()
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(paths, "DATA", tmp_path / "srv")


def test_clean_drops_bad_entries_and_foreign_ids(data):
    out = usercollections.clean([
        {"id": "c1", "name": "  Ulubione\x01  na  kanapę ", "games": [MARIO, MARIO, "emu:5", "../x", 7]},
        {"id": "../zly", "name": "X", "games": [MARIO]},
        {"id": "c2", "name": "", "games": [MARIO]},
        {"id": "c3", "name": "Pusta", "games": ["nie-gra"]},
        "nie słownik",
    ])
    assert out == [{"id": "c1", "name": "Ulubione na kanapę", "games": [MARIO]}]
    for bad in (None, {"a": 1}, [{}] * (usercollections.MAX_COLLECTIONS + 1)):
        with pytest.raises(usercollections.CollectionsError):
            usercollections.clean(bad)


def test_lumen_sends_apk_reads_per_device_sets_merge_by_name(data, srv, monkeypatch):  # noqa: F811
    _d, pc = keyhelp.device("Ala", games=True)
    tvid, tv = keyhelp.device("Ala", games=True, name="tv")
    _p, phone = keyhelp.device("Ala", games=True, name="telefon")
    _b, bob = keyhelp.device("Bob", games=True, name="bob")
    st, c = _req(srv, "POST", "/v1/collections", pc, body={"items": [
        {"id": "cat1", "name": "Kanapa", "games": [MARIO, ZELDA]}, {"id": "cat2", "name": "RPG", "games": [ZELDA]}]})
    assert st == 200, c
    _req(srv, "POST", "/v1/collections", tv, body={"items": [{"id": "x9", "name": "kanapa", "games": [SONIC, MARIO]}]})
    st, c = _req(srv, "GET", "/v1/collections", phone)
    got = c["collections"]
    assert st == 200 and [g["name"] for g in got] == ["kanapa", "RPG"]   # pisownia z najnowszego zestawu
    assert sorted(got[0]["games"]) == sorted([MARIO, ZELDA, SONIC])         # ta sama nazwa — suma gier
    assert _req(srv, "GET", "/v1/collections", bob)[1]["collections"] == []   # inne konto — nic
    # pusty zestaw z TV nie rusza kolekcji z PC
    _req(srv, "POST", "/v1/collections", tv, body={"items": []})
    got = _req(srv, "GET", "/v1/collections", phone)[1]["collections"]
    assert sorted(got[0]["games"]) == sorted([MARIO, ZELDA])
    # usunięta na PC — znika
    _req(srv, "POST", "/v1/collections", pc, body={"items": [{"id": "cat2", "name": "RPG", "games": [ZELDA]}]})
    assert [g["name"] for g in _req(srv, "GET", "/v1/collections", phone)[1]["collections"]] == ["RPG"]
    # odwołane urządzenie się nie liczy
    _req(srv, "POST", "/v1/collections", tv, body={"items": [{"id": "t", "name": "Z TV", "games": [SONIC]}]})
    from emustart import devices
    devices.revoke(tvid)
    assert [g["name"] for g in _req(srv, "GET", "/v1/collections", phone)[1]["collections"]] == ["RPG"]
    # zła lista — 400, zestaw bez zmian
    st, _c = _req(srv, "POST", "/v1/collections", pc, body={"items": "x"})
    assert st == 400
    # urządzenie nieaktywne od 90 dni — pominięte
    monkeypatch.setattr(usercollections, "MAX_AGE", -1)
    assert usercollections.get("Ala")["collections"] == []


def test_info_lists_collections_feature(data, srv):  # noqa: F811
    _d, pc = keyhelp.device("Ala", games=True)
    st, c = _req(srv, "GET", "/v1/info", pc)
    assert st == 200 and "collections" in c["features"]
