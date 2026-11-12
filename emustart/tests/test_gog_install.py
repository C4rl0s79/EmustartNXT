"""Instalator GOG w kliencie: pionowy przepływ z serwera, języki, DLC, zależności, finalizacja, wznowienie,
uszkodzone dane, miejsce, weryfikacja, uruchamianie bez serwera, usuwanie i cache gier emulowanych."""

from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path

import keyhelp
import pytest

from emustart import gogadmin, gogarchive as ga, gogfinal, goginstall as gi, goglib, paths
from goghelp import BIG, BUILD, DLC_FILES, DLC_META, GAME_EXE, PID, SCRIPT, build_archive
from gogadminhelp import fake_reg, steps_file  # noqa: F401  (fixture)
from test_three_devices import srv  # noqa: F401  (fixture)


class FakeServer:
    """Atrapa serwera EmuStart: te same funkcje co /v1/gog (gogarchive), liczenie i ograniczanie zapytań."""

    def __init__(self, root: Path, delay: float = 0.0):
        ga.refresh(str(root), wait=True)
        assert ga.status()["builds"] == 1, ga.status()
        self.calls = 0
        self.concurrent = 0
        self.max_concurrent = 0
        self.delay = delay
        self.lock = threading.Lock()
        self.on_chunk = None

    def catalog(self):
        return ga.catalog()

    def manifest(self, pid, build):
        try:
            return json.loads(json.dumps(ga.build_manifest(pid, build)))
        except ga.Changed as ex:
            raise gi.SourceChanged(str(ex))

    def chunk(self, pid, build, h, md5):
        with self.lock:
            self.calls += 1
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
            n = self.calls
        try:
            if self.on_chunk:
                r = self.on_chunk(n, md5)
                if r is not None:
                    return r
            if self.delay:
                time.sleep(self.delay)
            try:
                return ga.chunk_bytes(pid, build, h, md5)
            except ga.Changed as ex:
                raise gi.SourceChanged(str(ex))
            except (ga.ArchiveError, FileNotFoundError) as ex:
                raise gi.BadObject(str(ex))
        finally:
            with self.lock:
                self.concurrent -= 1


@pytest.fixture()
def env(tmp_path, monkeypatch):
    root = tmp_path / "_depots"
    build_archive(root)
    regs = []
    monkeypatch.setattr(gogfinal, "set_hkcu", regs.append)        # nigdy prawdziwy rejestr w testach
    monkeypatch.setattr(gogfinal, "remove_hkcu", lambda acts: 0)
    monkeypatch.setattr(gogfinal, "_shell_runas", lambda *a, **k: False)   # nigdy prawdziwe okno UAC (fake_reg: zgoda)
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: False)           # wynik nie zależy od uprawnień terminala
    monkeypatch.setattr(gogfinal, "user_documents", lambda: tmp_path / "Dokumenty")
    yield {"root": root, "games": tmp_path / "GOG Games", "regs": regs, "tmp": tmp_path}
    ga.INDEX.update(root="", builds={}, rejected=[], error="", running=False)


def _install(env, langs=("en",), primary="", dlcs=(), src=None, **kw):
    src = src or FakeServer(env["root"])
    target = env["games"] / "Testowa Gra"
    return gi.install(src, PID, BUILD, list(langs), primary, list(dlcs), str(target), **kw), target, src


def test_vertical_flow_over_http(srv, tmp_path, monkeypatch):  # noqa: F811
    """manifest na serwerze → chunki przez /v1/gog → pliki w katalogu gry → uruchamianie; bez lokalnej kopii
    archiwum i bez innego źródła niż serwer EmuStart."""
    root = tmp_path / "_depots"
    build_archive(root)
    ga.refresh(str(root), wait=True)
    monkeypatch.setattr(gogfinal, "set_hkcu", lambda a: None)
    monkeypatch.setattr(gogfinal, "user_documents", lambda: tmp_path / "Dokumenty")
    host, port, _nas = srv
    _did, tok = keyhelp.device("Gracz", games=True)
    src = gi.ServerSource.__new__(gi.ServerSource)
    from emustart import netsrc
    src.netsrc, src.ep, src._local = netsrc, (host, port, tok), threading.local()
    target = tmp_path / "GOG Games" / "Testowa Gra"
    e = gi.install(src, PID, BUILD, ["en"], "", [], str(target))
    assert e["state"] == gi.ST_INSTALLED
    assert (target / "bin" / "game.exe").read_bytes() == GAME_EXE
    assert (target / "data" / "big.dat").read_bytes() == BIG
    assert (target / "small" / "s3.txt").read_bytes() == b"maly plik 3\n"
    assert (target / "small" / "tylko_kontener.txt").read_bytes() == b"tylko w kontenerze SFC\n"
    assert (target / "empty.txt").read_bytes() == b""
    assert not list(target.glob(".emustart-gog-sfc-*"))              # plik tymczasowy SFC usunięty
    spec = gogfinal.launch_spec(target, PID)
    assert spec["exe"].endswith("game.exe") and spec["args"] == "-lang en-US" and spec["cwd"].endswith("bin")
    ga.INDEX.update(root="", builds={}, rejected=[], error="", running=False)


def test_languages_and_primary(env):
    e, target, _ = _install(env, langs=("en", "pl"), primary="pl")
    assert (target / "lang" / "en.txt").exists() and (target / "lang" / "pl.txt").exists()
    assert json.loads((target / "goggame-1001.info").read_text())["languages"] == ["pl-PL"]
    assert e["languages"] == ["en", "pl"] and e["primary"] == "pl"


def test_single_language_does_not_mix(env):
    _e, target, _ = _install(env, langs=("pl",))
    assert (target / "lang" / "pl.txt").exists() and not (target / "lang" / "en.txt").exists()


def test_unavailable_language_is_refused_without_fallback(env):
    with pytest.raises(gi.GogError, match="nie ma kompletnego języka"):
        _install(env, langs=("de",))
    assert not (env["games"] / "Testowa Gra").exists() and gi.load_entry(PID) is None


