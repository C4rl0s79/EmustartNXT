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
