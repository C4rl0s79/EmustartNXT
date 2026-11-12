"""Testy kroków administratora GOG: rejestr HKLM w pamięci i „okno UAC”, które wykonuje proces kroków w tym samym
procesie testów (gogadmin.main) — prawdziwy rejestr i prawdziwe UAC nie są nigdy dotykane."""

from __future__ import annotations

import json
import shlex
from pathlib import Path

import pytest

from emustart import gogadmin, gogfinal


class FakeRegistry:
    def __init__(self):
        self.data: dict = {}            # (widok, klucz, nazwa) → (typ, wartość)

    def get(self, view, subkey, name):
        return self.data.get((view, subkey, name))

    def set(self, view, subkey, name, t, v):
        self.data[(view, subkey, name)] = (t, v)

    def delete(self, view, subkey, name):
        self.data.pop((view, subkey, name), None)


def steps_file(d: Path, steps: list) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    p = d / "steps.json"
    p.write_text(json.dumps({"steps": steps}), encoding="utf-8")
    return p


@pytest.fixture()
def fake_reg(tmp_path, monkeypatch):
    reg = FakeRegistry()
    monkeypatch.setattr(gogadmin, "REG", reg)
    monkeypatch.setattr(gogadmin, "views", lambda: ["64", "32"])
    calls = []

    def accept(exe, params, cwd=None):
        """Zgoda w oknie UAC: proces pomocniczy = gogadmin.main(--gog-admin=<plik>)."""
        calls.append((exe, params))
        arg = next(a for a in shlex.split(params, posix=False) if a.strip('"').startswith("--gog-admin="))
        return gogadmin.main(arg.strip('"').split("=", 1)[1]) == 0

    monkeypatch.setattr(gogfinal, "_shell_runas", accept)
    yield {"reg": reg, "calls": calls, "dir": tmp_path / "admin-steps"}