def test_dlc_with_files_and_metadata_only(env):
    e, target, _ = _install(env, dlcs=(DLC_FILES, DLC_META))
    assert (target / "dlc" / "extra.pak").read_bytes() == b"DLC" * 500
    assert json.loads((target / f"goggame-{DLC_META}.info").read_text())["rootGameId"] == PID
    assert set(e["dlcs"]) == {DLC_FILES, DLC_META}


def test_add_dlc_to_existing_install(env):
    e, target, src = _install(env)
    assert not (target / "dlc").exists()
    e = gi.add_dlc(src, PID, [DLC_FILES])
    assert (target / "dlc" / "extra.pak").exists() and DLC_FILES in e["dlcs"] and e["state"] == gi.ST_INSTALLED
    with pytest.raises(gi.GogError, match="już zainstalowane"):
        gi.add_dlc(src, PID, [DLC_FILES])


def test_dependencies_and_runtime_steps(env):
    e, target, _ = _install(env)
    assert (target / "__redist" / "MSVC2017" / "vc_redist.x64.exe").exists()
    assert e["dependencies"] == ["MSVC2017"]
    steps = gogfinal.runtime_steps(target, e["dependencies"])
    assert steps and steps[0]["args"] == "/install /quiet /norestart"
    ran = []
    res = gogfinal.run_runtimes(steps, elevate=lambda exe, args, cwd=None: ran.append((exe, args)) or True)
    assert res == {"MSVC2017": True} and ran[0][0].endswith("vc_redist.x64.exe")


def test_finalization_actions(env):
    e, target, _ = _install(env)
    assert (target / "dosbox.conf").exists()                        # supportData
    assert "Voice=PL" in (target / "settings.ini").read_text()      # setIni
    assert env["regs"][0]["root"] == "HKCU" and env["regs"][0]["data"] == f"{target}\\"
    assert e["finalize"]["saves"] == [str(target / "saves")]


def test_hklm_needs_admin_and_is_not_installed(env):
    env["root"] = env["tmp"] / "_d2"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "setRegistry", "arguments": {
        "root": "HKEY_LOCAL_MACHINE", "subkey": "Software\\Test", "valueName": "X", "valueData": "1"}}})
    build_archive(env["root"], script=s)
    e, _t, _ = _install(env)
    assert e["state"] == gi.ST_NEEDS_ADMIN
    svc = goglib.GogService(lambda: {})
    assert not svc.launch(PID)["ok"]
    assert not svc.finish_admin(PID, elevate=lambda *a, **k: False)["ok"]       # odmowa UAC
    assert gi.load_entry(PID)["state"] == gi.ST_NEEDS_ADMIN
    assert gogadmin.set_steps(gogadmin.capture(e["finalize"]["admin"]))[0]["subkey"] == "Software\\Test"


def test_finalization_error_leaves_install_unfinished(env):
    env["root"] = env["tmp"] / "_d3"
    s = {"actions": [{"install": {"action": "supportData", "arguments": {"type": "file", "source": "{app}\\nie_ma.conf",
                                                                          "target": "{app}"}}}]}
    build_archive(env["root"], script=s)
    with pytest.raises(gi.GogError, match="Finalizacja"):
        _install(env)
    assert gi.load_entry(PID)["state"] == gi.ST_FAILED


@pytest.mark.parametrize("args", [
    {"root": "HKEY_CLASSES_ROOT", "subkey": "Software\\x", "valueName": "a", "valueData": "b"},
    {"root": "HKEY_CURRENT_USER", "subkey": "System\\CurrentControlSet", "valueName": "a", "valueData": "b"},
    {"root": "HKEY_CURRENT_USER", "subkey": "Software\\x", "valueName": "a", "valueData": "{tmp}\\x"},
    {"root": "HKEY_CURRENT_USER", "subkey": "Software\\x", "valueName": "a", "valueData": "b", "valueType": "multi"},
])
def test_registry_actions_are_validated(args, tmp_path):
    with pytest.raises(gogfinal.FinalizeError):
        gogfinal.registry_action(args, tmp_path)


def test_script_cannot_write_outside(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "setIni", "arguments": {
        "filename": "{app}\\..\\..\\evil.ini", "section": "a", "keyName": "b", "keyValue": "c"}}}]}))
    with pytest.raises(gogfinal.FinalizeError):
        gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "docs", folders={})
    assert not (tmp_path / "evil.ini").exists()


def test_bounded_buffer(env):
    src = FakeServer(env["root"], delay=0.02)
    _install(env, langs=("en", "pl"), dlcs=(DLC_FILES,), src=src)
    assert 1 < src.max_concurrent <= gi.WORKERS * gi.INFLIGHT


def test_cancel_and_resume_after_restart(env):
    cancel = threading.Event()
    src = FakeServer(env["root"])
    src.on_chunk = lambda n, md5: cancel.set() if n == 4 else None
    with pytest.raises(gi.Cancelled):
        _install(env, langs=("en", "pl"), src=src, cancel=cancel)
    e = gi.load_entry(PID)
    assert e["state"] == gi.ST_CANCELLED and 0 < len(e["done"]) < len(e["files"])
    total_chunks = sum(len(f["chunks"]) for f in gi.make_plan(src.manifest(PID, BUILD), ["en", "pl"]).get("files"))
    src2 = FakeServer(env["root"])                       # „po restarcie”: nowe źródło, stan z rejestru
    e2 = gi.resume(src2, PID)
    assert e2["state"] == gi.ST_INSTALLED and e2["languages"] == ["en", "pl"]
    assert src2.calls < total_chunks                     # ukończone pliki nie są pobierane ponownie


