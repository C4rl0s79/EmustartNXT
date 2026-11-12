"""Akcja Execute ze skryptów GOG (emustart/gogexec.py, gogfinal._execute): znane polecenia .cmd jako własne kroki
(cofane przy odinstalowaniu), reszta bez zmian. Treści skryptów — z prawdziwych gier archiwum GOG."""

from __future__ import annotations

import json
import stat
from pathlib import Path

import pytest

from emustart import gogadmin, gogexec, gogfinal, goginstall as gi, goglib
from gogadminhelp import fake_reg, steps_file  # noqa: F401  (fixture)
from goghelp import PID, SCRIPT, build_archive
from test_gog_install import _install, env  # noqa: F401  (fixture)

FIREWALL = ('@ECHO OFF\r\nnetsh advfirewall firewall add rule name="Empire Earth" dir=in action=allow '
            'program="%~dp0\\Empire Earth\\Empire Earth.exe" enable=yes\r\nexit\r\n')
ADD_REG = ('@echo off\r\nSET locpath=%~dp0\r\nSET locpath=%locpath:~0,-1%\r\n\r\n'
           'SET regpath="HKEY_LOCAL_MACHINE\\SOFTWARE\\Volition\\Freespace2"\r\n::echo %locpath%\r\n'
           'REG ADD %regpath% /v "EregCount" /t REG_DWORD /d 3 /f /reg:32\r\n'
           'REG ADD %regpath% /v "Videocard" /t REG_EXPAND_SZ /d "Direct 3D (1024x768)" /f /reg:32\r\nexit\r\n')
REGS = ('@echo off\r\nSET locpath=%~dp0\r\nSET locpath=%locpath:~0,-1%\r\n'
        'SET regpath="HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\AoW.exe"\r\n'
        'REG ADD %regpath% /v "Path" /t REG_SZ /d "%locpath%\\\\" /f /reg:32\r\n'
        'SET regpath="HKEY_CURRENT_USER\\Software\\Triumph Studios\\Age of Wonders\\General"\r\n'
        'REG ADD %regpath% /v "Language" /t REG_DWORD /d "00000001" /f /reg:32\r\n')
AC3 = '@ECHO OFF\r\n:: WC4 only\r\nSET locpath=%~dp0\r\nregsvr32 /s "%locpath%ac3filter.ax"\r\nexit\r\n'
DIRECTPLAY = ('@echo off\r\nIF NOT DEFINED PROCESSOR_ARCHITEW6432 (\r\n\t%SYSTEMROOT%\\system32\\DISM.EXE /Online '
              '/enable-feature /FeatureName:"DirectPlay" /all /NoRestart\r\n) ELSE (\r\n\t%SYSTEMROOT%\\sysNative\\DISM.EXE '
              '/Online /enable-feature /FeatureName:"DirectPlay" /all /NoRestart\r\n)\r\n')
REMOVESDB = '@echo off\r\necho Removing old shims...\r\nsdbinst.exe -u -q "%~dp0goggame.sdb"\r\nexit\r\n'
CLEAN = '@echo off\r\n\r\nif exist "%~dp0HotA_Data\\zlib1.dll" del /f /q "%~dp0HotA_Data\\zlib1.dll"\r\nexit /b 0\r\n'


def test_parse_real_gog_scripts():
    d = Path("D:/Gry/X")
    fw = gogexec.parse_cmd(FIREWALL, d)
    assert fw == [{"op": "fw", "name": "Empire Earth", "program": str(d / "Empire Earth" / "Empire Earth.exe")}]
    reg = gogexec.parse_cmd(ADD_REG, d)
    assert reg[0]["reg"] == {"root": "HKLM", "subkey": "SOFTWARE\\Volition\\Freespace2", "name": "EregCount",
                             "type": "dword", "data": "3"}
    assert reg[1]["reg"]["type"] == "expandstring" and reg[1]["reg"]["data"] == "Direct 3D (1024x768)"
    aow = gogexec.parse_cmd(REGS, d)
    assert aow[0]["reg"]["data"] == "D:\\Gry\\X\\" and aow[1]["reg"]["root"] == "HKCU" and aow[1]["reg"]["data"] == "1"
    assert gogexec.parse_cmd(AC3, d) == [{"op": "regsvr", "file": str(d / "ac3filter.ax")}]
    assert gogexec.parse_cmd(DIRECTPLAY, d) == [{"op": "feature", "name": "DirectPlay"}]
    assert gogexec.parse_cmd(REMOVESDB, d) == [{"op": "sdb_file", "file": str(d / "goggame.sdb")}]
    assert gogexec.parse_cmd(CLEAN, d) is None                       # nieznane polecenie — skrypt bez zmian


