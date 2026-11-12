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
import os
import re
import subprocess
import sys
from pathlib import Path

log = logging.getLogger("emustart.gogadmin")

# typy wartości rejestru (stałe winreg — bez importu, planowanie działa też poza Windows)
REG_SZ, REG_EXPAND_SZ, REG_BINARY, REG_DWORD = 1, 2, 3, 4
_TYPES = {"string": REG_SZ, "expandstring": REG_EXPAND_SZ, "binary": REG_BINARY, "dword": REG_DWORD}
KINDS = ("reg_set", "reg_put", "reg_del", "sdb_install", "sdb_remove", "sdb_remove_file", "fw_add", "fw_del",
         "regsvr", "unregsvr", "feature", "exec")
FEATURES = {"DirectPlay"}
# akcja (gogfinal/gogexec, pole "op") → krok wykonania i krok cofnięcia (None — zostaje)
_OPS = {"sdb": ("sdb_install", "sdb_remove"), "sdb_file": ("sdb_remove_file", None), "fw": ("fw_add", "fw_del"),
        "regsvr": ("regsvr", "unregsvr"), "feature": ("feature", None), "exec": ("exec", None)}
_GUID = re.compile(r"^\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$|^\{[0-9a-f]{32}\}$")


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
        if a.get("op"):                              # nie rejestr: nic do zapamiętania (cofnięcie wg _OPS)
            out.append({"act": a, "prev": None})
            continue
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
    """Jeden krok na akcję (apply_admin rozdziela wyniki po kolejności)."""
    out = []
    for d in done:
        a = d["act"]
        if a.get("op"):
            out.append({**{k: v for k, v in a.items() if k != "op"}, "kind": _OPS[a["op"]][0]})
        else:
            out.append({"kind": "reg_set", "subkey": a["subkey"], "name": a["name"], **act_value(a)})
    return out


def _norm(d: dict) -> dict:
    """Wpis admin_done sprzed gogadmin (sama akcja, bez stanu poprzedniego) — wartość dodana przez instalację."""
    return d if "act" in d else {"act": d, "prev": None}


def undo_steps(done: list) -> list:
    """Kroki cofające instalację, od ostatniego: wartość sprzed instalacji wraca, dodana przez nas znika."""
    steps = []
    for d in reversed([_norm(x) for x in done or []]):
        a, prev = d["act"], d.get("prev") or {}
        if a.get("op"):
            undo = _OPS.get(a["op"], (None, None))[1]
            if undo:
                keep = {"fw_del": ("name",), "unregsvr": ("file",), "sdb_remove": ("guid",)}[undo]
                steps.append({"kind": undo, **{k: a[k] for k in keep}})
            continue
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


def is_elevated() -> bool:
    """Proces ma już uprawnienia administratora (np. Lumen uruchomiony „jako administrator”) — kroki bez okna UAC."""
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except (AttributeError, OSError):
        return False


def run_here(steps: list) -> list:
    """Kroki w tym procesie (ma uprawnienia administratora) — te same zasady co proces z okna UAC."""
    out = []
    for s in steps:
        try:
            do_step(s)
            out.append(True)
        except Exception as ex:                     # noqa: BLE001 — każdy krok osobno
            log.error("GOG admin: krok %s: %s", s, ex)
            out.append(False)
    return out


def run(steps: list, work: Path, elevate=None) -> list:
    """Kroki w jednym podniesionym procesie (jedno okno UAC); proces z uprawnieniami — od razu, bez okna. Wynik:
    [bool] dla każdego kroku; odmowa w oknie UAC albo błąd uruchomienia — same False."""
    if not steps:
        return []
    if elevate is None and is_elevated():
        return run_here(steps)
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
    if s["kind"] not in ("reg_set", "reg_put", "reg_del", "sdb_install", "sdb_remove"):
        _check_op(s)
        return
    if s["kind"].startswith("sdb_"):
        if not _GUID.match(str(s.get("guid") or "")):
            raise ValueError(f"zły GUID bazy zgodności {s.get('guid')!r}")
        if s["kind"] == "sdb_install":
            f = Path(str(s.get("file") or ""))
            if not f.is_absolute() or f.suffix.lower() != ".sdb" or not f.is_file():
                raise ValueError(f"zły plik bazy zgodności {s.get('file')!r}")
        return
    sub = str(s.get("subkey") or "").replace("/", "\\")
    if not sub.lower().startswith("software\\") or ".." in sub.split("\\"):
        raise ValueError(f"klucz poza HKLM\\Software: {sub!r}")
    if s["kind"] != "reg_set" and s.get("view") not in views():
        raise ValueError(f"zły widok rejestru {s.get('view')!r}")