def test_resume_refuses_changed_build(env):
    cancel = threading.Event()
    src = FakeServer(env["root"])
    src.on_chunk = lambda n, md5: cancel.set() if n == 2 else None
    with pytest.raises(gi.Cancelled):
        _install(env, src=src, cancel=cancel)
    rp = env["root"] / "products" / PID / f"{BUILD}.json"
    rec = json.loads(rp.read_text())
    rec["version_name"] = "1.1"
    rp.write_text(json.dumps(rec))
    with pytest.raises(gi.SourceChanged):
        gi.resume(FakeServer(env["root"]), PID)
    assert gi.load_entry(PID)["state"] == gi.ST_CANCELLED


def test_corrupt_object_from_server(env):
    src = FakeServer(env["root"])
    src.on_chunk = lambda n, md5: b"zepsute dane" if n == 3 else None
    with pytest.raises(gi.BadObject):
        _install(env, src=src)
    assert gi.load_entry(PID)["state"] == gi.ST_FAILED


def test_missing_object_on_server(env):
    src = FakeServer(env["root"])

    def gone(n, md5):
        if n == 2:
            raise gi.BadObject("serwer nie ma obiektu")
    src.on_chunk = gone
    with pytest.raises(gi.BadObject):
        _install(env, src=src)
    assert gi.load_entry(PID)["state"] == gi.ST_FAILED


def test_not_enough_space(env, monkeypatch):
    monkeypatch.setattr(gi, "free_bytes", lambda p: 1000)
    with pytest.raises(gi.NoSpace, match="Za mało miejsca"):
        _install(env)
    assert gi.load_entry(PID) is None and not (env["games"] / "Testowa Gra").exists()


def test_refuses_non_empty_foreign_dir(env):
    t = env["games"] / "Testowa Gra"
    t.mkdir(parents=True)
    (t / "cudzy.txt").write_text("x")
    with pytest.raises(gi.GogError, match="nie jest pusty"):
        _install(env)


def test_verify_and_repair_only_bad_files(env):
    _e, target, _ = _install(env)
    assert gi.verify(PID)["ok"]
    p = target / "data" / "big.dat"
    b = bytearray(p.read_bytes())
    b[100] ^= 0xFF
    p.write_bytes(bytes(b))
    r = gi.verify(PID)
    assert not r["ok"] and r["bad"][0]["path"] == "data/big.dat" and gi.load_entry(PID)["state"] == gi.ST_DAMAGED
    src = FakeServer(env["root"])
    e = gi.repair(src, PID)
    assert e["state"] == gi.ST_INSTALLED and p.read_bytes() == BIG and src.calls == 3     # tylko 3 chunki big.dat


def test_launch_without_server(env, monkeypatch):
    _install(env)
    ga.INDEX.update(root="", builds={}, rejected=[], error="")          # serwer „znika”
    started = []

    class P:
        def poll(self):
            return None
    monkeypatch.setattr(gogfinal, "start", lambda spec: started.append(spec) or P())
    svc = goglib.GogService(lambda: {}, source_fn=lambda: (_ for _ in ()).throw(gi.GogError("brak serwera")))
    r = svc.launch(PID)
    assert r["ok"], r
    assert started[0]["exe"].endswith("game.exe") and PID in svc.running_ids()
    assert svc.catalog()["installs"][PID]["state"] == gi.ST_INSTALLED          # biblioteka bez serwera


def test_launcher_exit_does_not_end_session(env, monkeypatch):
    _install(env)

    class Done:
        def poll(self):
            return 0
    monkeypatch.setattr(gogfinal, "start", lambda spec: Done())
    svc = goglib.GogService(lambda: {})
    svc.launch(PID)
    svc._running[PID]["started"] -= 60
    monkeypatch.setattr(gogfinal, "processes_under", lambda root: [1234])     # gra uruchomiona przez launcher
    assert PID in svc.running_ids()
    monkeypatch.setattr(gogfinal, "processes_under", lambda root: [])
    assert PID not in svc.running_ids()


def test_unsafe_launch_path(tmp_path):
    (tmp_path / "goggame-1.info").write_text(json.dumps({"playTasks": [
        {"category": "game", "isPrimary": True, "path": "..\\..\\Windows\\System32\\cmd.exe", "type": "FileTask"}]}))
    with pytest.raises(gogfinal.FinalizeError, match="poza katalogiem"):
        gogfinal.launch_spec(tmp_path, "1")
    (tmp_path / "goggame-1.info").write_text(json.dumps({"playTasks": [
        {"category": "game", "isPrimary": True, "path": "run.bat", "type": "FileTask"}]}))
    (tmp_path / "run.bat").write_text("@echo off")
    with pytest.raises(gogfinal.FinalizeError, match=".exe"):
        gogfinal.launch_spec(tmp_path, "1")


def test_uninstall_keeps_saves_user_files_and_neighbours(env):
    _e, target, _ = _install(env)
    (target / "saves" / "slot1.sav").write_text("zapis")
    (target / "moje_notatki.txt").write_text("gracza")
    neighbour = env["games"] / "Inna Gra"
    neighbour.mkdir()
    (neighbour / "plik.dat").write_text("x")
    removed_reg = []
    r = gi.uninstall(PID, remove_hkcu=removed_reg.extend)
    assert r["removed"] > 5 and not r["dir_removed"] and r["left"] == 2         # zapis i plik gracza
    assert removed_reg and removed_reg[0]["subkey"] == "Software\\EmuStartTest\\Game1001"
    assert not (target / "settings.ini").exists()                               # utworzony przez setIni
    assert (target / "saves" / "slot1.sav").read_text() == "zapis"
    assert (target / "moje_notatki.txt").exists()
    assert not (target / "bin").exists() and not (target / "dosbox.conf").exists()
    assert (neighbour / "plik.dat").exists() and gi.load_entry(PID) is None


