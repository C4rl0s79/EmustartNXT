"""Warunki akcji skryptów GOG (onlyOnce, onLanguageChange, overwrite, saveGameData) i synchronizacja po instalacji:
ustawienia domyślnie synchronizowane, stan synchronizacji kasowany przy (od)instalowaniu, „świeża instalacja” —
pliki z serwera zastępują wgrane przez instalator bez pytania (bieżące idą do kopii zapasowej)."""

from __future__ import annotations

import json
import types

from emustart import gogfinal, goginstall as gi, gogsaves, syncclient
from goghelp import PID
from test_gog_install import _install, env  # noqa: F401  (fixture)


def _script(app, *actions):
    (app / "goggame-1.script").write_text(json.dumps({"actions": list(actions)}), encoding="utf-8")


def _apply(app, tmp_path, once=None):
    return gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "Dok", folders={}, known=set(), once=once)


def test_only_once_runs_once_per_install(tmp_path, monkeypatch):
    app = tmp_path / "g"
    app.mkdir()
    (app / "clean.bat").write_text("@echo off\r\ndel x\r\n")
    ran = []
    monkeypatch.setattr(gogfinal, "RUN_LOCAL", lambda exe, args, cwd: ran.append(exe.name))
    _script(app, {"install": {"action": "Execute", "arguments": {"conditions": ["onlyOnce"], "executable": "{app}/clean.bat"}}})
    r1 = _apply(app, tmp_path)
    assert ran == ["clean.bat"] and len(r1["once"]) == 1
    r2 = _apply(app, tmp_path, once=set(r1["once"]))
    assert ran == ["clean.bat"] and "onlyOnce" in r2["skipped"][0]


def test_language_and_version_change_actions_skipped_at_install(tmp_path):
    app = tmp_path / "g"
    (app / "ICE").mkdir(parents=True)
    (app / "ICE" / "ICE.PCK").write_text("x")
    _script(app, {"install": {"action": "deleteData", "arguments": {"conditions": ["onLanguageChange"],
                                                                    "target": "{app}/ICE/ICE.PCK", "type": "file"}}},
            {"install": {"action": "setIni", "arguments": {"conditions": ["onVersionChange "], "filename": "{app}/a.ini",
                                                           "section": "s", "keyName": "k", "keyValue": "v"}}})
    r = _apply(app, tmp_path)
    assert len(r["skipped"]) == 2 and (app / "ICE" / "ICE.PCK").exists() and not (app / "a.ini").exists()


def test_existing_player_files_not_overwritten(tmp_path):
    """overwrite: false (Divinity) i saveGameData: true (Oblivion) — plik gracza zostaje, brakujące są kopiowane."""
    app = tmp_path / "g"
    (app / "1").mkdir(parents=True)
    (app / "1" / "Oblivion.ini").write_text("domyślne")
    (app / "1" / "Nowy.ini").write_text("nowy")
    out = tmp_path / "Dok" / "My Games" / "Oblivion"
    out.mkdir(parents=True)
    (out / "Oblivion.ini").write_text("ustawienia gracza")
    _script(app, {"install": {"action": "supportData", "arguments": {
        "overwrite": True, "saveGameData": True, "source": "{supportDir}/1", "target": "{userdocs}/My Games/Oblivion", "type": "folder"}}})
    _apply(app, tmp_path)
    assert (out / "Oblivion.ini").read_text() == "ustawienia gracza" and (out / "Nowy.ini").read_text() == "nowy"


def test_config_sync_on_by_default():
    assert gogsaves.settings("1999999999")["config"] is True


def test_install_and_uninstall_forget_sync_state(env, monkeypatch):
    calls = []
    monkeypatch.setattr(syncclient, "forget_game", lambda plat, gid: calls.append((plat, gid)))
    e, _t, _ = _install(env)
    assert calls == [("gog", PID)] and e["fresh_sync"] is True
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert calls == [("gog", PID), ("gog", PID)]


def test_forget_game_deletes_rows_of_that_game_only():
    with syncclient._db() as c:
        for g in ("1", "2"):
            c.execute("INSERT OR REPLACE INTO save_sync(profile_id, platform, game, slot, emu, core, kind) "
                      "VALUES(1, 'gog', ?, 1, 'gog', 's', 'saves')", (g,))
    assert syncclient.forget_game("gog", "1") == 1
    left = [r[0] for r in syncclient._db().execute("SELECT game FROM save_sync WHERE platform='gog'")]
    assert left == ["2"]
    syncclient.forget_game("gog", "2")


def test_fresh_install_takes_server_files_without_conflict(monkeypatch):
    b = types.SimpleNamespace(error="", key=("gog", "s", "saves"))
    got = {"download": 0, "before_one": 0}
    monkeypatch.setattr(syncclient, "_Client", lambda cfg, prof: types.SimpleNamespace(manifest=lambda p, g: {}))
    monkeypatch.setattr(syncclient, "_server_bundle", lambda man, b, slot: {"revision": 3, "download_url": "/x"})
    monkeypatch.setattr(syncclient, "_state", lambda *a: None)
    monkeypatch.setattr(syncclient, "_download", lambda *a: got.__setitem__("download", got["download"] + 1))
    monkeypatch.setattr(syncclient, "_before_one", lambda *a: got.__setitem__("before_one", got["before_one"] + 1))
    r = gogsaves.before({}, 1, PID, [b], fresh=True)
    assert got == {"download": 1, "before_one": 0} and r.downloaded == 1 and not r.conflicts
    gogsaves.before({}, 1, PID, [b], fresh=False)                 # zwykła gra — porównanie jak dotąd
    assert got["before_one"] == 1
