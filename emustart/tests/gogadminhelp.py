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

    def subkeys(self, view, subkey):
        pre = subkey.lower() + "\\"
        return sorted({k[len(pre):].split("\\")[0] for (v, k, _n) in self.data if v == view and k.lower().startswith(pre)})

    def values(self, view, subkey):
        return [(n, t, val) for (v, k, n), (t, val) in self.data.items() if v == view and k.lower() == subkey.lower()]


def run_main(p: Path) -> int:
    """Proces podniesiony z poprawnym skrótem pliku kroków (jak z gogadmin.run)."""
    import hashlib
    return gogadmin.main(str(p), hashlib.sha256(Path(p).read_bytes()).hexdigest())


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
    monkeypatch.setattr(gogadmin, "is_elevated", lambda: False)
    calls = []

    def accept(exe, params, cwd=None):
        """Zgoda w oknie UAC: proces pomocniczy = gogadmin.main(--gog-admin=<plik>)."""
        calls.append((exe, params))
        args = [a.strip('"') for a in shlex.split(params, posix=False)]
        path = next(a for a in args if a.startswith("--gog-admin=")).split("=", 1)[1]
        sha = next(a for a in args if a.startswith("--gog-admin-sha=")).split("=", 1)[1]
        return gogadmin.main(path, sha) == 0

    monkeypatch.setattr(gogfinal, "_shell_runas", accept)
    yield {"reg": reg, "calls": calls, "dir": tmp_path / "admin-steps"}