def test_uninstall_does_not_follow_links(env, tmp_path):
    _e, target, _ = _install(env)
    outside = tmp_path / "poza"
    outside.mkdir()
    (outside / "game.exe").write_text("nie ruszać", encoding="utf-8")
    import shutil
    shutil.rmtree(target / "bin")
    try:
        (target / "bin").symlink_to(outside, target_is_directory=True)
    except OSError:
        import os
        import subprocess
        if os.name != "nt":
            pytest.skip("brak uprawnień do dowiązań symbolicznych")
        cmd = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "cmd.exe"   # punkt połączenia: bez admina
        subprocess.run([str(cmd), "/c", "mklink", "/J", str(target / "bin"), str(outside)], check=True,
                       capture_output=True, stdin=subprocess.DEVNULL)
    assert gi._has_link(target, target / "bin" / "game.exe")
    gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert (outside / "game.exe").read_text(encoding="utf-8") == "nie ruszać"


def test_install_dir_inside_rom_cache_is_refused(tmp_path):
    cfg = {"cache_dir": str(tmp_path / "cache")}
    assert "pamięci podręcznej" in goglib.check_target(cfg, str(tmp_path / "cache" / "gog"))
    assert goglib.check_target(cfg, str(tmp_path / "GOG Games")) == ""
    assert goglib.check_target(cfg, "względna\\ścieżka")


def test_rom_cache_cleanup_leaves_gog_installs(env, monkeypatch):
    _e, target, _ = _install(env)
    from emustart import cache
    before = sorted(p.relative_to(target) for p in target.rglob("*"))
    cache.enforce_limit({"cache_dir": str(env["tmp"] / "cache"), "cache_recent": 1})
    assert sorted(p.relative_to(target) for p in target.rglob("*")) == before
    assert gi.load_entry(PID)["state"] == gi.ST_INSTALLED


def test_registry_location_is_app_data(env):
    _install(env)
    assert (paths.DATA / "gog" / "installs" / f"{PID}.json").is_file()
    assert (paths.DATA / "gog" / "manifests" / PID / f"{BUILD}.json").is_file()


def test_play_task_choice(env, monkeypatch):
    _install(env)
    (env["games"] / "Testowa Gra" / "Launcher.exe").write_bytes(b"MZ")
    svc = goglib.GogService(lambda: {})
    tasks = svc.play_tasks(PID)["tasks"]
    assert [t["category"] for t in tasks] == ["launcher", "game"]
    assert next(t for t in tasks if t["default"])["category"] == "game"
    started = []

    class P:
        def poll(self):
            return None
    monkeypatch.setattr(gogfinal, "start", lambda spec: started.append(spec) or P())
    assert svc.launch(PID, 0)["ok"] and started[0]["exe"].endswith("Launcher.exe")


def test_uninstall_removes_whole_folder_when_nothing_of_the_player_is_left(env):
    _e, target, _ = _install(env)
    r = gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert r["left"] == 0 and r["dir_removed"] and not target.exists() and target.parent.exists()


# ── poprawki z przeglądu kodu ──

def test_hklm_is_written_to_both_registry_views(fake_reg):
    """gry GOG to zwykle programy 32-bitowe — na 64-bitowym Windows wartość w obu widokach"""
    a = {"root": "HKLM", "subkey": "Software\\GOG.com\\Games\\1001", "name": "path", "type": "string", "data": "C:\\G"}
    gogadmin.main(str(steps_file(fake_reg["dir"], gogadmin.set_steps(gogadmin.capture([a])))))
    assert fake_reg["reg"].data[("64", a["subkey"], "path")] == (gogadmin.REG_SZ, "C:\\G")
    assert fake_reg["reg"].data[("32", a["subkey"], "path")] == (gogadmin.REG_SZ, "C:\\G")


def test_expandstring_dword_and_binary_values():
    assert gogadmin.act_value({"type": "expandstring", "data": "%A%"}) == {"t": gogadmin.REG_EXPAND_SZ, "v": "%A%"}
    assert gogadmin.act_value({"type": "dword", "data": "0001"}) == {"t": gogadmin.REG_DWORD, "v": 1}
    assert gogadmin.act_value({"type": "binary", "data": "AAEC"}) == {"t": gogadmin.REG_BINARY, "v": {"hex": "000102"}}


@pytest.mark.parametrize("typ,data,ok", [("dword", "0001", "1"), ("dword", "0x10", "16"), ("dword", "abc", None),
                                         ("dword", "99999999999", None), ("binary", "AAEC", "AAEC"),
                                         ("binary", "nie base64!", None)])
def test_registry_values_are_validated_before_writing(typ, data, ok, tmp_path):
    args = {"root": "HKEY_CURRENT_USER", "subkey": "Software\\x", "valueName": "a", "valueData": data, "valueType": typ}
    if ok is None:
        with pytest.raises(gogfinal.FinalizeError):
            gogfinal.registry_action(args, tmp_path)
    else:
        assert gogfinal.registry_action(args, tmp_path)["data"] == ok


def test_bad_registry_value_fails_install_with_message(env, monkeypatch):
    env["root"] = env["tmp"] / "_d4"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "setRegistry", "arguments": {
        "root": "HKEY_CURRENT_USER", "subkey": "Software\\T", "valueName": "X", "valueData": "1", "valueType": "dword"}}})
    build_archive(env["root"], script=s)
    # wartość, której walidacja nie złapie, a zapis do rejestru odrzuci (np. ValueError z winreg)
    monkeypatch.setattr(gogfinal, "set_hkcu", lambda a: (_ for _ in ()).throw(ValueError("zła wartość dword")))
    with pytest.raises(gi.GogError, match="Finalizacja"):
        _install(env)
    e = gi.load_entry(PID)
    assert e["state"] == gi.ST_FAILED and "dword" in e["error"]


def test_new_choice_after_cancel_starts_over_and_removes_old_files(env):
    cancel = threading.Event()
    src = FakeServer(env["root"])
    src.on_chunk = lambda n, md5: cancel.set() if n == 4 else None
    with pytest.raises(gi.Cancelled):
        _install(env, langs=("en",), src=src, cancel=cancel)
    old = env["games"] / "Testowa Gra"
    assert any(p.is_file() for p in old.rglob("*"))
    (old / ".emustart-gog-sfc-0.tmp").write_bytes(b"x")              # pozostałość przerwanego kontenera
    new = env["games"] / "Nowy Folder"
    e = gi.install(FakeServer(env["root"]), PID, BUILD, ["pl"], "", [], str(new))
    assert e["state"] == gi.ST_INSTALLED and e["languages"] == ["pl"] and e["install_dir"] == str(new)
    assert not old.exists()                                           # pliki porzuconej instalacji usunięte
    assert (new / "lang" / "pl.txt").exists() and not (new / "lang" / "en.txt").exists()


