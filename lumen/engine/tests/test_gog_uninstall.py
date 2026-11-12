"""Deinstalator gier GOG: wartości HKCU sprzed instalacji wracają, pliki skopiowane do Dokumentów/AppData — lista
i wybór gracza (zapisy zostają zawsze)."""

from __future__ import annotations

import json
import os
import uuid

import pytest

from emustart import gogfinal, goginstall as gi, goglib
from goghelp import PID, SCRIPT, build_archive
from test_gog_install import _install, env  # noqa: F401  (fixture)


@pytest.mark.skipif(os.name != "nt", reason="rejestr Windows")
def test_hkcu_value_from_before_install_is_restored(monkeypatch):
    import winreg
    sub = f"Software\\EmuStartTest-{uuid.uuid4().hex[:8]}"
    try:
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, sub, 0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "Jezyk", 0, winreg.REG_SZ, "polski gracza")
        acts = [{"root": "HKCU", "subkey": sub, "name": "Jezyk", "type": "string", "data": "english"},
                {"root": "HKCU", "subkey": sub, "name": "Nowa", "type": "dword", "data": "1"}]
        for a in acts:
            gogfinal.set_hkcu(a)
        assert acts[0]["prev"] == {"t": winreg.REG_SZ, "v": "polski gracza"} and acts[1]["prev"] is None
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub) as k:
            assert winreg.QueryValueEx(k, "Jezyk")[0] == "english"
        gogfinal.remove_hkcu(json.loads(json.dumps(acts)))               # jak z rejestru instalacji (JSON)
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub) as k:
            assert winreg.QueryValueEx(k, "Jezyk")[0] == "polski gracza"
            with pytest.raises(FileNotFoundError):
                winreg.QueryValueEx(k, "Nowa")
    finally:
        try:
            winreg.DeleteKey(winreg.HKEY_CURRENT_USER, sub)
        except OSError:
            pass


def _game_with_docs_files(env):
    env["root"] = env["tmp"] / "_u1"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"] += [
        {"install": {"action": "supportData", "arguments": {"type": "file", "source": "{app}\\app\\dosbox.conf",
                                                            "target": "{userdocs}\\Gra\\Ustawienia"}}},
        {"install": {"action": "supportData", "arguments": {"type": "file", "source": "{app}\\app\\dosbox.conf",
                                                            "target": "{userdocs}\\Gra\\Zapisy"}}},
        {"install": {"action": "savePath", "arguments": {"savePath": "{userdocs}\\Gra\\Zapisy", "type": "folder"}}}]
    build_archive(env["root"], script=s)
    _install(env)
    return env["tmp"] / "Dokumenty" / "Gra"


def test_files_outside_game_listed_and_kept_by_default(env):
    docs = _game_with_docs_files(env)
    svc = goglib.GogService(lambda: {})
    pv = svc.uninstall_preview(PID)
    assert pv["outside"] == [str(docs / "Ustawienia" / "dosbox.conf")]        # bez folderu zapisów
    r = svc.uninstall(PID)
    assert r["ok"] and r["outside_left"] == pv["outside"] and (docs / "Ustawienia" / "dosbox.conf").exists()


def test_player_can_remove_files_outside_game_but_saves_stay(env):
    docs = _game_with_docs_files(env)
    r = goglib.GogService(lambda: {}).uninstall(PID, remove_outside=True)
    assert r["ok"] and r["outside_left"] == []
    assert not (docs / "Ustawienia" / "dosbox.conf").exists() and (docs / "Zapisy" / "dosbox.conf").exists()
    assert gi.load_entry(PID) is None
