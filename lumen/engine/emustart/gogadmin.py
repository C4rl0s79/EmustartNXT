"""gogadmin — kroki administratora instalacji gier GOG w jednym podniesionym procesie (jedno okno UAC).

Proces silnika (bez uprawnień) zapisuje listę kroków do `<dane>/gog/admin/<pid>/steps.json` i uruchamia ten sam
program z `--gog-admin=<plik>` przez ShellExecute „runas” (okno UAC). Proces pomocniczy wykonuje kroki i zapisuje
wynik każdego do `steps.result.json`. Bez pliku wsadowego i regedit — bez kłopotów z cudzysłowami, `&` i `%`.

Plik kroków pisze proces bez uprawnień, więc proces podniesiony przyjmuje tylko znane rodzaje kroków i tylko klucze
`HKLM\\Software\\…`. Rodzaje:
  • reg_set — wartość HKLM w każdym widoku rejestru (na 64-bitowym Windows: 64- i 32-bitowy, gry GOG to zwykle
    programy 32-bitowe),
  • reg_put — dokładna wartość w jednym widoku (przywrócenie stanu sprzed instalacji),
  • reg_del — usunięcie wartości z jednego widoku (klucz znika, gdy zostaje pusty).

Przed wykonaniem kroków `capture` odczytuje (bez uprawnień) wartości, które były w rejestrze — deinstalator
przywraca je albo usuwa wartości dodane przez instalację (`undo_steps`).
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

log = logging.getLogger("emustart.gogadmin")

# typy wartości rejestru (stałe winreg — bez importu, planowanie działa też poza Windows)
REG_SZ, REG_EXPAND_SZ, REG_BINARY, REG_DWORD = 1, 2, 3, 4
_TYPES = {"string": REG_SZ, "expandstring": REG_EXPAND_SZ, "binary": REG_BINARY, "dword": REG_DWORD}
KINDS = ("reg_set", "reg_put", "reg_del")


class WinRegistry:
    """HKLM przez winreg; widok: "64", "32" albo "native" (32-bitowy Windows)."""

    @staticmethod
    def _flag(view: str) -> int:
        import winreg
        return {"64": winreg.KEY_WOW64_64KEY, "32": winreg.KEY_WOW64_32KEY}.get(view, 0)

    def get(self, view: str, subkey: str, name: str):
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, subkey, 0, winreg.KEY_READ | self._flag(view)) as k:
                v, t = winreg.QueryValueEx(k, name)
                return t, v
        except OSError:
            return None

    def set(self, view: str, subkey: str, name: str, t: int, v) -> None:
        import winreg
        with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, subkey, 0, winreg.KEY_SET_VALUE | self._flag(view)) as k:
            winreg.SetValueEx(k, name, 0, t, v)

    def delete(self, view: str, subkey: str, name: str) -> None:
        import winreg
        flag = self._flag(view)
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, subkey, 0,
                                winreg.KEY_SET_VALUE | winreg.KEY_READ | flag) as k:
                try:
                    winreg.DeleteValue(k, name)
                except FileNotFoundError:
                    pass
                empty = winreg.QueryInfoKey(k)[0] == 0 and winreg.QueryInfoKey(k)[1] == 0
        except FileNotFoundError:
            return
        if empty:
            winreg.DeleteKeyEx(winreg.HKEY_LOCAL_MACHINE, subkey, flag, 0)


REG = WinRegistry()


def views() -> list:
    from emustart import gogfinal
    return ["64", "32"] if gogfinal.windows_64() else ["native"]


def _enc(t: int, v):
    """Wartość rejestru → JSON (bajty jako hex)."""
    return {"t": int(t), "v": {"hex": bytes(v).hex()} if isinstance(v, (bytes, bytearray)) else v}


def _dec(d: dict):
    v = d.get("v")
    return int(d["t"]), (bytes.fromhex(v["hex"]) if isinstance(v, dict) else v)


def act_value(a: dict) -> dict:
    """Akcja setRegistry (gogfinal.registry_action) → {"t", "v"}."""
    from emustart import gogfinal
    typ = a.get("type") or "string"
    if typ == "dword":
        return _enc(REG_DWORD, gogfinal._dword(a["data"]))
    if typ == "binary":
        return _enc(REG_BINARY, gogfinal._binary(a["data"]))
    return _enc(_TYPES.get(typ, REG_SZ), str(a.get("data") or ""))


def capture(acts: list) -> list:
    """[{"act", "prev": {widok: {"t","v"} | None}}] — stan rejestru przed zapisem (odczyt bez uprawnień)."""
    out = []
    for a in acts:
        prev = {}
        for view in views():
            try:
                cur = REG.get(view, a["subkey"], a["name"])
            except Exception:                       # noqa: BLE001 — brak winreg (nie Windows) = brak wartości
                cur = None
            prev[view] = _enc(*cur) if cur else None
        out.append({"act": a, "prev": prev})
    return out


def set_steps(done: list) -> list:
    return [{"kind": "reg_set", "subkey": d["act"]["subkey"], "name": d["act"]["name"], **act_value(d["act"])}
            for d in done]


def _norm(d: dict) -> dict:
    """Wpis admin_done sprzed gogadmin (sama akcja, bez stanu poprzedniego) — wartość dodana przez instalację."""
    return d if "act" in d else {"act": d, "prev": None}


def undo_steps(done: list) -> list:
    """Kroki cofające instalację, od ostatniego: wartość sprzed instalacji wraca, dodana przez nas znika."""
    steps = []
    for d in reversed([_norm(x) for x in done or []]):
        a, prev = d["act"], d.get("prev") or {}
        for view in views():
            p = prev.get(view)
            if p:
                steps.append({"kind": "reg_put", "view": view, "subkey": a["subkey"], "name": a["name"], **p})
            else:
                steps.append({"kind": "reg_del", "view": view, "subkey": a["subkey"], "name": a["name"]})
    return steps


def self_cmd() -> list:
    """Ten sam program co silnik: w paczce — EmuStartEngine.exe / EmuStart.exe, w kodzie źródłowym — main.py."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, str(Path(__file__).resolve().parent.parent / "main.py")]