def test_same_choice_after_cancel_resumes(env):
    cancel = threading.Event()
    src = FakeServer(env["root"])
    src.on_chunk = lambda n, md5: cancel.set() if n == 4 else None
    with pytest.raises(gi.Cancelled):
        _install(env, langs=("en", "pl"), src=src, cancel=cancel)
    done = len(gi.load_entry(PID)["done"])
    src2 = FakeServer(env["root"])
    e, _t, _ = _install(env, langs=("pl", "en"), primary="en", src=src2)   # ten sam wybór, inna kolejność
    total = sum(len(f["chunks"]) for f in gi.make_plan(src2.manifest(PID, BUILD), ["en", "pl"])["files"])
    assert e["state"] == gi.ST_INSTALLED and done > 0 and src2.calls < total


def test_damaged_install_is_not_overwritten_by_install(env):
    _e, target, _ = _install(env)
    (target / "data" / "big.dat").write_bytes(b"zle")
    gi.verify(PID)
    with pytest.raises(gi.GogError, match="uszkodzona"):
        _install(env, langs=("pl",))
    assert gi.load_entry(PID)["state"] == gi.ST_DAMAGED


def test_failed_repair_keeps_install_record(env):
    _e, target, _ = _install(env)
    e0 = gi.load_entry(PID)
    e0["finalize"]["admin_done"] = [{"root": "HKLM", "subkey": "Software\\T", "name": "x", "type": "string", "data": "1"}]
    gi.save_entry(e0)
    (target / "data" / "big.dat").write_bytes(b"zle")
    gi.verify(PID)
    src = FakeServer(env["root"])

    def boom(n, md5):
        raise gi.GogError("sieć")
    src.on_chunk = boom
    with pytest.raises(gi.GogError):
        gi.repair(src, PID)
    e = gi.load_entry(PID)
    assert e["state"] == gi.ST_DAMAGED
    assert e["finalize"]["hkcu"] == e0["finalize"]["hkcu"] and e["finalize"]["saves"] == e0["finalize"]["saves"]
    assert e["installed_at"] == e0["installed_at"] and e["launch"] == e0["launch"]
    e = gi.repair(FakeServer(env["root"]), PID)
    assert e["state"] == gi.ST_INSTALLED and e["finalize"] == e0["finalize"]       # bez ponownego kroku UAC
    assert (target / "data" / "big.dat").read_bytes() == BIG


def test_uninstall_removes_files_of_unfinished_dlc(env, monkeypatch):
    _e, target, src = _install(env)
    real = gi.verify_file
    monkeypatch.setattr(gi, "verify_file", lambda root, f: "zły" if f["path"].startswith("dlc/") else real(root, f))
    with pytest.raises(gi.GogError, match="Weryfikacja"):
        gi.add_dlc(src, PID, [DLC_FILES])
    assert (target / "dlc" / "extra.pak").exists()
    monkeypatch.setattr(gi, "verify_file", real)
    r = gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert not (target / "dlc").exists() and r["dir_removed"]


def test_uninstall_removes_any_sfc_temp_file(env):
    _e, target, _ = _install(env)
    (target / ".emustart-gog-sfc-70.tmp").write_bytes(b"x")
    (target / ".emustart-gog-sfc-x.tmp").write_bytes(b"obcy")         # nie nasz wzór — zostaje
    r = gi.uninstall(PID, remove_hkcu=lambda a: None)
    assert not (target / ".emustart-gog-sfc-70.tmp").exists()
    assert (target / ".emustart-gog-sfc-x.tmp").exists() and r["left"] == 1


def test_catalog_scans_processes_once(env, monkeypatch):
    _install(env)
    for pid in ("2", "3"):                                             # kilka zainstalowanych gier
        gi.save_entry({**gi.load_entry(PID), "product_id": pid})
    svc = goglib.GogService(lambda: {})
    calls = []
    monkeypatch.setattr(svc, "running_ids", lambda: calls.append(1) or [])
    svc.catalog(refresh=False)
    assert len(calls) == 1


def test_launch_waits_for_conflict_decision_and_uploads_after_game(env, monkeypatch):
    from emustart import gogsaves, syncclient
    _install(env)
    started, after = [], []

    class P:
        def poll(self):
            return 0                                    # proces już się zakończył
    monkeypatch.setattr(gogfinal, "start", lambda spec: started.append(spec) or P())
    monkeypatch.setattr(gogfinal, "processes_under", lambda d: [])
    monkeypatch.setattr(gogsaves, "rules", lambda pid, src=None, refresh=False: {
        "source": "ludusavi", "files": [{"path": "<base>/saves", "tags": ["save"], "when": []}]})
    seen = []
    monkeypatch.setattr(gogsaves, "before", lambda cfg, prof, pid, b: seen.append(b[0].key) or
                        syncclient.Result(conflicts=[syncclient.Conflict(b[0], {"revision": 3})]))
    resolved = []
    monkeypatch.setattr(gogsaves, "resolve", lambda cfg, prof, pid, c, choice: resolved.append(choice))
    monkeypatch.setattr(gogsaves, "after", lambda cfg, prof, pid, b, skip=None: after.append(skip) or syncclient.Result())
    svc = goglib.GogService(lambda: {}, profile_fn=lambda: 1)
    r = svc.launch(PID)
    assert not r["ok"] and r["conflict"][0]["template"] == "<base>/saves" and not started   # gra czeka na decyzję
    r = svc.launch(PID, sync_choice="skip")
    assert r["ok"] and started and not resolved
    svc._running[PID]["started"] -= 10                  # minęła chwila na start gry po launcherze
    svc.running_ids()                                   # koniec gry → wysłanie zapisów (w tle)
    for _ in range(50):
        if after:
            break
        time.sleep(0.02)
    assert after == [{seen[0]}] and seen[0][0] == "gog"   # pominięty konflikt nie jest wysyłany


