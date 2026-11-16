"""Uruchamianie gier GOG: zadanie „Launch <gra>.lnk” (skrót tworzy galaxy_*.exe — cel z jego wpisów rejestru GOG),
zadania .bat (GMDX, The Town of Light), brak pliku gry → komunikat z jego nazwą, nie inny program."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from emustart import gogfinal
from test_gog_exec import _inno_reg, fake_inno_exe


def _game(tmp_path: Path, tasks: list, files=()) -> Path:
    app = tmp_path / "g"
    app.mkdir()
    (app / "goggame-1.info").write_text(json.dumps({"name": "Gra", "playTasks": tasks}), encoding="utf-8")
    for f in files:
        p = app / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"MZ")
    return app


LNK = [{"type": "FileTask", "isPrimary": True, "name": "Gra", "path": "Launch Gra.lnk"},
       {"type": "FileTask", "name": "Ustawienia", "path": "Exe\\Config.exe"}]


def test_lnk_task_target_from_galaxy_helper(tmp_path):
    """Disciples Gold / Mount & Blade: skrót z instalatora Galaxy — program z EXE / LAUNCHPARAM / WORKINGDIR."""
    app = _game(tmp_path, LNK, files=["Exe\\Gra.exe", "Exe\\Config.exe"])
    fake_inno_exe(app / "galaxy_gra_2.1.0.8.exe", [
        _inno_reg(2, "SOFTWARE\\GOG.com\\Games\\1", "EXE", "{app}\\Exe\\Gra.exe"),
        _inno_reg(2, "SOFTWARE\\GOG.com\\Games\\1", "LAUNCHPARAM", "-okno"),
        _inno_reg(2, "SOFTWARE\\GOG.com\\Games\\1", "WORKINGDIR", "{app}\\Exe\\"),
    ])
    s = gogfinal.launch_spec(app, "1")
    assert s["exe"] == str(app / "Exe" / "Gra.exe") and s["args"] == "-okno" and s["cwd"] == str(app / "Exe")
    assert [t["name"] for t in gogfinal.play_tasks(app, "1")] == ["Gra", "Ustawienia"]


def test_lnk_task_without_helper_names_the_missing_shortcut(tmp_path):
    app = _game(tmp_path, LNK, files=["Exe\\Config.exe"])
    with pytest.raises(gogfinal.FinalizeError, match="brak pliku gry: Launch Gra.lnk"):
        gogfinal.launch_spec(app, "1")                       # nie Config.exe


def test_missing_game_file_is_reported_not_replaced_by_manual(tmp_path):
    """Tex Murphy przed poprawką plików „support”: DOSBox w złym miejscu — komunikat wskazuje DOSBOX\\dosbox.exe."""
    tasks = [{"type": "FileTask", "category": "game", "isPrimary": True, "path": "DOSBOX\\dosbox.exe"},
             {"type": "FileTask", "category": "tool", "path": "DOSBOX\\GOGDOSConfig.exe"},
             {"type": "FileTask", "category": "document", "path": "Manual.pdf"}]
    app = _game(tmp_path, tasks, files=["Manual.pdf"])
    with pytest.raises(gogfinal.FinalizeError, match=r"brak pliku gry: DOSBOX\\dosbox.exe"):
        gogfinal.launch_spec(app, "1")


def test_other_game_task_on_disk_is_still_used(tmp_path):
    """Główne zadanie gry w innym wariancie (brak pliku), drugie zadanie gry jest — jak dotąd."""
    tasks = [{"type": "FileTask", "category": "game", "isPrimary": True, "path": "bin\\x64\\gra.exe"},
             {"type": "FileTask", "category": "game", "path": "bin\\x86\\gra.exe"}]
    app = _game(tmp_path, tasks, files=["bin\\x86\\gra.exe"])
    assert gogfinal.launch_spec(app, "1")["exe"] == str(app / "bin" / "x86" / "gra.exe")


def test_bat_game_task_runs_through_cmd(tmp_path, monkeypatch):
    tasks = [{"type": "FileTask", "category": "game", "isPrimary": True, "path": "run_GMDX.bat", "arguments": "-x"}]
    app = _game(tmp_path, tasks, files=["run_GMDX.bat"])
    s = gogfinal.launch_spec(app, "1")
    assert s["exe"] == str(app / "run_GMDX.bat")
    seen = {}
    monkeypatch.setattr(gogfinal.subprocess, "Popen", lambda cmd, **k: seen.setdefault("cmd", cmd))
    monkeypatch.setattr(gogfinal.os, "name", "nt")
    # CI (GitHub Actions) działa jako administrator — wtedy start szedłby przez token powłoki (unelevated.popen)
    from emustart import gogadmin
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: False)
    gogfinal.start(s)
    assert seen["cmd"] == f'cmd.exe /c ""{app / "run_GMDX.bat"}" -x"'


# CD Projekt RED (Cyberpunk 2077, Wiedźmin 3): widoczne zadanie główne to REDprelauncher (kategoria „launcher”),
# plik gry jest ukrytym zadaniem kategorii „game” — gra ma startować bez launchera (zgłoszenie 2026-11-16).
RED = [{"type": "FileTask", "isPrimary": True, "category": "launcher", "name": "Cyberpunk 2077",
        "path": "REDprelauncher.exe"},
       {"type": "FileTask", "isHidden": True, "category": "game", "name": "Cyberpunk 2077",
        "path": "bin\\x64\\Cyberpunk2077.exe"},
       {"type": "FileTask", "category": "other", "name": "Support", "path": ""}]


def test_red_launcher_skipped_for_hidden_game_task(tmp_path):
    app = _game(tmp_path, RED, ["REDprelauncher.exe", "bin/x64/Cyberpunk2077.exe"])
    spec = gogfinal.launch_spec(app, "1")
    assert spec["exe"].endswith("Cyberpunk2077.exe")
    assert spec["cwd"].endswith("x64")
    tasks = gogfinal.play_tasks(app, "1")                   # „Uruchom…”: gra domyślna, launcher do wyboru
    assert [t["name"] for t in tasks if t["default"]] == ["Cyberpunk 2077"]
    assert len(tasks) == 2
    default = next(t for t in tasks if t["default"])
    assert gogfinal.launch_spec(app, "1", default["index"])["exe"].endswith("Cyberpunk2077.exe")


def test_hidden_game_task_without_file_falls_back_to_launcher(tmp_path):
    """ukryte zadanie gry, którego pliku nie ma (opis innej platformy) — jak dotąd launcher (test_gog_install)"""
    app = _game(tmp_path, RED, ["REDprelauncher.exe"])
    assert gogfinal.launch_spec(app, "1")["exe"].endswith("REDprelauncher.exe")


def test_several_hidden_game_variants_keep_the_launcher(tmp_path):
    """Resident Evil 2 (Leon / Claire), Outlast (Win32 / Win64): launcher wybiera wariant — zostaje"""
    tasks = [{"type": "FileTask", "isPrimary": True, "category": "launcher", "name": "RE2", "path": "RE2Launcher.exe"},
             {"type": "FileTask", "isHidden": True, "category": "game", "name": "Claire", "path": "ClaireU.exe"},
             {"type": "FileTask", "isHidden": True, "category": "game", "name": "Leon", "path": "LeonU.exe"}]
    app = _game(tmp_path, tasks, ["RE2Launcher.exe", "ClaireU.exe", "LeonU.exe"])
    assert gogfinal.launch_spec(app, "1")["exe"].endswith("RE2Launcher.exe")
    assert [t["name"] for t in gogfinal.play_tasks(app, "1")] == ["RE2"]


def test_hidden_non_game_task_still_not_preferred(tmp_path):
    tasks = [{"type": "FileTask", "isPrimary": True, "category": "game", "name": "Gra", "path": "game.exe"},
             {"type": "FileTask", "isHidden": True, "category": "launcher", "name": "proces", "path": "helper.exe"}]
    app = _game(tmp_path, tasks, ["game.exe", "helper.exe"])
    assert gogfinal.launch_spec(app, "1")["exe"].endswith("game.exe")
    assert [t["name"] for t in gogfinal.play_tasks(app, "1")] == ["Gra"]


def test_run_menu_default_matches_play_when_game_file_missing(tmp_path):
    """tylko launcher na dysku: „Graj” startuje launcher i ten sam wpis jest domyślny w „Uruchom…”"""
    app = _game(tmp_path, RED, ["REDprelauncher.exe"])
    tasks = gogfinal.play_tasks(app, "1")
    assert [t["category"] for t in tasks if t["default"]] == ["launcher"]


def test_run_menu_default_matches_play_with_one_installed_variant(tmp_path):
    tasks = [{"type": "FileTask", "isPrimary": True, "category": "launcher", "name": "L", "path": "L.exe"},
             {"type": "FileTask", "isHidden": True, "category": "game", "name": "32", "path": "Win32/G.exe"},
             {"type": "FileTask", "isHidden": True, "category": "game", "name": "64", "path": "Win64/G.exe"}]
    app = _game(tmp_path, tasks, ["L.exe", "Win64/G.exe"])
    started = gogfinal.launch_spec(app, "1")["exe"]
    default = next(t for t in gogfinal.play_tasks(app, "1") if t["default"])
    assert gogfinal.launch_spec(app, "1", default["index"])["exe"] == started


def test_same_exe_different_arguments_are_variants(tmp_path):
    tasks = [{"type": "FileTask", "isPrimary": True, "category": "launcher", "name": "L", "path": "L.exe"},
             {"type": "FileTask", "isHidden": True, "category": "game", "name": "DX11", "path": "g.exe", "arguments": "-dx11"},
             {"type": "FileTask", "isHidden": True, "category": "game", "name": "DX12", "path": "g.exe", "arguments": "-dx12"}]
    app = _game(tmp_path, tasks, ["L.exe", "g.exe"])
    assert gogfinal.launch_spec(app, "1")["exe"].endswith("L.exe")


def test_only_hidden_tasks_missing_game_is_still_reported(tmp_path):
    """bez widocznego launchera stary strażnik zostaje (Tex Murphy / Disciples): nie inny program po cichu"""
    tasks = [{"type": "FileTask", "isHidden": True, "isPrimary": True, "category": "game", "name": "G", "path": "Game.exe"},
             {"type": "FileTask", "isHidden": True, "category": "tool", "name": "C", "path": "Config.exe"}]
    app = _game(tmp_path, tasks, ["Config.exe"])
    with pytest.raises(gogfinal.FinalizeError, match="Game.exe"):
        gogfinal.launch_spec(app, "1")


# „Uruchom z diagnostyką” (gry DOSBox, zgłoszenie 2026-11-16): komunikat błędu gry zostaje na ekranie.
EOB = [{"type": "FileTask", "isPrimary": True, "category": "game", "name": "EoB III", "path": r"DOSBOX\dosbox.exe",
        "arguments": r'-conf "..\dosbox_eob3.conf" -conf "..\dosbox_eob3_single.conf" -noconsole -c "exit"',
        "workingDir": "DOSBOX"},
       {"type": "FileTask", "category": "tool", "name": "Graphic Mode Setup", "path": r"DOSBOX\GOGDOSConfig.exe",
        "arguments": "1432576327", "workingDir": "DOSBOX"}]
CONF = "[sdl]\nfullscreen=true\n[AUTOEXEC]\n"
SINGLE = ("[autoexec]\n@ECHO OFF\nmount c \"..\"\nc:\ngoto launcher\n:launcher\nchoice /c12\nif errorlevel 1 goto game\n"
          ":game\ncls\neye.bat\nsetup\ngoto exit\n:exit\nexit\n")


def _eob(tmp_path):
    app = _game(tmp_path, EOB, ["DOSBOX/dosbox.exe", "DOSBOX/GOGDOSConfig.exe"])
    (app / "dosbox_eob3.conf").write_text(CONF, encoding="latin-1")
    (app / "dosbox_eob3_single.conf").write_text(SINGLE, encoding="latin-1")
    (app / "EYE.BAT").write_text("@echo off\r\naesop eye start\r\ncall last.bat\r\nexit\r\n", encoding="latin-1")
    (app / "LAST.BAT").write_text("echo koniec\r\nexit\r\n", encoding="latin-1")
    (app / "setup.bat").write_text("sound.exe\r\nexit\r\n", encoding="latin-1")
    return app


def test_dosbox_game_offers_diagnostic_run(tmp_path):
    app = _eob(tmp_path)
    diag = [t for t in gogfinal.play_tasks(app, "1") if t["index"] == gogfinal.DIAG_TASK]
    assert diag and diag[0]["name"] == "Uruchom z diagnostyką" and not diag[0]["default"]
    (tmp_path / "x").mkdir()
    plain = _game(tmp_path / "x", [{"type": "FileTask", "isPrimary": True, "category": "game", "path": "g.exe"}], ["g.exe"])
    assert all(t["category"] != "diagnostic" for t in gogfinal.play_tasks(plain, "1"))


def test_diagnostic_run_keeps_the_error_on_screen(tmp_path):
    app = _eob(tmp_path)
    spec = gogfinal.launch_spec(app, "1", gogfinal.DIAG_TASK)
    assert spec["exe"].endswith("dosbox.exe") and spec["cwd"].endswith("DOSBOX")
    assert "-noconsole" not in spec["args"] and '-c "exit"' not in spec["args"]
    assert ".emustart-diag" in spec["args"] and ":" not in spec["args"]          # ścieżki względne (bez %TEMP%)
    d = app / gogfinal.DIAG_DIR
    single = (d / "02-dosbox_eob3_single.conf").read_text(encoding="latin-1")
    auto = [x.strip().lower() for x in single.split("[autoexec]", 1)[1].splitlines()]
    assert "exit" not in auto and "pause" in auto
    assert r"call y:\eye.bat" in auto and r"call y:\setup.bat" in auto           # także bez rozszerzenia
    first = (d / "01-dosbox_eob3.conf").read_text(encoding="latin-1")            # [AUTOEXEC] wielkimi literami
    assert any(x.lower().startswith("mount y ") and ".emustart-diag" in x for x in first.splitlines())
    eye = [x.strip().lower() for x in (d / "EYE.BAT").read_text(encoding="latin-1").splitlines()]
    assert "exit" not in eye and "aesop eye start" in eye and r"call y:\last.bat" in eye   # zagnieżdżony .bat
    assert "exit" not in [x.strip().lower() for x in (d / "LAST.BAT").read_text(encoding="latin-1").splitlines()]
    assert "fullscreen=false" in (d / "diagnostyka.conf").read_text(encoding="latin-1")
    assert spec["args"].index("dosbox_eob3.conf") < spec["args"].index("diagnostyka.conf")
    assert (app / "dosbox_eob3_single.conf").read_text(encoding="latin-1") == SINGLE   # pliki gry bez zmian
    assert "exit" in (app / "EYE.BAT").read_text(encoding="latin-1")


def test_bat_comes_from_the_folder_mounted_as_c(tmp_path):
    app = _eob(tmp_path)
    (app / "game").mkdir()
    (app / "game" / "EYE.BAT").write_text("real\r\nexit\r\n", encoding="latin-1")
    (app / "dosbox_eob3_single.conf").write_text(SINGLE.replace('mount c ".."', r'mount c "..\game"'), encoding="latin-1")
    gogfinal.launch_spec(app, "1", gogfinal.DIAG_TASK)
    assert (app / gogfinal.DIAG_DIR / "EYE.BAT").read_text(encoding="latin-1").startswith("real")


def test_each_dosbox_part_of_a_compilation_has_its_diagnostic_run(tmp_path):
    two = [{"type": "FileTask", "isPrimary": True, "category": "game", "name": "WC1", "path": r"DOSBOX\dosbox.exe",
            "arguments": r'-conf "..\a.conf"', "workingDir": "DOSBOX"},
           {"type": "FileTask", "category": "game", "name": "WC2", "path": r"DOSBOX\dosbox.exe",
            "arguments": r'-conf "..\b.conf"', "workingDir": "DOSBOX"}]
    app = _game(tmp_path, two, ["DOSBOX/dosbox.exe"])
    for n in ("a", "b"):
        (app / f"{n}.conf").write_text(f"[autoexec]\nrem {n}\nexit\n", encoding="latin-1")
    diag = {t["name"]: t["index"] for t in gogfinal.play_tasks(app, "1") if t["category"] == "diagnostic"}
    assert set(diag) == {"WC1 — uruchom z diagnostyką", "WC2 — uruchom z diagnostyką"}
    assert "b.conf" in gogfinal.launch_spec(app, "1", diag["WC2 — uruchom z diagnostyką"])["args"]


def test_engine_api_passes_the_diagnostic_task(monkeypatch):
    from emustart.api import Api
    got = []
    fake = type("G", (), {"launch": lambda self, pid, task, choice: got.append(task) or {"ok": True}})()
    api = type("A", (), {"_gog": fake})()
    Api.gog_launch(api, "1", gogfinal.DIAG_TASK)
    Api.gog_launch(api, "1", gogfinal.DIAG_BASE - 1)
    Api.gog_launch(api, "1", -1)
    assert got == [gogfinal.DIAG_TASK, gogfinal.DIAG_BASE - 1, None]
