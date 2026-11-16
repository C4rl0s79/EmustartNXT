"""Pliki „support” z save/ → folder zapisów ze skryptu gry (zgłoszenie 2026-11-16: Eye of the Beholder III nie miało
C:/SAVEGAME, bo początkowe pliki zapisów leżały w {app}/save zamiast w {app}/cloud_saves nakładanym na C:)."""

from __future__ import annotations

import json

from emustart import gogfinal

PID = "1432576327"
SCRIPT = {"actions": [
    {"install": {"action": "supportData", "arguments": {"overwrite": True, "source": "{supportDir}/app",
                                                       "target": "{app}", "type": "folder"}}, "languages": ["*"]},
    {"install": {"action": "supportData", "arguments": {"target": "{app}/cloud_saves", "type": "folder"}},
     "languages": ["*"]},
]}


def _game(tmp_path):
    app = tmp_path / "Eye of the Beholder III"
    (app / "save" / "SAVEGAME").mkdir(parents=True)
    (app / "save" / "SAVEGAME" / "LVL01.TMP").write_bytes(b"poziom")
    (app / "save" / "CHARGEN").mkdir()
    (app / "save" / "CHARGEN" / "CREATE.SAV").write_bytes(b"postac")
    (app / f"goggame-{PID}.script").write_text(json.dumps(SCRIPT), encoding="utf-8")
    return app


def test_folders_from_script_and_seed_without_overwriting(tmp_path):
    app = _game(tmp_path)
    assert gogfinal.save_folders(app, PID) == [app / "cloud_saves"]
    (app / "cloud_saves" / "CHARGEN").mkdir(parents=True)
    (app / "cloud_saves" / "CHARGEN" / "CREATE.SAV").write_bytes(b"zapis gracza")
    assert gogfinal.seed_saves(app, PID) == 1
    assert (app / "cloud_saves" / "SAVEGAME" / "LVL01.TMP").read_bytes() == b"poziom"
    assert (app / "cloud_saves" / "CHARGEN" / "CREATE.SAV").read_bytes() == b"zapis gracza"   # zapis gracza zostaje
    assert (app / "save" / "SAVEGAME" / "LVL01.TMP").exists()                                  # kopia dla weryfikacji
    assert gogfinal.seed_saves(app, PID) == 0                                                  # drugi raz — nic


def test_no_script_or_no_save_folder_does_nothing(tmp_path):
    app = tmp_path / "Gra"
    (app / "save").mkdir(parents=True)
    (app / "save" / "x.cfg").write_bytes(b"1")
    assert gogfinal.seed_saves(app, PID) == 0                  # bez skryptu — nie wiadomo, dokąd
    app2 = _game(tmp_path / "b")
    (app2 / f"goggame-{PID}.script").write_text(json.dumps({"actions": [SCRIPT["actions"][0]]}), encoding="utf-8")
    assert gogfinal.seed_saves(app2, PID) == 0                 # skrypt bez folderu zapisów