def test_support_data_without_source_creates_folder_and_uninstall_removes_it(env):
    """Al-Qadim: {"target": "{app}/cloud_saves", "type": "folder"} — pusty folder, nie kopia."""
    env["root"] = env["tmp"] / "_d5"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "supportData", "arguments": {"target": "{app}/cloud_saves", "type": "folder"}}})
    build_archive(env["root"], script=s)
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED and (target / "cloud_saves").is_dir() and "cloud_saves" in e["dirs"]
    assert gi.uninstall(PID, remove_hkcu=lambda a: None)["dir_removed"]


def test_support_data_without_source_cannot_leave_game_folder(tmp_path):
    app = tmp_path / "g"
    app.mkdir()
    for args in ({"target": "{app}/../../poza", "type": "folder"}, {"target": "{app}/plik", "type": "file"}, {"type": "folder"}):
        (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "supportData", "arguments": args}}]}))
        with pytest.raises(gogfinal.FinalizeError):
            gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "docs", folders={})
    assert not (tmp_path / "poza").exists()


def test_product_id_symbol_in_registry(tmp_path):
    a = gogfinal.registry_action({"root": "HKEY_LOCAL_MACHINE", "subkey": "Software\\GOG.com\\Games\\{productID}",
                                  "valueName": "DOSBOXFOLDER", "valueData": "{app}\\DOSBox", "valueType": "String"}, tmp_path, "1441096843")
    assert a["subkey"] == "Software\\GOG.com\\Games\\1441096843" and a["data"] == f"{tmp_path}\\DOSBox" and a["type"] == "string"
    with pytest.raises(gogfinal.FinalizeError):
        gogfinal.registry_action({"root": "HKEY_CURRENT_USER", "subkey": "Software\\{cokolwiek}", "valueName": "a", "valueData": "b"}, tmp_path, "1")


def test_retry_after_failed_finalize_still_owns_copied_files(env):
    env["root"] = env["tmp"] / "_d6"
    s = {"actions": [SCRIPT["actions"][0], {"install": {"action": "cokolwiek"}},
                     {"install": {"action": "supportData", "arguments": {"type": "file", "source": "{app}\\nie_ma.conf", "target": "{app}"}}}]}
    build_archive(env["root"], script=s)
    with pytest.raises(gi.GogError, match="Finalizacja"):
        _install(env)
    target = env["games"] / "Testowa Gra"
    assert (target / "dosbox.conf").exists()                 # skopiowany przed błędem
    (target / "nie_ma.conf").write_text("x")
    e = gi.resume(FakeServer(env["root"]), PID)
    assert e["state"] == gi.ST_INSTALLED and str(target / "dosbox.conf") in e["created_files"]


def test_inno_setup_forms_found_in_real_scripts(tmp_path):
    """z prawdziwych skryptów archiwum: $hex, {drive:…}, {userappdata}, {commonappdata}, wpisy deinstalatora, folder w Dokumentach"""
    app = tmp_path / "C" / "g"
    app.mkdir(parents=True)
    (app / "x.dat").write_bytes(b"1")
    f = {"winAppData": str(tmp_path / "AD"), "winProgramData": str(tmp_path / "PD"), "winLocalAppData": str(tmp_path / "LA")}
    reg = lambda t, n, d, sub="Software\\X": {"install": {"action": "setRegistry", "arguments": {
        "root": "HKEY_CURRENT_USER", "subkey": sub, "valueName": n, "valueData": d, "valueType": t}}}
    seen = []
    (app / "goggame-1.script").write_text(json.dumps({"actions": [
        reg("dword", "a", "$00000009"), reg("string", "b", "{drive:{app}}\\"), reg("string", "c", "{uninstallexe}", "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{BBF10B37-4ED3}"),
        {"install": {"action": "supportData", "arguments": {"target": "{userdocs}/My Games/X", "type": "folder"}}},
        {"install": {"action": "supportData", "arguments": {"source": "{app}/x.dat", "target": "{userappdata}/Gra/x.dat", "type": "file"}}},
        {"install": {"action": "supportData", "arguments": {"target": "{commonappdata}/GraData", "type": "folder"}}}]}))
    r = gogfinal.apply_script(app, "1", hkcu=seen.append, docs=tmp_path / "docs", folders=f)
    assert [a["name"] for a in seen] == ["a", "b"] and seen[0]["data"] == "9" and seen[1]["data"].endswith(":\\") or seen[1]["data"] == "\\"
    assert "wpis deinstalatora w rejestrze" in r["skipped"]
    assert (tmp_path / "docs" / "My Games" / "X").is_dir() and (tmp_path / "AD" / "Gra" / "x.dat").is_file() and (tmp_path / "PD" / "GraData").is_dir()
    (app / "goggame-1.script").write_text(json.dumps({"actions": [
        {"install": {"action": "supportData", "arguments": {"source": "{app}/x.dat", "target": "{userappdata}/../../poza.dat", "type": "file"}}}]}))
    with pytest.raises(gogfinal.FinalizeError):
        gogfinal.apply_script(app, "1", hkcu=seen.append, docs=tmp_path / "docs", folders=f)


def _app_with_info(tmp_path, tasks, files):
    app = tmp_path / "g"
    for f in files:
        (app / f).parent.mkdir(parents=True, exist_ok=True)
        (app / f).write_bytes(b"x")
    (app / "goggame-1.info").write_text(json.dumps({"playTasks": tasks}))
    return app