def _apply(app: Path, *actions, hkcu=None):
    (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "Execute", "arguments": a}}
                                                                   for a in actions]}), encoding="utf-8")
    return gogfinal.apply_script(app, "1", hkcu=hkcu or (lambda a: None), docs=app.parent / "docs", folders={}, known=set())


def test_execute_skips_gameux_and_does_attrib(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    (app / "fsgame.ltx").write_text("x")
    r = _apply(app, {"executable": "{supportDir}/add/gameux.cmd", "runAsAdmin": True},
               {"executable": "{sys}/attrib.exe", "argument": "+r fsgame.ltx", "workingDir": "{app}"})
    assert len(r["skipped"]) == 1 and r["admin"] == [] and "attrib +r fsgame.ltx" in r["done"]
    assert not (app / "fsgame.ltx").stat().st_mode & stat.S_IWRITE


def test_execute_cmd_becomes_steps_and_hkcu_is_written_now(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    (app / "regs.cmd").write_text(REGS, encoding="latin-1")
    (app / "firewall.cmd").write_text(FIREWALL, encoding="latin-1")
    hk = []
    r = _apply(app, {"executable": "{app}/regs.cmd", "runAsAdmin": True},
               {"executable": "{app}/firewall.cmd", "runAsAdmin": True}, hkcu=hk.append)
    assert hk[0]["subkey"] == "Software\\Triumph Studios\\Age of Wonders\\General" and hk[0]["data"] == "1"
    assert r["admin"][0]["root"] == "HKLM" and r["admin"][0]["data"] == f"{app}\\"
    assert r["admin"][1] == {"op": "fw", "name": "Empire Earth", "program": str(app / "Empire Earth" / "Empire Earth.exe")}


def test_unknown_script_runs_now_or_in_admin_step(tmp_path, monkeypatch):
    app = tmp_path / "g"
    app.mkdir()
    (app / "clean.bat").write_text(CLEAN, encoding="latin-1")
    (app / "VegasTimeOrder.exe").write_bytes(b"MZ")
    ran = []
    monkeypatch.setattr(gogfinal, "RUN_LOCAL", lambda exe, args, cwd: ran.append(exe.name))
    r = _apply(app, {"executable": "{app}/clean.bat", "runAsAdmin": False},
               {"executable": "{app}/VegasTimeOrder.exe", "runAsAdmin": True, "workingDir": "{app}"})
    assert ran == ["clean.bat"]
    assert r["admin"] == [{"op": "exec", "exe": str(app / "VegasTimeOrder.exe"), "args": "", "cwd": str(app),
                           "root": str(app)}]


def test_execute_outside_game_or_missing_file_fails(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    for a in ({"executable": "{app}/../poza.exe"}, {"executable": "{app}/brak.cmd"}, {"executable": "{app}/x.dll"}):
        with pytest.raises(gogfinal.FinalizeError):
            _apply(app, a)


def test_firewall_rule_added_in_admin_step_and_removed_by_name(env, fake_reg, monkeypatch):
    env["root"] = env["tmp"] / "_e1"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "Execute", "arguments": {"executable": "{app}/firewall.cmd", "runAsAdmin": True}}})
    build_archive(env["root"], script=s, extra_files=[("firewall.cmd", FIREWALL.encode(), []),
                                                      ("Empire Earth/Empire Earth.exe", b"MZ", [])])
    runs = []
    monkeypatch.setattr(gogadmin, "RUN", lambda cmd, cwd=None, ok=(0,): runs.append(cmd))
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_NEEDS_ADMIN
    assert goglib.GogService(lambda: {}).finish_admin(PID)["ok"] and len(fake_reg["calls"]) == 1
    exe = target / "Empire Earth" / "Empire Earth.exe"
    assert 'add rule name="Empire Earth" dir=in action=allow' in runs[0] and f'program="{exe}"' in runs[0]
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert 'delete rule name="Empire Earth"' in runs[-1]


@pytest.mark.parametrize("step", [
    {"kind": "fw_add", "name": 'X" dir=out', "program": "C:/Windows/notepad.exe"},
    {"kind": "feature", "name": "TelnetClient"},
    {"kind": "regsvr", "file": "C:/Windows/System32/notepad.exe"},
    {"kind": "exec", "exe": "C:/Windows/System32/cmd.exe", "args": "", "root": "C:/Windows/System32"},
])
def test_elevated_process_validates_other_steps(fake_reg, monkeypatch, step):
    runs = []
    monkeypatch.setattr(gogadmin, "RUN", lambda *a, **k: runs.append(a))
    p = steps_file(fake_reg["dir"], [step])
    assert gogadmin.main(str(p)) == 1 and runs == []


# ── etap 5: galaxy_*.exe — wpisy [Registry] z nagłówka Inno, bez uruchamiania ──

