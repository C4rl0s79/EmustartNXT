"""unelevated.popen: gra / emulator bez uprawnień administratora, gdy silnik je ma (Lumen jako administrator)."""

from __future__ import annotations

import subprocess

from emustart import gogadmin, unelevated


def test_without_elevation_plain_popen(monkeypatch):
    seen = {}
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: False)
    monkeypatch.setattr(unelevated, "WITH_SHELL_TOKEN", lambda *a: seen.setdefault("token", a))
    monkeypatch.setattr(unelevated.subprocess, "Popen", lambda cmd, **k: seen.setdefault("popen", (cmd, k)))
    unelevated.popen(["emu.exe", "-x"], cwd="C:/E", env={"A": "1"})
    assert "token" not in seen and seen["popen"][0] == ["emu.exe", "-x"] and seen["popen"][1]["cwd"] == "C:/E"


def test_elevated_uses_shell_token_with_command_line(monkeypatch):
    seen = {}
    monkeypatch.setattr(unelevated.os, "name", "nt")
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: True)
    monkeypatch.setattr(unelevated, "WITH_SHELL_TOKEN", lambda line, cwd, env, flags: seen.setdefault("t", (line, cwd, env, flags)) or "P")
    monkeypatch.setattr(unelevated.subprocess, "Popen", lambda *a, **k: seen.setdefault("popen", True))
    p = unelevated.popen(["C:/Emu/retro arch.exe", "-L", "core.dll"], cwd="C:/Emu", env={"SDL": "1"}, creationflags=8)
    assert p == seen["t"] and "popen" not in seen
    assert seen["t"] == ('"C:/Emu/retro arch.exe" -L core.dll', "C:/Emu", {"SDL": "1"}, 8)


def test_elevated_but_shell_token_fails_falls_back(monkeypatch):
    seen = {}
    monkeypatch.setattr(unelevated.os, "name", "nt")
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: True)

    def fail(*a):
        raise OSError("brak powłoki")
    monkeypatch.setattr(unelevated, "WITH_SHELL_TOKEN", fail)
    monkeypatch.setattr(unelevated.subprocess, "Popen", lambda cmd, **k: seen.setdefault("popen", cmd) or "ok")
    unelevated.popen('"C:/Gra/gra.exe" -okno', cwd="C:/Gra")
    assert seen["popen"] == '"C:/Gra/gra.exe" -okno'


def test_env_block_sorted_and_double_terminated():
    b = unelevated._env_block({"b": "2", "A": "1"})
    assert b[:] == "A=1\0b=2\0\0"


def test_gog_start_and_emulators_go_through_unelevated():
    import inspect

    from emustart import gogfinal, launcher
    assert "unelevated.popen" in inspect.getsource(gogfinal.start)
    src = inspect.getsource(launcher)
    assert src.count("unelevated.popen(") == 2 and "subprocess.Popen(cmd, cwd=str(Path(exe).parent)" not in src


def test_popen_signature_kept(monkeypatch):
    """Obiekt z Popen ma metody używane przez launchery (wait, poll, returncode, terminate)."""
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: False)
    p = unelevated.popen(["python", "-c", "pass"])
    assert isinstance(p, subprocess.Popen) and p.wait() == 0 and p.poll() == 0
