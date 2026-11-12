"""Kroki administratora instalacji gier GOG (emustart/gogadmin.py): jedno okno UAC, stan sprzed instalacji,
cofanie przy odinstalowaniu, DLC, odmowa UAC, walidacja pliku kroków."""

from __future__ import annotations

import json

import pytest

from emustart import gogadmin, gogfinal, goginstall as gi, goglib
from gogadminhelp import fake_reg, steps_file  # noqa: F401  (fixture)
from goghelp import PID, SCRIPT, build_archive
from test_gog_install import FakeServer, _install, env  # noqa: F401  (fixture)

KEY = "Software\\GOG.com\\Games\\1001"


def _hklm_script(*values):
    s = json.loads(json.dumps(SCRIPT))
    for name, data in values:
        s["actions"].append({"install": {"action": "setRegistry", "arguments": {
            "root": "HKEY_LOCAL_MACHINE", "subkey": KEY, "valueName": name, "valueData": data}}})
    return s


def test_one_uac_prompt_writes_all_steps_and_uninstall_removes_them(env, fake_reg):
    env["root"] = env["tmp"] / "_a1"
    build_archive(env["root"], script=_hklm_script(("PATH", "{app}"), ("DOSBOXCONF", "dosboxP")))
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_NEEDS_ADMIN
    r = goglib.GogService(lambda: {}).finish_admin(PID)
    assert r["ok"] and len(fake_reg["calls"]) == 1                       # jedno okno UAC na wszystkie kroki
    reg = fake_reg["reg"].data
    for view in ("64", "32"):
        assert reg[(view, KEY, "PATH")] == (gogadmin.REG_SZ, str(target))
        assert reg[(view, KEY, "DOSBOXCONF")] == (gogadmin.REG_SZ, "dosboxP")
    assert gi.load_entry(PID)["state"] == gi.ST_INSTALLED
    u = gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert u["admin_left"] == 0 and reg == {} and len(fake_reg["calls"]) == 2


def test_uninstall_restores_value_that_existed_before(env, fake_reg):
    """Wartość, która była w rejestrze przed instalacją (np. inna instalacja gry), wraca przy odinstalowaniu."""
    env["root"] = env["tmp"] / "_a2"
    build_archive(env["root"], script=_hklm_script(("PATH", "{app}")))
    fake_reg["reg"].set("32", KEY, "PATH", gogadmin.REG_SZ, "C:\\Stara gra")
    _install(env)
    assert goglib.GogService(lambda: {}).finish_admin(PID)["ok"]
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert fake_reg["reg"].data == {("32", KEY, "PATH"): (gogadmin.REG_SZ, "C:\\Stara gra")}


def test_uac_refused_keeps_needs_admin_and_uninstall_still_removes_files(env, fake_reg, monkeypatch):
    env["root"] = env["tmp"] / "_a3"
    build_archive(env["root"], script=_hklm_script(("PATH", "{app}")))
    _e, target, _ = _install(env)
    svc = goglib.GogService(lambda: {})
    assert not svc.finish_admin(PID, elevate=lambda *a, **k: False)["ok"]
    assert gi.load_entry(PID)["state"] == gi.ST_NEEDS_ADMIN and fake_reg["reg"].data == {}
    assert svc.finish_admin(PID)["ok"]
    monkeypatch.setattr(gogfinal, "_shell_runas", lambda *a, **k: False)          # odmowa przy odinstalowaniu
    u = gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert u["admin_left"] == 2 and not target.exists()           # PATH w 2 widokach nie cofnięte, pliki usunięte


def test_old_admin_done_entries_are_removed(env, fake_reg):
    """Rejestr instalacji sprzed gogadmin: admin_done = same akcje (bez stanu poprzedniego)."""
    _e, _t, _ = _install(env)
    e = gi.load_entry(PID)
    e["finalize"]["admin_done"] = [{"root": "HKLM", "subkey": "Software\\T", "name": "x", "type": "string", "data": "1"}]
    gi.save_entry(e)
    for view in ("64", "32"):
        fake_reg["reg"].set(view, "Software\\T", "x", gogadmin.REG_SZ, "1")
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert fake_reg["reg"].data == {}


def test_dlc_admin_step_keeps_base_game_steps(env, fake_reg):
    env["root"] = env["tmp"] / "_a4"
    build_archive(env["root"], script=_hklm_script(("PATH", "{app}")))
    _install(env)
    svc = goglib.GogService(lambda: {})
    assert svc.finish_admin(PID)["ok"]
    e = gi.load_entry(PID)                                    # DLC z własnym krokiem HKLM
    e["state"] = gi.ST_NEEDS_ADMIN
    e["finalize"]["admin"] = [{"root": "HKLM", "subkey": "Software\\GOG.com\\Games\\2001", "name": "PATH",
                               "type": "string", "data": "x"}]
    gi.save_entry(e)
    assert svc.finish_admin(PID)["ok"]
    assert len(gi.load_entry(PID)["finalize"]["admin_done"]) == 2
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert fake_reg["reg"].data == {}


@pytest.mark.parametrize("step", [
    {"kind": "reg_set", "subkey": "SYSTEM\\CurrentControlSet\\Control", "name": "x", "t": 1, "v": "1"},
    {"kind": "reg_set", "subkey": "Software\\..\\SYSTEM", "name": "x", "t": 1, "v": "1"},
    {"kind": "exec", "subkey": "Software\\X", "name": "x"},
    {"kind": "reg_del", "view": "16", "subkey": "Software\\X", "name": "x"},
])
def test_elevated_process_rejects_unknown_steps_and_keys(fake_reg, step):
    """Plik kroków pisze proces bez uprawnień — podniesiony przyjmuje tylko znane kroki pod HKLM\\Software."""
    p = steps_file(fake_reg["dir"], [step])
    assert gogadmin.main(str(p)) == 1
    assert json.loads(p.with_suffix(".result.json").read_text())["ok"] == [False]
    assert fake_reg["reg"].data == {}


def test_self_cmd_points_to_entry_with_gog_admin():
    cmd = gogadmin.self_cmd()
    assert cmd[-1].endswith("main.py")
    src = open(cmd[-1], encoding="utf-8").read()
    assert "--gog-admin=" in src and "gogadmin.main" in src