def test_dosbox_without_working_dir_starts_where_its_conf_files_are(tmp_path):
    """CyClones i inne: -conf cyclones-base.conf bez workingDir, pliki .conf w głównym folderze gry"""
    t = [{"path": "DOSBOX/dosbox.exe", "arguments": "-noconsole -conf c-base.conf -conf c-game.conf", "category": "game", "isPrimary": True}]
    app = _app_with_info(tmp_path, t, ["DOSBOX/dosbox.exe", "c-base.conf", "c-game.conf"])
    assert gogfinal.launch_spec(app, "1")["cwd"] == str(app)
    app2 = _app_with_info(tmp_path / "b", [{"path": "DOSBOX/dosbox.exe", "arguments": '-conf "..\\c.conf"', "workingDir": "DOSBOX", "category": "game"}], ["DOSBOX/dosbox.exe", "c.conf"])
    assert gogfinal.launch_spec(app2, "1")["cwd"].endswith("DOSBOX")      # z workingDir — jak w opisie
    app3 = _app_with_info(tmp_path / "c", [{"path": "bin/game.exe", "category": "game"}], ["bin/game.exe"])
    assert gogfinal.launch_spec(app3, "1")["cwd"].endswith("bin")         # zwykła gra bez zmian


def test_hidden_or_missing_tasks_are_not_started_by_default(tmp_path):
    t = [{"path": "Show.exe", "category": "launcher", "isPrimary": True},
         {"path": "Art/Win64/Show.exe", "category": "game", "isHidden": True},
         {"path": "Safe.exe", "category": "launcher"}]
    app = _app_with_info(tmp_path, t, ["Show.exe"])
    assert gogfinal.launch_spec(app, "1")["exe"].endswith("Show.exe") and "Win64" not in gogfinal.launch_spec(app, "1")["exe"]
    assert [x["name"] for x in gogfinal.play_tasks(app, "1")] and len(gogfinal.play_tasks(app, "1")) == 1


def test_more_script_forms_from_the_archive(tmp_path):
    a = gogfinal.registry_action({"root": "HKEY_CURRENT_USER", "subkey": "SOFTWARE\\1C\\{{137D91E1-2347-4EAC-BB0B-CC06C6B92A52}", "valueName": "x",
                                  "valueData": "{685BC400-9D2C-11cf-A9CD-00AA006886E3}"}, tmp_path, "1")
    assert a["subkey"].endswith("{137D91E1-2347-4EAC-BB0B-CC06C6B92A52}") and a["data"].startswith("{685BC400")
    b = gogfinal.registry_action({"root": "HKEY_CURRENT_USER", "subkey": "Software\\X", "valueName": "b", "valueData": "CYoJScNIBs==", "valueType": "binary"}, tmp_path, "1")
    assert gogfinal._binary(b["data"])
    assert gogfinal.registry_action({"root": "HKEY_CURRENT_USER", "subkey": "Software\\X", "valueName": "u", "valueData": "{username}"}, tmp_path, "1")["data"]
    app = tmp_path / "g"
    (app / "app").mkdir(parents=True)
    (app / "app" / "renderer.ini").write_text("r")
    (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "supportData", "arguments": {"source": "{supportDir}/add/renderer.ini", "target": "{app}", "type": "file"}}}]}))
    gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "d", folders={})
    assert (app / "renderer.ini").read_text() == "r"


def test_guid_without_dashes_in_registry_key(tmp_path):
    k = "SOFTWARE\\Microsoft\\DirectPlay\\Services\\{5146ab8cb6b1ce11920c00aa006c4972}"
    assert gogfinal.registry_action({"root": "HKEY_CURRENT_USER", "subkey": k, "valueName": "a", "valueData": "b"}, tmp_path, "1")["subkey"] == k


# ── pliki „support” z app/ i finalizacja na innym dysku (Tex Murphy, Al-Qadim, Oblivion) ──

SUPPORT_APP = [("app\\DOSBOX\\dosbox.exe", b"MZdosbox", ["executable", "support"]),
               ("app\\dosboxTex3.conf", b"[dosbox]\n", ["support"]),
               ("1\\Oblivion.ini", b"[General]\n", ["support"])]


def test_support_files_from_app_go_to_game_folder(env):
    """Tex Murphy: DOSBox w manifeście jako app\\DOSBOX\\… z flagą support, playTask wskazuje DOSBOX\\dosbox.exe."""
    env["root"] = env["tmp"] / "_d_sup"
    build_archive(env["root"], extra_files=SUPPORT_APP)
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED
    assert (target / "DOSBOX" / "dosbox.exe").read_bytes() == b"MZdosbox"
    assert (target / "dosboxTex3.conf").is_file() and not (target / "app" / "DOSBOX").exists()
    assert (target / "1" / "Oblivion.ini").is_file()                 # inne pliki „support” — {supportDir}/1 jak dotąd
    assert gi.uninstall(PID, remove_hkcu=lambda a: None)["dir_removed"]


def test_script_copying_support_app_into_game_folder_is_done(env):
    """Al-Qadim / Prisoner of Ice: supportData {supportDir}/app → {app} — pliki już są w katalogu gry."""
    env["root"] = env["tmp"] / "_d_alq"
    s = json.loads(json.dumps(SCRIPT))
    s["actions"].append({"install": {"action": "supportData", "arguments": {
        "overwrite": True, "source": "{supportDir}/app", "target": "{app}", "type": "folder"}}})
    build_archive(env["root"], script=s, extra_files=SUPPORT_APP)
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED and (target / "DOSBOX" / "dosbox.exe").is_file()


def test_support_app_step_without_app_folder(tmp_path):
    """Folderu app/ nie ma (pliki „support” są już w katalogu gry) — krok wykonany, nie „brak źródła”."""
    app = tmp_path / "g"
    app.mkdir()
    (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "supportData", "arguments": {
        "overwrite": True, "source": "{supportDir}/app", "target": "{app}", "type": "folder"}}}]}))
    r = gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "docs", folders={}, known=set())
    assert r["done"] == ["supportData app (pliki już w katalogu gry)"] and r["created"] == []
    # inne źródło, którego nie ma — nadal błąd
    (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "supportData", "arguments": {
        "source": "{supportDir}/add", "target": "{app}", "type": "folder"}}}]}))
    with pytest.raises(gogfinal.FinalizeError):
        gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "docs", folders={}, known=set())