def run(steps: list, work: Path, elevate=None) -> list:
    """Kroki w jednym podniesionym procesie (jedno okno UAC). Wynik: [bool] dla każdego kroku; odmowa w oknie UAC
    albo błąd uruchomienia — same False."""
    if not steps:
        return []
    from emustart import gogfinal
    work = Path(work)
    work.mkdir(parents=True, exist_ok=True)
    path, res = work / "steps.json", work / "steps.result.json"
    res.unlink(missing_ok=True)
    path.write_text(json.dumps({"steps": steps}, ensure_ascii=False), encoding="utf-8")
    cmd = self_cmd() + [f"--gog-admin={path}"]
    (elevate or gogfinal._shell_runas)(cmd[0], subprocess.list2cmdline(cmd[1:]), str(work))
    try:
        got = json.loads(res.read_text(encoding="utf-8")).get("ok") or []
    except (OSError, ValueError):
        got = []
    return [bool(got[i]) if i < len(got) else False for i in range(len(steps))]


def _check(s: dict) -> None:
    if s.get("kind") not in KINDS:
        raise ValueError(f"nieznany krok {s.get('kind')!r}")
    sub = str(s.get("subkey") or "").replace("/", "\\")
    if not sub.lower().startswith("software\\") or ".." in sub.split("\\"):
        raise ValueError(f"klucz poza HKLM\\Software: {sub!r}")
    if s["kind"] != "reg_set" and s.get("view") not in views():
        raise ValueError(f"zły widok rejestru {s.get('view')!r}")


def do_step(s: dict) -> None:
    _check(s)
    if s["kind"] == "reg_set":
        t, v = _dec(s)
        for view in views():
            REG.set(view, s["subkey"], s["name"], t, v)
    elif s["kind"] == "reg_put":
        t, v = _dec(s)
        REG.set(s["view"], s["subkey"], s["name"], t, v)
    else:
        REG.delete(s["view"], s["subkey"], s["name"])


def main(path: str) -> int:
    """Proces podniesiony (`--gog-admin=<plik>`): wykonuje kroki, wynik każdego w `<plik>.result.json`."""
    p = Path(path)
    ok = []
    try:
        steps = json.loads(p.read_text(encoding="utf-8")).get("steps") or []
    except (OSError, ValueError) as ex:
        log.error("GOG admin: plik kroków %s: %s", p, ex)
        steps = []
    for s in steps:
        try:
            do_step(s)
            ok.append(True)
        except Exception as ex:                     # noqa: BLE001 — każdy krok osobno, reszta się wykonuje
            log.error("GOG admin: krok %s: %s", s, ex)
            ok.append(False)
    p.with_suffix(".result.json").write_text(json.dumps({"ok": ok}), encoding="utf-8")
    return 0 if all(ok) else 1
