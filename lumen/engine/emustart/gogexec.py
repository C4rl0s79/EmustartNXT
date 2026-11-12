"""gogexec — akcja `Execute` ze skryptów gier GOG (goggame-<id>.script).

GOG Galaxy uruchamia wskazany program (często z uprawnieniami administratora). Większość to krótkie skrypty .cmd
z kilkoma typowymi poleceniami — tłumaczymy je na własne kroki, które deinstalator umie cofnąć:
  • REG ADD HKLM\\Software\\… / HKCU\\Software\\… → wartość rejestru (HKLM: krok administratora; HKCU: od razu),
  • netsh advfirewall firewall add rule name=… program=… → reguła zapory (krok administratora; cofana po nazwie),
  • regsvr32 /s <plik z katalogu gry> → rejestracja filtra/kodeka (krok administratora; cofana regsvr32 /u),
  • DISM /enable-feature /FeatureName:DirectPlay → składnik Windows (krok administratora; zostaje — wspólny),
  • sdbinst -u <plik.sdb> → usunięcie starej bazy zgodności (krok administratora).
`gameux.cmd` (Eksplorator gier Windows, HKEY_CLASSES_ROOT) jest pomijany. Skrypt z innym poleceniem i programy .exe
są uruchamiane bez zmian: z `runAsAdmin` — w kroku administratora, bez — od razu (cofnięcia nie ma, wpis w logu).
"""

from __future__ import annotations

import os
import re
from pathlib import Path

SKIP = {"gameux.cmd"}
_TOKENS = re.compile(r'"[^"]*"|\S+')
_REG_TYPES = {"reg_sz": "string", "reg_expand_sz": "expandstring", "reg_dword": "dword", "reg_binary": "binary"}
_ROOTS = {"hkey_local_machine": "HKLM", "hklm": "HKLM", "hkey_current_user": "HKCU", "hkcu": "HKCU"}


def _expand(line: str, env: dict) -> str:
    """%~dp0, %zmienna%, %zmienna:~a,b% (podciąg) — jak cmd.exe dla prostych skryptów GOG."""
    def sub(m):
        name, rng = m.group(1), m.group(2)
        val = env.get(name.lower())
        if val is None:
            val = os.environ.get(name, m.group(0))
        if rng:
            a, _, b = rng.partition(",")
            a = int(a or 0)
            val = val[a:] if not b else val[a:int(b)] if int(b) < 0 else val[a:a + int(b)]
        return val
    line = line.replace("%~dp0", env["~dp0"])
    return re.sub(r"%([A-Za-z_][A-Za-z0-9_]*)(?::~(-?\d+(?:,-?\d+)?))?%", sub, line)


def _unq(s: str) -> str:
    return s[1:-1] if len(s) >= 2 and s[0] == s[-1] == '"' else s


def _reg_add(toks: list) -> dict | None:
    """REG ADD "klucz" /v nazwa /t typ /d dane /f [/reg:32] → akcja jak setRegistry; None — nieobsługiwana."""
    key = _unq(toks[2]) if len(toks) > 2 else ""
    root, _, sub = key.partition("\\")
    hive = _ROOTS.get(root.lower())
    if not hive or not sub.lower().startswith("software\\"):
        return None
    opts, i = {}, 3
    while i < len(toks):
        t = toks[i].lower()
        if t in ("/v", "/t", "/d") and i + 1 < len(toks):
            opts[t] = _unq(toks[i + 1])
            i += 2
        elif t in ("/f", "/reg:32", "/reg:64", "/ve"):
            opts[t] = True
            i += 1
        else:
            return None
    typ = _REG_TYPES.get(str(opts.get("/t", "reg_sz")).lower())
    if not typ:
        return None
    data = str(opts.get("/d", "")).replace("\\\\", "\\")       # "%locpath%\\" → jeden ukośnik, jak w REG.exe
    if typ == "dword":
        try:
            data = str(int(data, 0) if data.lower().startswith("0x") else int(data or 0))
        except ValueError:
            return None                                  # np. %NIEZNANA% — skrypt uruchamiany bez zmian
    return _reg_result(hive, sub, opts, typ, data)


def _reg_result(hive: str, sub: str, opts: dict, typ: str, data: str) -> dict:
    return {"root": hive, "subkey": sub, "name": "" if "/ve" in opts else str(opts.get("/v", "")),
            "type": typ, "data": data}


def _in_dir(script_dir: Path, f: str) -> str:
    """Ścieżka ze skryptu: względna — od folderu skryptu (cmd.exe GOG Galaxy startuje w nim), nie od katalogu silnika."""
    return os.path.normpath(os.path.join(str(script_dir), f))


def parse_cmd(text: str, script_dir: Path) -> list | None:
    """Skrypt .cmd/.bat z GOG → [krok]; None — polecenie spoza znanych (skrypt uruchamiany bez zmian).
    Kroki: {"reg": akcja} | {"op": "fw", "name", "program"} | {"op": "regsvr", "file"} |
    {"op": "feature", "name"} | {"op": "sdb_file", "file"}."""
    if re.search(r'(?i)/enable-feature\s+/FeatureName:"?DirectPlay"?', text):
        return [{"op": "feature", "name": "DirectPlay"}]          # directplay.cmd: IF … ELSE z DISM
    env = {"~dp0": str(script_dir).rstrip("\\") + "\\"}
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        low = line.lower()
        if not line or low.startswith(("::", "rem ", "echo ", "@echo")) or low in ("exit", "exit /b", "exit /b 0", ""):
            continue
        line = _expand(line, env)
        m = re.match(r"(?i)^set\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if m:
            env[m.group(1).lower()] = m.group(2)
            continue
        toks = _TOKENS.findall(line)
        cmd = toks[0].lower().rsplit("\\", 1)[-1]
        if cmd in ("reg", "reg.exe") and len(toks) > 2 and toks[1].lower() == "add":
            a = _reg_add(toks)
            if not a:
                return None
            out.append({"reg": a})
        elif cmd in ("netsh", "netsh.exe") and " add rule " in low:
            kv = dict(re.findall(r'(\w+)=("[^"]*"|\S+)', line))
            if not kv.get("name") or not kv.get("program"):
                return None
            out.append({"op": "fw", "name": _unq(kv["name"]), "program": _in_dir(script_dir, _unq(kv["program"]))})
        elif cmd in ("regsvr32", "regsvr32.exe"):
            files = [_unq(t) for t in toks[1:] if not t.startswith("/")]
            if len(files) != 1:
                return None
            out.append({"op": "regsvr", "file": _in_dir(script_dir, files[0])})
        elif cmd in ("sdbinst", "sdbinst.exe") and "-u" in [t.lower() for t in toks]:
            files = [_unq(t) for t in toks[1:] if not t.startswith("-")]
            if len(files) != 1:
                return None
            out.append({"op": "sdb_file", "file": _in_dir(script_dir, files[0])})
        else:
            return None
    return out
