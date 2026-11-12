"""Biblioteki systemowe z zależności GOG (VC++, DirectX): wykrywanie bez uprawnień, zapamiętanie udanej instalacji,
kroki administratora (jedno okno UAC z resztą), kody 1638/1641/3010 jako sukces, instalatory x86 i x64 w jednym folderze."""

from __future__ import annotations

import pytest

from emustart import gogadmin, gogfinal, goginstall as gi, goglib
from gogadminhelp import fake_reg, steps_file  # noqa: F401  (fixture)
from goghelp import PID
from test_gog_install import _install, env  # noqa: F401  (fixture)


@pytest.fixture()
def winroot(tmp_path, monkeypatch):
    root = tmp_path / "Windows"
    for d in ("System32", "SysWOW64", "WinSxS"):
        (root / d).mkdir(parents=True)
    monkeypatch.setenv("SystemRoot", str(root))
    monkeypatch.setattr(gogfinal, "windows_64", lambda: True)
    return root


def test_detection_rules(winroot, fake_reg):
    assert gogfinal.runtime_installed("MSVC2017", "x86") is False
    fake_reg["reg"].set("32", "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86", "Installed", 4, 1)
    assert gogfinal.runtime_installed("MSVC2017", "x86") is True
    assert gogfinal.runtime_installed("MSVC2022_x64", "x64") is False                      # x64 — inny widok
    (winroot / "SysWOW64" / "msvcr100.dll").write_bytes(b"x")
    assert gogfinal.runtime_installed("MSVC2010", "x86") is True
    assert gogfinal.runtime_installed("MSVC2010_x64", "x64") is False                      # System32
    (winroot / "WinSxS" / "x86_microsoft.vc90.crt_1fc8b3b9a1e18e3b_9.0.30729").mkdir()
    assert gogfinal.runtime_installed("MSVC2008", "x86") is True
    assert gogfinal.runtime_installed("DirectX", "x86") is False
    (winroot / "SysWOW64" / "d3dx9_43.dll").write_bytes(b"x")
    assert gogfinal.runtime_installed("DirectX", "x86") is True
    assert gogfinal.runtime_installed("PhysX", "x86") is None                              # brak reguły


def test_both_architectures_in_one_folder_and_installed_ones_skipped(tmp_path, monkeypatch):
    app = tmp_path / "g"
    d = app / "__redist" / "MSVC2013"
    d.mkdir(parents=True)
    for n in ("vcredist_x86.exe", "vcredist_x64.exe"):
        (d / n).write_bytes(b"MZ")
    monkeypatch.setattr(gogfinal, "RUNTIME_CHECK", lambda did, arch: arch == "x64")
    steps = gogfinal.runtime_steps(app, ["MSVC2013"])
    assert [(s["arch"], s["exe"].endswith("vcredist_x86.exe")) for s in steps] == [("x86", True)]
    assert len(gogfinal.runtime_steps(app, ["MSVC2013"], check=False)) == 2


def test_remembered_install_used_when_no_detection_rule(tmp_path, monkeypatch):
    app = tmp_path / "g"
    (app / "__redist" / "DirectX").mkdir(parents=True)
    (app / "__redist" / "DirectX" / "DXSETUP.exe").write_bytes(b"MZ")
    monkeypatch.setattr(gogfinal, "RUNTIME_CHECK", lambda did, arch: None)
    assert len(gogfinal.runtime_steps(app, ["DirectX"])) == 1
    gogfinal.remember_runtime("DirectX:x86")
    assert gogfinal.runtime_steps(app, ["DirectX"]) == []


def test_missing_runtime_installs_in_admin_step_codes_1638_3010_ok(env, fake_reg, monkeypatch):
    monkeypatch.setattr(gogfinal, "RUNTIME_CHECK", lambda did, arch: False)
    runs = []

    def run(cmd, cwd=None, ok=(0,)):
        runs.append((cmd, ok))
    monkeypatch.setattr(gogadmin, "RUN", run)
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED                                   # biblioteka nie blokuje gry
    assert e["runtimes"] == [{"id": "MSVC2017", "arch": "x64", "done": False}]
    r = goglib.GogService(lambda: {}).finish_admin_all()
    assert r["ok"] and len(fake_reg["calls"]) == 1                         # jedno okno UAC z rejestrem GOG
    cmd, ok = next(x for x in runs if x[0][0].endswith("vc_redist.x64.exe"))
    assert cmd[1:] == ["/install", "/quiet", "/norestart"] and {1638, 3010} <= set(ok)
    assert gi.load_entry(PID)["runtimes"][0]["done"] is True
    assert "MSVC2017:x64" in gogfinal.remembered_runtimes()


def test_install_runtimes_button_skips_installed(env, fake_reg, monkeypatch):
    _install(env)
    monkeypatch.setattr(gogfinal, "RUNTIME_CHECK", lambda did, arch: True)
    r = goglib.GogService(lambda: {}).install_runtimes(PID)
    assert r["ok"] and "już zainstalowane" in r["message"] and fake_reg["calls"] == []


def test_elevated_process_rejects_runtime_outside_redist(fake_reg, monkeypatch, tmp_path):
    exe = tmp_path / "poza.exe"
    exe.write_bytes(b"MZ")
    runs = []
    monkeypatch.setattr(gogadmin, "RUN", lambda *a, **k: runs.append(a))
    p = steps_file(fake_reg["dir"], [{"kind": "runtime", "exe": str(exe), "args": "/q"}])
    assert gogadmin.main(str(p)) == 1 and runs == []
