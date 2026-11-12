"""Akcje i symbole skryptów GOG znalezione w skanie archiwum (2026-11-12): {documents}, {commondocs},
{uninstallexe}, {code:…}, saveToFile (S.T.A.L.K.E.R.), delRegistry (Dragon Age, INSIDE, A.D. 2044)."""

from __future__ import annotations

import json

import pytest

from emustart import gogadmin, gogfinal, goginstall as gi, goglib
from gogadminhelp import fake_reg  # noqa: F401  (fixture)
from goghelp import PID, SCRIPT, build_archive
from test_gog_install import _install, env  # noqa: F401  (fixture)


def _apply(tmp_path, *actions, folders=None, hkcu=None):
    app = tmp_path / "g"
    app.mkdir(exist_ok=True)
    (app / "goggame-1.script").write_text(json.dumps({"actions": list(actions)}), encoding="utf-8")
    return app, gogfinal.apply_script(app, "1", hkcu=hkcu or (lambda a: None), docs=tmp_path / "Dok",
                                      folders=folders if folders is not None else {}, known=set())


def _act(action, **arguments):
    return {"install": {"action": action, "arguments": arguments}}


def test_documents_and_commondocs_symbols(tmp_path):
    app, r = _apply(tmp_path, _act("savePath", savePath="{documents}/GreedFall", type="folder"),
                    _act("savePath", savePath="{commondocs}/Ghost Master/SaveGames", type="folder"),
                    folders={"winPublicDocuments": str(tmp_path / "Publiczne")})
    assert r["saves"] == [str(tmp_path / "Dok" / "GreedFall"), str(tmp_path / "Publiczne" / "Ghost Master" / "SaveGames")]


def test_uninstallexe_and_code_values_are_skipped_not_fatal(tmp_path):
    app, r = _apply(tmp_path,
                    _act("setRegistry", root="HKEY_LOCAL_MACHINE", subkey="Software\\GOG.com\\Games\\1",
                         valueName="UNINSTALLCOMMAND", valueData="{uninstallexe}"),
                    _act("setRegistry", root="HKEY_LOCAL_MACHINE", subkey="Software\\Vampire",
                         valueName="CDROM", valueData="{code:GetFirstCDROM}"),
                    _act("setRegistry", root="HKEY_LOCAL_MACHINE", subkey="Software\\Vampire",
                         valueName="Path", valueData="{app}"))
    assert len(r["skipped"]) == 2 and [a["name"] for a in r["admin"]] == ["Path"]


def test_save_to_file_stalker(tmp_path):
    text = "$app_data_root$ = true | false| {userdocs}\\Stalker-SHOC\n$game_data$ = false| true | $fs_root$\n"
    app, r = _apply(tmp_path, _act("saveToFile", filename="{app}/fsgame.ltx", text=text, utf8=False))
    out = (app / "fsgame.ltx").read_bytes().decode("cp1252")
    assert out.startswith(f"$app_data_root$ = true | false| {tmp_path / 'Dok'}\\Stalker-SHOC")
    assert r["created"] == [str(app / "fsgame.ltx")]
    with pytest.raises(gogfinal.FinalizeError):
        _apply(tmp_path, _act("saveToFile", filename="{userdocs}/poza.txt", text="x"))


def test_del_registry_skips_player_data_and_language_change(tmp_path, monkeypatch):
    removed = []
    monkeypatch.setattr(gogfinal, "DEL_HKCU", lambda sub, name: removed.append((sub, name)))
    app, r = _apply(tmp_path,
                    _act("delRegistry", root="HKEY_CURRENT_USER", subkey="Software/Playdead/INSIDE", saveGameData=True),
                    _act("delRegistry", conditions=["onLanguageChange"], root="HKEY_LOCAL_MACHINE", subkey="Software\\LKAvalon"),
                    _act("delRegistry", root="HKCU", subkey="Software\\Gra", valueName="Stare"))
    assert removed == [("Software\\Gra", "Stare")] and len(r["skipped"]) == 2 and r["admin"] == []


def test_del_registry_hklm_removed_in_admin_step_and_restored_on_uninstall(env, fake_reg):
    """Dragon Age: delRegistry HKLM SOFTWARE\\BioWare\\Dragon Age, Path — stara wartość wraca po odinstalowaniu."""
    env["root"] = env["tmp"] / "_d_da"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append(_act("delRegistry", root="HKLM", subkey="SOFTWARE\\BioWare\\Dragon Age", valueName="Path"))
    build_archive(env["root"], script=s)
    key = "SOFTWARE\\BioWare\\Dragon Age"
    for view in ("64", "32"):
        fake_reg["reg"].set(view, key, "Path", gogadmin.REG_SZ, "C:\\Stara")
    e, _t, _ = _install(env)
    assert e["state"] == gi.ST_NEEDS_ADMIN
    assert goglib.GogService(lambda: {}).finish_admin(PID)["ok"]
    assert not any(k[1] == key for k in fake_reg["reg"].data)
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert fake_reg["reg"].data == {(v, key, "Path"): (gogadmin.REG_SZ, "C:\\Stara") for v in ("64", "32")}