def _inno_str(s: str) -> bytes:
    b = s.encode("utf-16-le")
    return len(b).to_bytes(4, "little") + b


def _inno_reg(root: int, subkey: str, name: str, data: str, typ: int = 1, check: str = "", tasks: str = "") -> bytes:
    strs = [subkey, name, data, "Component0", tasks, "", check, "", ""]
    return (b"".join(_inno_str(x) for x in strs) + bytes(20) + (root | 0x80000000).to_bytes(4, "little")
            + (-1).to_bytes(2, "little", signed=True) + bytes([typ]) + b"\x00\x00")


def fake_inno_exe(path: Path, entries: list) -> Path:
    """Instalator Inno 5.5.0 (unicode) w formacie galaxy_*.exe: tabela SetupLdr → setup.0 (LZMA w blokach z CRC)."""
    import lzma
    import struct
    import zlib
    from emustart import goginno
    header = b"\x00" * 64 + b"".join(entries) + b"\x00" * 64
    lc, lp, pb, dsz = 3, 0, 2, 1 << 16
    comp = bytes([(pb * 5 + lp) * 9 + lc]) + struct.pack("<I", dsz) + lzma.compress(
        header, format=lzma.FORMAT_RAW, filters=[{"id": lzma.FILTER_LZMA1, "dict_size": dsz, "lc": lc, "lp": lp, "pb": pb}])
    chunks = b"".join(struct.pack("<I", zlib.crc32(comp[i:i + 4096]) & 0xFFFFFFFF) + comp[i:i + 4096]
                      for i in range(0, len(comp), 4096))
    hdr = struct.pack("<IB", len(chunks), 1)
    setup0 = goginno._DATA.ljust(64, b"\x00") + struct.pack("<I", zlib.crc32(hdr) & 0xFFFFFFFF) + hdr + chunks
    pre = b"MZ" + b"\x00" * 1000
    off0 = len(pre) + 12 + 32
    path.write_bytes(pre + goginno._LDR_ID + struct.pack("<8I", 1, 0, 0, 0, 0, off0, 0, 0) + setup0)
    return path


LAYERS = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers"


def test_galaxy_exe_registry_is_read_not_run(tmp_path, monkeypatch):
    app = tmp_path / "g"
    app.mkdir()
    fake_inno_exe(app / "galaxy_test_2.1.0.9.exe", [
        _inno_reg(2, "SOFTWARE\\GOG.com\\Games\\1", "PATH", "{app}"),                         # robi to etap rejestru GOG
        _inno_reg(1, LAYERS, "{app}\\Game.exe", "HIGHDPIAWARE"),
        _inno_reg(2, LAYERS, "{app}\\Game.exe", "HIGHDPIAWARE", check="Is32bit"),           # tylko 32-bitowy Windows
        _inno_reg(2, LAYERS, "{app}\\setup.exe", "RUNASADMIN"),
        _inno_reg(2, "SOFTWARE\\GOG.com\\GalaxyClient", "x", "{code:FullGalaxyPath|}"),
        _inno_reg(1, "SOFTWARE\\Gra", "Klucz", "", typ=0),                                  # sam klucz
        _inno_reg(1, "SOFTWARE\\Gra", "Skrot", "1", tasks="desktopicon"),
        _inno_reg(1, "SOFTWARE\\Gra", "Galaxy", "1", check="isGalaxyPresent()"),
        _inno_reg(1, "SOFTWARE\\Gra", "Data", "{code:GetCurrentDate}"),
    ])
    ran = []
    monkeypatch.setattr(gogfinal, "RUN_LOCAL", lambda *a: ran.append(a))
    monkeypatch.setattr(gogfinal, "windows_64", lambda: True)
    hk = []
    r = _apply(app, {"executable": "galaxy_test_2.1.0.9.exe", "runAsAdmin": True}, hkcu=hk.append)
    assert ran == [] and [a["name"] for a in hk] == [f"{app}\\Game.exe"] and hk[0]["data"] == "HIGHDPIAWARE"
    assert [(a["root"], a["name"], a["data"]) for a in r["admin"]] == [("HKLM", f"{app}\\setup.exe", "RUNASADMIN")]
    monkeypatch.setattr(gogfinal, "windows_64", lambda: False)
    r32 = _apply(app, {"executable": "galaxy_test_2.1.0.9.exe", "runAsAdmin": True}, hkcu=lambda a: None)
    assert len(r32["admin"]) == 2                                   # Is32bit na 32-bitowym Windows


def test_galaxy_exe_that_is_not_inno_is_skipped(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    (app / "galaxy_x_1.0.exe").write_bytes(b"MZ to nie Inno")
    r = _apply(app, {"executable": "galaxy_x_1.0.exe", "runAsAdmin": True})
    assert r["admin"] == [] and "nie odczytano" in r["skipped"][0]