def _sdbinst(args: list) -> None:
    """sdbinst.exe z katalogu systemowego (pełna ścieżka, nie PATH)."""
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "sdbinst.exe"
    r = subprocess.run([str(exe), *args], capture_output=True, timeout=120,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise RuntimeError(f"sdbinst {' '.join(args)}: kod {r.returncode}")


SDBINST = _sdbinst


def _abs_file(p, suffixes: tuple) -> Path:
    f = Path(str(p or ""))
    if not f.is_absolute() or f.suffix.lower() not in suffixes or not f.is_file():
        raise ValueError(f"zły plik {p!r}")
    return f


def _check_op(s: dict) -> None:
    """Kroki spoza rejestru: tylko pliki z katalogu gry GOG (folder z goggame-*.info), nazwy bez cudzysłowów."""
    k = s["kind"]
    if k in ("fw_add", "fw_del"):
        name = str(s.get("name") or "")
        if not name or any(c in name for c in '"\r\n%'):
            raise ValueError(f"zła nazwa reguły zapory {name!r}")
        if k == "fw_add":
            _abs_file(s.get("program"), (".exe",))
    elif k in ("regsvr", "unregsvr"):
        _abs_file(s.get("file"), (".ax", ".dll", ".ocx"))
    elif k == "feature":
        if s.get("name") not in FEATURES:
            raise ValueError(f"nieznany składnik Windows {s.get('name')!r}")
    elif k == "sdb_remove_file":
        _abs_file(s.get("file"), (".sdb",))
    elif k == "exec":
        exe = _abs_file(s.get("exe"), (".exe", ".cmd", ".bat"))
        root = Path(str(s.get("root") or ""))
        if not root.is_absolute() or not any(root.glob("goggame-*.info")):
            raise ValueError(f"zły katalog gry {root!r}")
        exe.resolve().relative_to(root.resolve())              # ValueError poza katalogiem gry
        if any(c in str(s.get("args") or "") for c in "\r\n"):
            raise ValueError("argumenty z końcem linii")


def _system(name: str) -> str:
    """Program systemowy (pełna ścieżka): 64-bitowy także z 32-bitowego procesu (Sysnative)."""
    root = Path(os.environ.get("SystemRoot", r"C:\Windows"))
    native = root / "Sysnative" / name
    return str(native if native.exists() else root / "System32" / name)


def _run(cmd, cwd=None, ok=(0,)) -> None:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, timeout=600,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode not in ok:
        raise RuntimeError(f"{cmd if isinstance(cmd, str) else ' '.join(cmd)}: kod {r.returncode}")


RUN = _run


def _do_op(s: dict) -> None:
    k = s["kind"]
    if k == "fw_add":
        RUN(f'"{_system("netsh.exe")}" advfirewall firewall add rule name="{s["name"]}" dir=in action=allow '
            f'program="{s["program"]}" enable=yes')
    elif k == "fw_del":
        RUN(f'"{_system("netsh.exe")}" advfirewall firewall delete rule name="{s["name"]}"', ok=(0, 1))
    elif k == "regsvr":
        RUN([_system("regsvr32.exe"), "/s", s["file"]])
    elif k == "unregsvr":
        RUN([_system("regsvr32.exe"), "/s", "/u", s["file"]], ok=(0, 3, 4, 5))   # brak pliku/rejestracji — trudno
    elif k == "feature":
        RUN([_system("dism.exe"), "/Online", "/Enable-Feature", f"/FeatureName:{s['name']}", "/All", "/NoRestart"],
            ok=(0, 3010))
    elif k == "sdb_remove_file":
        SDBINST(["-q", "-u", s["file"]])
    elif k == "exec":
        exe = s["exe"]
        cmd = f'"{_system("cmd.exe")}" /c ""{exe}" {s.get("args") or ""}"' if exe.lower().endswith((".cmd", ".bat"))             else f'"{exe}" {s.get("args") or ""}'.strip()
        try:
            RUN(cmd, cwd=s.get("cwd") or str(Path(exe).parent))
        except RuntimeError as ex:                  # program instalatora kończy się różnie — jak Galaxy: dalej
            log.warning("GOG admin: %s", ex)


def do_step(s: dict) -> None:
    _check(s)
    if s["kind"] not in ("reg_set", "reg_put", "reg_del", "sdb_install", "sdb_remove"):
        _do_op(s)
    elif s["kind"] == "sdb_install":
        SDBINST(["-q", s["file"]])
    elif s["kind"] == "sdb_remove":
        SDBINST(["-q", "-u", "-g", s["guid"]])
    elif s["kind"] == "reg_set":
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
    try:
        steps = json.loads(p.read_text(encoding="utf-8")).get("steps") or []
    except (OSError, ValueError) as ex:
        log.error("GOG admin: plik kroków %s: %s", p, ex)
        steps = []
    ok = run_here(steps)
    p.with_suffix(".result.json").write_text(json.dumps({"ok": ok}), encoding="utf-8")
    return 0 if all(ok) else 1