def test_support_rel_only_strips_app_of_support_files():
    sup = {"flags": ["support"], "type": "DepotFile"}
    assert gi.support_rel(sup, "app/DOSBOX/dosbox.exe") == "DOSBOX/dosbox.exe"
    assert gi.support_rel({"flags": ["support"], "type": "DepotDirectory"}, "app") == ""
    assert gi.support_rel(sup, "app") == "app"                                  # plik o nazwie „app” zostaje
    assert gi.support_rel(sup, "application/x.dat") == "application/x.dat"
    assert gi.support_rel(sup, "userdocs/DragonAge.ini") == "userdocs/DragonAge.ini"
    assert gi.support_rel({"type": "DepotFile"}, "app/dosbox.conf") == "app/dosbox.conf"   # zwykły plik gry w folderze app


def test_finalize_copies_to_documents_on_another_drive(tmp_path, monkeypatch):
    """Oblivion: gra na D:, Dokumenty na C: — os.path.relpath między dyskami rzuca ValueError. Plik gracza, który
    już był w Dokumentach, nie trafia do „utworzonych przez instalację”."""
    app, docs = tmp_path / "D" / "Oblivion", tmp_path / "C" / "Dokumenty"
    (app / "1").mkdir(parents=True)
    (app / "1" / "Oblivion.ini").write_text("[General]\n")
    (app / "1" / "Gracza.ini").write_text("nowy\n")
    (docs / "My Games" / "Oblivion").mkdir(parents=True)
    (docs / "My Games" / "Oblivion" / "Gracza.ini").write_text("ustawienia gracza\n")
    (app / "goggame-1.script").write_text(json.dumps({"actions": [{"install": {"action": "supportData", "arguments": {
        "overwrite": True, "source": "{supportDir}/1", "target": "{userdocs}/My Games/Oblivion", "type": "folder"}}}]}))
    real = gogfinal.os.path.relpath

    def relpath(p, start=None):
        if str(p).startswith(str(docs)):
            raise ValueError("path is on mount 'C:', start on mount 'D:'")
        return real(p, start) if start is not None else real(p)
    with monkeypatch.context() as m:
        m.setattr(gogfinal.os.path, "relpath", relpath)
        r = gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=docs, folders={}, known={"1/oblivion.ini"})
    out = docs / "My Games" / "Oblivion"
    assert (out / "Oblivion.ini").is_file()
    assert r["created"] == [str(out / "Oblivion.ini")]                       # Gracza.ini był wcześniej


def test_script_source_inside_support_app_reads_from_game_folder(tmp_path):
    """{supportDir}/app/<podfolder> → gdzie indziej: pliki leżą już w {app}/<podfolder>."""
    app = tmp_path / "g"
    (app / "DOSBOX").mkdir(parents=True)
    (app / "DOSBOX" / "dosbox.conf").write_text("[dosbox]\n")
    (app / "goggame-1.script").write_text(json.dumps({"actions": [
        {"install": {"action": "supportData", "arguments": {"source": "{supportDir}/app/DOSBOX", "target": "{app}/DOSBOX", "type": "folder"}}},
        {"install": {"action": "supportData", "arguments": {"source": "{supportDir}/app/DOSBOX", "target": "{userdocs}/Gra", "type": "folder"}}}]}))
    r = gogfinal.apply_script(app, "1", hkcu=lambda a: None, docs=tmp_path / "docs", folders={}, known={"dosbox/dosbox.conf"})
    assert (tmp_path / "docs" / "Gra" / "dosbox.conf").is_file() and len(r["done"]) == 2


def test_support_file_wins_over_game_file_with_same_path(env):
    env["root"] = env["tmp"] / "_d_col"
    build_archive(env["root"], extra_files=[("app\\game.cfg", b"support", ["support"]), ("game.cfg", b"zwykly", [])])
    e, target, _ = _install(env)
    assert e["state"] == gi.ST_INSTALLED and (target / "game.cfg").read_bytes() == b"support"


def test_old_install_with_support_files_in_app_is_adopted(env):
    """Gra zainstalowana przed support_rel: pliki w <gra>/app/…. Weryfikacja przenosi je na miejsce (bez „uszkodzona”),
    stara kopia zrobiona przez skrypt nie zostaje, odinstalowanie usuwa wszystko."""
    env["root"] = env["tmp"] / "_d_old"
    build_archive(env["root"], extra_files=SUPPORT_APP)
    e, target, _ = _install(env)
    # układ sprzed poprawki: pliki „support” w app/, w rejestrze ścieżki app/…; dosbox.conf skopiowany też przez skrypt
    (target / "app" / "DOSBOX").mkdir(parents=True)
    os.replace(target / "DOSBOX" / "dosbox.exe", target / "app" / "DOSBOX" / "dosbox.exe")
    (target / "DOSBOX").rmdir()
    shutil.copy2(target / "dosboxTex3.conf", target / "app" / "dosboxTex3.conf")
    old = {"DOSBOX/dosbox.exe": "app/DOSBOX/dosbox.exe", "dosboxTex3.conf": "app/dosboxTex3.conf"}
    e = gi.load_entry(PID)
    e["files"] = [[old.get(p, p), s] for p, s in e["files"]]
    gi.save_entry(e)
    assert gi.verify(PID)["ok"]
    assert (target / "DOSBOX" / "dosbox.exe").is_file() and not (target / "app" / "DOSBOX").exists()
    assert not (target / "app" / "dosboxTex3.conf").exists()
    assert "DOSBOX/dosbox.exe" in {p for p, _s in gi.load_entry(PID)["files"]}
    assert gi.uninstall(PID, remove_hkcu=lambda a: None)["dir_removed"]
