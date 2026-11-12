"""Poprawki z code review PR #25 (2026-11-12): plik kroków chroniony skrótem, klucze systemowe zablokowane,
cofanie przed usunięciem plików, niecofnięte kroki ponawiane, Execute nie blokuje instalacji, ścieżki względne
w skryptach, {commondocs}, DWORD z nieznaną zmienną, kroki „compat” bez wiecznego UAC, język wpisów Inno."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from emustart import gogadmin, gogexec, gogfinal, goginstall as gi, goglib
from gogadminhelp import fake_reg, run_main, steps_file  # noqa: F401  (fixture)
from goghelp import PID, SCRIPT, build_archive
from test_gog_exec import fake_inno_exe
from test_gog_install import _install, env  # noqa: F401  (fixture)


# ── #9: plik kroków podmieniony przed zgodą UAC, klucze systemowe, argumenty cmd ──

def test_tampered_steps_file_is_rejected(fake_reg):
    p = steps_file(fake_reg["dir"], [{"kind": "reg_set", "subkey": "Software\\Gra", "name": "x", "t": 1, "v": "1"}])
    sha = hashlib.sha256(p.read_bytes()).hexdigest()
    p.write_text(json.dumps({"steps": [{"kind": "reg_set", "subkey": "Software\\Zly", "name": "x", "t": 1, "v": "1"}]}))
    assert gogadmin.main(str(p), sha) == 1 and gogadmin.main(str(p), "") == 1
    assert fake_reg["reg"].data == {}


@pytest.mark.parametrize("sub,name", [
    ("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Image File Execution Options\\gra.exe", "Debugger"),
    ("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", "x"),
    ("SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\RunOnce", "x"),
    ("SOFTWARE\\Classes\\CLSID\\{x}", "x"),
    ("SOFTWARE\\Policies\\Microsoft\\Windows", "x"),
    ("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Windows", "AppInit_DLLs"),
])
def test_system_keys_rejected(fake_reg, sub, name):
    p = steps_file(fake_reg["dir"], [{"kind": "reg_set", "subkey": sub, "name": name, "t": 1, "v": "1"}])
    assert run_main(p) == 1 and fake_reg["reg"].data == {}


def test_game_keys_and_compat_flags_still_allowed(fake_reg):
    p = steps_file(fake_reg["dir"], [
        {"kind": "reg_set", "subkey": "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers",
         "name": "D:\\Gry\\gra.exe", "t": 1, "v": "HIGHDPIAWARE"},
        {"kind": "reg_set", "subkey": "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\AoW.exe", "name": "Path",
         "t": 1, "v": "D:\\Gry\\"},
        {"kind": "reg_set", "subkey": "SOFTWARE\\Bethesda Softworks\\Oblivion", "name": "Installed Path", "t": 1, "v": "D:\\"}])
    assert run_main(p) == 0


def test_bat_exec_args_with_cmd_metacharacters_rejected(fake_reg, tmp_path, monkeypatch):
    game = tmp_path / "gra"
    game.mkdir()
    (game / "goggame-1.info").write_text("{}")
    (game / "x.bat").write_text("@echo off")
    runs = []
    monkeypatch.setattr(gogadmin, "RUN", lambda *a, **k: runs.append(a))
    p = steps_file(fake_reg["dir"], [{"kind": "exec", "exe": str(game / "x.bat"), "args": "a & calc.exe", "root": str(game)}])
    assert run_main(p) == 1 and runs == []


# ── #1, #2: cofanie przed usunięciem plików; niecofnięte kroki ponawiane ──

AC3 = '@ECHO OFF\r\nSET locpath=%~dp0\r\nregsvr32 /s "%locpath%ac3filter.ax"\r\nexit\r\n'


def _game_with_regsvr(env):
    env["root"] = env["tmp"] / "_r1"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "Execute", "arguments": {"executable": "{app}/ac3.cmd", "runAsAdmin": True}}})
    build_archive(env["root"], script=s, extra_files=[("ac3.cmd", AC3.encode(), []), ("ac3filter.ax", b"MZ", [])])
    _e, target, _ = _install(env)
    return target


def test_unregister_runs_before_game_files_are_deleted(env, fake_reg, monkeypatch):
    target = _game_with_regsvr(env)
    seen = []
    monkeypatch.setattr(gogadmin, "RUN", lambda cmd, cwd=None, ok=(0,): seen.append((list(cmd), Path(cmd[-1]).exists())))
    assert goglib.GogService(lambda: {}).finish_admin(PID)["ok"]
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    unreg = [x for x in seen if "/u" in x[0]]
    assert unreg and unreg[0][1] is True                                   # plik jeszcze był
    assert not target.exists()


def test_refused_undo_is_kept_and_retried(env, fake_reg, monkeypatch):
    env["root"] = env["tmp"] / "_r2"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "setRegistry", "arguments": {
        "root": "HKEY_LOCAL_MACHINE", "subkey": "Software\\Gra", "valueName": "X", "valueData": "1"}}})
    build_archive(env["root"], script=s)
    _install(env)
    svc = goglib.GogService(lambda: {})
    assert svc.finish_admin(PID)["ok"]
    accept = gogfinal._shell_runas
    monkeypatch.setattr(gogfinal, "_shell_runas", lambda *a, **k: False)            # odmowa przy odinstalowaniu
    assert gi.uninstall(PID, remove_hkcu=lambda a: None)["admin_left"] > 0
    assert gi.pending_undo() and gi.load_entry(PID) is None
    assert fake_reg["reg"].data                                                   # wpisy zostały
    monkeypatch.setattr(gogfinal, "_shell_runas", accept)                          # następne okno: zgoda
    assert svc.finish_admin_all()["ok"]
    assert gi.pending_undo() == [] and fake_reg["reg"].data == {}


# ── #3, #4, #5, #6 ──

def _apply(tmp_path, *actions, folders=None):
    app = tmp_path / "g"
    app.mkdir(exist_ok=True)
    (app / "goggame-1.script").write_text(json.dumps({"actions": list(actions)}), encoding="utf-8")
    return app, gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "Dok",
                                      folders=folders if folders is not None else {}, known=set())


def test_execute_we_cannot_run_is_skipped_not_fatal(tmp_path):
    app, r = _apply(tmp_path,
                    {"install": {"action": "Execute", "arguments": {"executable": "{sys}/regsvr32.exe", "argument": "/s x.dll"}}},
                    {"install": {"action": "Execute", "arguments": {"executable": "{app}/setup.msi"}}})
    assert len(r["skipped"]) == 2 and all(x.startswith("Execute:") for x in r["skipped"])


def test_relative_paths_in_cmd_resolved_against_script_folder():
    d = Path("D:/Gry/X/add")
    assert gogexec.parse_cmd("regsvr32 /s codec.ax\r\n", d) == [{"op": "regsvr", "file": str(d / "codec.ax")}]
    fw = gogexec.parse_cmd('netsh advfirewall firewall add rule name="G" dir=in action=allow program=game.exe\r\n', d)
    assert fw[0]["program"] == str(d / "game.exe")


def test_commondocs_is_an_allowed_write_target(tmp_path):
    (tmp_path / "g" / "1").mkdir(parents=True)
    (tmp_path / "g" / "1" / "a.ini").write_text("x")
    pub = tmp_path / "Publiczne"
    _app, r = _apply(tmp_path, {"install": {"action": "supportData", "arguments": {
        "source": "{supportDir}/1", "target": "{commondocs}/Gra", "type": "folder"}}}, folders={"winPublicDocuments": str(pub)})
    assert (pub / "Gra" / "a.ini").is_file()


def test_dword_with_unknown_variable_runs_script_unchanged():
    assert gogexec.parse_cmd('REG ADD "HKLM\\Software\\X" /v Y /t REG_DWORD /d %NIEZNANA% /f\r\n', Path("D:/G")) is None


# ── #8: krok „compat”, który ciągle zawodzi, nie wraca co start; x64 na 32-bitowym Windows ──

def test_failing_compat_step_stops_after_three_tries(env, fake_reg, monkeypatch):
    monkeypatch.setattr(gogfinal, "RUNTIME_CHECK", lambda did, arch: False)

    def run(cmd, cwd=None, ok=(0,)):
        if str(cmd[0]).endswith("vc_redist.x64.exe"):
            raise RuntimeError("kod 1603")
    monkeypatch.setattr(gogadmin, "RUN", run)
    _install(env)
    svc = goglib.GogService(lambda: {})
    for _ in range(gi.ADMIN_TRIES):
        svc.finish_admin_all()
    e = gi.load_entry(PID)
    assert svc.admin_pending() == [] and [a["id"] for a in e["finalize"]["admin_failed"]] == ["MSVC2017"]


def test_x64_runtime_not_queued_on_32bit_windows(tmp_path, monkeypatch):
    d = tmp_path / "g" / "__redist" / "MSVC2013"
    d.mkdir(parents=True)
    for n in ("vcredist_x86.exe", "vcredist_x64.exe"):
        (d / n).write_bytes(b"MZ")
    monkeypatch.setattr(gogfinal, "windows_64", lambda: False)
    assert [s["arch"] for s in gogfinal.runtime_steps(tmp_path / "g", ["MSVC2013"], check=False)] == ["x86"]


# ── #10: wpisy Inno dla innych języków ──

def test_inno_entries_for_other_languages_skipped(tmp_path):
    exe = fake_inno_exe(tmp_path / "galaxy_x.exe", [
        _inno_lang(1, "SOFTWARE\\Gra", "Language", "english", "english"),
        _inno_lang(1, "SOFTWARE\\Gra", "Language", "polish", "polish"),
        _inno_lang(1, "SOFTWARE\\Gra", "Wspolne", "1", "")])
    from emustart import goginno
    pl = {(e["name"], e["data"]) for e in goginno.game_registry(exe, True, "polish")}
    assert pl == {("Language", "polish"), ("Wspolne", "1")}
    assert {(e["name"], e["data"]) for e in goginno.game_registry(exe, True, "")} == {("Wspolne", "1")}


def _inno_lang(root, subkey, name, data, langs):
    from test_gog_exec import _inno_str
    strs = [subkey, name, data, "Component0", "", langs, "", "", ""]
    return (b"".join(_inno_str(x) for x in strs) + bytes(20) + (root | 0x80000000).to_bytes(4, "little")
            + (-1).to_bytes(2, "little", signed=True) + bytes([1]) + b"\x00\x00")
