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
    n = len(gi.load_entry(PID)["finalize"]["admin_done"])
    monkeypatch.setattr(gogfinal, "_shell_runas", lambda *a, **k: False)          # odmowa przy odinstalowaniu
    u = gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert u["admin_left"] == 2 * n and not target.exists()       # nic nie cofnięte (2 widoki), pliki usunięte


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
    base = len(gi.load_entry(PID)["finalize"]["admin_done"])
    e = gi.load_entry(PID)                                    # DLC z własnym krokiem HKLM
    e["state"] = gi.ST_NEEDS_ADMIN
    e["finalize"]["admin"] = [{"root": "HKLM", "subkey": "Software\\GOG.com\\Games\\2001", "name": "PATH",
                               "type": "string", "data": "x"}]
    gi.save_entry(e)
    assert svc.finish_admin(PID)["ok"]
    assert len(gi.load_entry(PID)["finalize"]["admin_done"]) == base + 1
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


# ── etap 2: rejestr GOG.com\Games\<id> jak po instalatorze GOG ──

def test_every_game_gets_gog_registry_values_but_stays_playable(env, fake_reg):
    """Bez HKLM w skrypcie: gra „zainstalowana” od razu (wpisy czekają na okno UAC przy starcie Lumena)."""
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED
    acts = {a["name"]: a["data"] for a in e["finalize"]["admin"]}
    assert all(a.get("compat") for a in e["finalize"]["admin"])
    assert acts["PATH"] == str(target) and acts["gameID"] == PID and acts["EXEFILE"] == "game.exe"
    assert acts["EXE"] == str(target / "bin" / "game.exe") and acts["LAUNCHPARAM"] == "-lang en-US"
    assert acts["LAUNCHCOMMAND"] == f"{target / 'bin' / 'game.exe'} -lang en-US" and acts["LANGUAGE"] == "english"
    assert acts["WORKINGDIR"] == str(target / "bin") + "\\" and acts["GAMENAME"] == "Testowa Gra"
    svc = goglib.GogService(lambda: {})
    assert svc.admin_pending() == [PID]
    r = svc.finish_admin_all()
    assert r["ok"] and r["games"] == 1 and len(fake_reg["calls"]) == 1
    assert fake_reg["reg"].data[("32", KEY, "PATH")] == (gogadmin.REG_SZ, str(target))
    assert svc.admin_pending() == [] and svc.finish_admin_all()["games"] == 0
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert fake_reg["reg"].data == {}


def test_script_registry_value_wins_over_installer_value(env, fake_reg):
    env["root"] = env["tmp"] / "_a5"
    build_archive(env["root"], script=_hklm_script(("PATH", "{app}\\DOSBox")))
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_NEEDS_ADMIN                         # HKLM wymagany przez skrypt gry
    paths = [a for a in e["finalize"]["admin"] if a["name"].lower() == "path"]
    assert len(paths) == 1 and not paths[0].get("compat") and paths[0]["data"] == f"{target}\\DOSBox"


def test_elevated_lumen_applies_steps_at_install_without_uac(env, fake_reg, monkeypatch):
    """Lumen uruchomiony jako administrator: kroki od razu w procesie silnika, bez okna i bez „needs_admin”."""
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: True)
    env["root"] = env["tmp"] / "_a6"
    build_archive(env["root"], script=_hklm_script(("DOSBOXCONF", "dosboxP")))
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED and e["finalize"]["admin"] == [] and fake_reg["calls"] == []
    assert fake_reg["reg"].data[("64", KEY, "DOSBOXCONF")] == (gogadmin.REG_SZ, "dosboxP")
    assert fake_reg["reg"].data[("32", KEY, "PATH")] == (gogadmin.REG_SZ, str(target))
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert fake_reg["reg"].data == {} and fake_reg["calls"] == []



# ── etap 3: installSDB (bazy poprawek zgodności Windows) ──

GUID = "{08a9a822-ff12-493b-b219-f95350f7d937}"


def _sdb_script(guid=GUID, sdb="{app}/goggame.sdb"):
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "installSDB", "arguments": {"GUID": guid, "sdbFile": sdb}}})
    return s


@pytest.fixture()
def sdb_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(gogadmin, "SDBINST", calls.append)
    return calls


def test_install_sdb_runs_in_admin_step_and_uninstall_removes_it(env, fake_reg, sdb_calls):
    env["root"] = env["tmp"] / "_s1"
    build_archive(env["root"], script=_sdb_script(), extra_files=[("goggame.sdb", b"sdbf", [])])
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_NEEDS_ADMIN                       # wymagane przez skrypt gry
    assert goglib.GogService(lambda: {}).finish_admin(PID)["ok"] and len(fake_reg["calls"]) == 1
    assert sdb_calls == [["-q", str(target / "goggame.sdb")]]
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert sdb_calls[-1] == ["-q", "-u", "-g", GUID]


def test_sdb_guid_with_inno_double_brace_and_bad_paths(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    (app / "goggame.sdb").write_bytes(b"x")
    (app / "x.dll").write_bytes(b"x")
    (tmp_path / "poza.sdb").write_bytes(b"x")

    def script(args):
        (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "installSDB", "arguments": args}}]}))
        return gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "docs", folders={})
    r = script({"GUID": "{{9CAEEA89-0174-4aac-9544-9EBF76CCAB8E}", "sdbFile": "{app}/goggame.sdb"})   # Earth 2150
    assert r["admin"] == [{"op": "sdb", "file": str(app / "goggame.sdb"), "guid": "{9caeea89-0174-4aac-9544-9ebf76ccab8e}"}]
    for bad in ({"GUID": GUID, "sdbFile": "{app}/../poza.sdb"}, {"GUID": GUID, "sdbFile": "{app}/x.dll"},
                {"GUID": "nie-guid", "sdbFile": "{app}/goggame.sdb"}, {"GUID": GUID, "sdbFile": "{app}/brak.sdb"}):
        with pytest.raises(gogfinal.FinalizeError):
            script(bad)


def test_shared_sdb_guid_stays_while_another_game_uses_it(env, fake_reg, sdb_calls):
    """Dungeon Keeper 2 i Vampire: ta sama baza zgodności — odinstalowanie jednej gry jej nie usuwa."""
    env["root"] = env["tmp"] / "_s2"
    build_archive(env["root"], script=_sdb_script(), extra_files=[("goggame.sdb", b"sdbf", [])])
    _install(env)
    assert goglib.GogService(lambda: {}).finish_admin(PID)["ok"]
    other = {"product_id": "1207666893", "title": "Inna gra", "state": gi.ST_INSTALLED, "install_dir": str(env["tmp"] / "x"),
             "finalize": {"admin_done": [{"act": {"op": "sdb", "file": "C:/x/goggame.sdb", "guid": GUID}, "prev": None}]}}
    gi._entry_path("1207666893").write_text(json.dumps(other), encoding="utf-8")
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert ["-q", "-u", "-g", GUID] not in sdb_calls


@pytest.mark.parametrize("step", [
    {"kind": "sdb_install", "file": "goggame.sdb", "guid": GUID},                       # ścieżka względna
    {"kind": "sdb_install", "file": "C:/Windows/System32/notepad.exe", "guid": GUID},
    {"kind": "sdb_remove", "guid": "{zly}"},
])
def test_elevated_process_validates_sdb_steps(fake_reg, sdb_calls, step):
    p = steps_file(fake_reg["dir"], [step])
    assert gogadmin.main(str(p)) == 1 and sdb_calls == []
