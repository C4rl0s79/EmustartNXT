"""gogfinal — finalizacja i uruchamianie gier GOG zainstalowanych z serwera (emustart/goginstall.py).

Instalacja z depotów omija instalator GOG, więc kroki z `goggame-<id>.script` wykonujemy sami — wyłącznie
znane, sprawdzone akcje, nigdy programy z manifestu:
  • supportData — kopia pliku/folderu wewnątrz katalogu gry (np. dosbox.conf do katalogu głównego),
  • setIni — wpis w pliku INI w katalogu gry albo w Dokumentach,
  • setRegistry — wartość pod HKEY_CURRENT_USER\\Software\\… (bez uprawnień administratora);
    HKEY_LOCAL_MACHINE wymaga administratora: zostaje jako krok „do zatwierdzenia” (UAC), gra nie jest
    „zainstalowana”, dopóki go nie wykonasz,
  • savePath — folder zapisów (zapamiętany: odinstalowanie go nie rusza).
Inne akcje są pomijane z wpisem w logu. Biblioteki systemowe z zależności (__redist: Visual C++, DirectX)
instaluje się osobnym, jawnym krokiem z UAC (`run_runtimes`) — pliki zależności są w katalogu gry i
weryfikowane jak pozostałe.

Uruchamianie: playTask z `goggame-<id>.info` (zadanie gry przed launcherem zewnętrznym), tylko plik .exe
wewnątrz katalogu gry. Śledzenie: proces gry albo dowolny proces z plikiem wewnątrz katalogu gry (launcher,
który uruchamia grę i kończy się, nie kończy sesji).
"""

from __future__ import annotations

import getpass
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

from emustart.gogarchive import UnsafePath, safe_join

log = logging.getLogger("emustart.gogfinal")


class FinalizeError(Exception):
    pass


def user_documents() -> Path:
    """Folder Dokumenty użytkownika (także przekierowany, np. do OneDrive)."""
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as k:
                v, _ = winreg.QueryValueEx(k, "Personal")
            if v:
                return Path(os.path.expandvars(v))
        except OSError:
            pass
    return Path.home() / "Documents"


# Pliki depotu z flagą „support” i tym przedrostkiem należą do katalogu gry (jak w GOG Galaxy) — instalator zapisuje
# `app/<reszta>` jako `<reszta>` (goginstall.support_rel), a kroki skryptu ze źródłem {supportDir}/app/… czytają stamtąd.
SUPPORT_APP = "app"


def support_app_target(p: Path, app: Path) -> Path | None:
    """{supportDir}/app/<reszta> → {app}/<reszta>; None — ścieżka spoza {supportDir}/app."""
    try:
        rest = Path(os.path.abspath(p)).relative_to(Path(os.path.abspath(Path(app) / SUPPORT_APP)))
    except ValueError:
        return None
    return Path(app) / rest


def same_path(a: Path, b: Path) -> bool:
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


def _inside(p: Path, *roots: Path) -> bool:
    rp = Path(os.path.abspath(p))
    for r in roots:
        try:
            rp.relative_to(Path(os.path.abspath(r)))
            return True
        except ValueError:
            continue
    return False


def ini_set(path: Path, section: str, key: str, value: str) -> None:
    """Jeden klucz w pliku INI; pozostałe linie i końce linii bez zmian (jak setIni instalatora GOG)."""
    raw = path.read_bytes().decode("latin-1") if path.exists() else ""
    nl = "\r\n" if "\r\n" in raw or not raw else "\n"
    lines = raw.splitlines()
    hdr = f"[{section}]".lower()
    start = next((i for i, ln in enumerate(lines) if ln.strip().lower() == hdr), None)
    if start is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines += [f"[{section}]", f"{key}={value}"]
    else:
        end = next((i for i in range(start + 1, len(lines)) if lines[i].strip().startswith("[")), len(lines))
        hit = next((i for i in range(start + 1, end) if lines[i].split("=", 1)[0].strip().lower() == key.lower()), None)
        if hit is not None:
            lines[hit] = f"{key}={value}"
        else:
            ins = end
            while ins > start + 1 and not lines[ins - 1].strip():
                ins -= 1
            lines.insert(ins, f"{key}={value}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((nl.join(lines) + nl).encode("latin-1", errors="replace"))


_REG_TYPES = {"string", "dword", "binary", "expandstring"}
_SUBKEY = re.compile(r"^Software\\[^\x00-\x1f]{1,240}$", re.I)


_GUID = re.compile(r"\{(?:[0-9A-Fa-f]{32}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}")   # dosłowny identyfikator


def _symbols(s: str, app: Path, pid: str, f: dict) -> str:
    """Symbole skryptów GOG (nazwy jak w Inno Setup) → wartości na tym komputerze. Nieznane zostają (błąd u wołającego)."""
    s = str(s or "").replace("{app}", str(app)).replace("{supportDir}", str(app)).replace("{productID}", str(pid))
    for name, key in (("userdocs", "winDocuments"), ("userappdata", "winAppData"), ("localappdata", "winLocalAppData"),
                      ("commonappdata", "winProgramData"), ("userprofile", "home")):
        if f.get(key):
            s = s.replace("{%s}" % name, f[key])
    if "{username}" in s:
        s = s.replace("{username}", getpass.getuser())
    s = s.replace("{{", "{")                                  # Inno Setup: {{ = dosłowny nawias
    # {drive:C:\Gry\X} → C:
    return re.sub(r"\{drive:([^{}]*)\}", lambda m: os.path.splitdrive(m.group(1))[0], s)


def registry_action(args: dict, app: Path, pid: str = "", folders: dict | None = None) -> dict:
    """Sprawdzona akcja setRegistry → {"root": "HKCU"|"HKLM", "subkey", "name", "type", "data"} albo
    FinalizeError. Tylko gałąź Software, znane typy, {app} = katalog gry."""
    root = str(args.get("root") or "").upper()
    hive = {"HKEY_CURRENT_USER": "HKCU", "HKCU": "HKCU", "HKEY_LOCAL_MACHINE": "HKLM", "HKLM": "HKLM"}.get(root)
    if not hive:
        raise FinalizeError(f"setRegistry: nieobsługiwana gałąź {root!r}")
    sub = _symbols(str(args.get("subkey") or ""), app, pid, folders or {}).replace("/", "\\").strip("\\")
    if "{" in _GUID.sub("", sub) or "}" in _GUID.sub("", sub):
        raise FinalizeError(f"setRegistry: nieznany symbol w kluczu {sub!r}")
    if not _SUBKEY.match(sub) or "\\..\\" in f"\\{sub}\\":
        raise FinalizeError(f"setRegistry: klucz poza Software\\…: {sub!r}")
    typ = str(args.get("valueType") or "string").lower()
    if typ not in _REG_TYPES:
        raise FinalizeError(f"setRegistry: nieobsługiwany typ {typ!r}")
    name = str(args.get("valueName") or "").replace("{productID}", str(pid))
    if len(name) > 255 or any(ord(c) < 32 for c in name):
        raise FinalizeError("setRegistry: zła nazwa wartości")
    data = _symbols(str(args.get("valueData") or ""), app, pid, folders or {})
    if "{" in _GUID.sub("", data) and "}" in _GUID.sub("", data):
        raise FinalizeError(f"setRegistry: nieznany symbol w wartości {data!r}")
    if typ == "dword":
        data = str(_dword(data))
    elif typ == "binary":
        _binary(data)
    return {"root": hive, "subkey": sub, "name": name, "type": typ, "data": data}


def _dword(data: str) -> int:
    """Liczba DWORD ze skryptu: dziesiętnie (także z zerami na początku, np. „0001”) albo 0x…; inaczej błąd
    finalizacji (nie wyjątek w połowie zapisu rejestru)."""
    s = (data or "").strip() or "0"
    try:
        v = int(s[1:], 16) if s.startswith("$") else int(s[2:], 16) if s.lower().startswith("0x") else int(s, 10)
    except ValueError:
        raise FinalizeError(f"setRegistry: zła wartość dword {data!r}")
    if not 0 <= v <= 0xFFFFFFFF:
        raise FinalizeError(f"setRegistry: wartość dword poza zakresem {data!r}")
    return v


def _binary(data: str) -> bytes:
    import base64
    import binascii
    s = (data or "").strip().rstrip("=")
    try:
        return base64.b64decode(s + "=" * (-len(s) % 4), validate=True)
    except (binascii.Error, ValueError):
        raise FinalizeError(f"setRegistry: zła wartość binary {data[:40]!r}")


def _reg_value(a: dict):
    import winreg
    if a["type"] == "dword":
        return winreg.REG_DWORD, _dword(a["data"])
    if a["type"] == "binary":
        return winreg.REG_BINARY, _binary(a["data"])
    if a["type"] == "expandstring":
        return winreg.REG_EXPAND_SZ, a["data"]
    return winreg.REG_SZ, a["data"]


def set_hkcu(a: dict) -> None:
    import winreg
    typ, val = _reg_value(a)
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, a["subkey"], 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, a["name"], 0, typ, val)


def remove_hkcu(actions: list) -> int:
    """Odinstalowanie: wartości HKCU ustawione przez finalizację (tylko te; klucz znika, gdy jest pusty)."""
    if os.name != "nt":
        return 0
    import winreg
    n = 0
    for a in actions:
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, a["subkey"], 0, winreg.KEY_SET_VALUE | winreg.KEY_READ) as k:
                winreg.DeleteValue(k, a["name"])
                n += 1
                empty = winreg.QueryInfoKey(k)[0] == 0 and winreg.QueryInfoKey(k)[1] == 0
            if empty:
                winreg.DeleteKey(winreg.HKEY_CURRENT_USER, a["subkey"])
        except OSError:
            continue
    return n


# język gry w rejestrze GOG (instalator GOG: LANGUAGE = nazwa angielska, małymi literami)
_LANG_NAMES = {"en": "english", "pl": "polish", "de": "german", "fr": "french", "es": "spanish", "it": "italian",
               "ru": "russian", "pt": "portuguese", "br": "brazilian", "cs": "czech", "hu": "hungarian",
               "nl": "dutch", "ja": "japanese", "ko": "korean", "zh": "chinese", "tr": "turkish", "uk": "ukrainian",
               "sv": "swedish", "da": "danish", "fi": "finnish", "no": "norwegian", "ro": "romanian"}


def gog_registry_acts(app: Path, pid: str, e: dict, launch: dict, saves: list, script_admin: list) -> list:
    """Wartości `HKLM\\Software\\GOG.com\\Games\\<id>`, które zapisuje instalator GOG (nie skrypt gry) — szukają ich
    łatki, narzędzia GOG (GOGDOSConfig) i menedżery modów. Nazwy jak w instalatorze offline (Quake II, galaxy_*.exe).
    Wartość, którą zapisuje sam skrypt gry, ma pierwszeństwo (pomijana tutaj). Kroki „compat”: gra działa i bez nich."""
    import time as _time
    sub = f"Software\\GOG.com\\Games\\{pid}"
    have = {(str(a.get("subkey") or "").lower(), str(a.get("name") or "").lower()) for a in script_admin}
    exe, args = str(launch.get("exe") or ""), str(launch.get("args") or "")
    lang = str(e.get("primary") or (e.get("languages") or [""])[0])
    code = lang.lower().replace("_", "-")
    name = "brazilian" if code == "pt-br" else _LANG_NAMES.get(code.split("-")[0], code)
    vals = [("PATH", str(app)), ("EXE", exe), ("EXEFILE", Path(exe).name if exe else ""),
            ("WORKINGDIR", str(launch.get("cwd") or app).rstrip("\\") + "\\"), ("LAUNCHCOMMAND", f"{exe} {args}"),
            ("LAUNCHPARAM", args), ("GAMENAME", str(e.get("title") or pid)), ("gameID", str(pid)),
            ("productID", str(pid)), ("VER", str(e.get("version") or "")), ("BUILDID", str(e.get("build_id") or "")),
            ("LANGUAGE", name), ("INSTALLDATE", _time.strftime("%Y-%m-%d %H:%M:%S")),
            ("SAVEGAMEFOLDER", str(saves[0]) if saves else str(app).rstrip("\\") + "\\")]
    return [{"root": "HKLM", "subkey": sub, "name": n, "type": "string", "data": v, "compat": True}
            for n, v in vals if (sub.lower(), n.lower()) not in have]


def windows_64() -> bool:
    """64-bitowy Windows: HKLM\\Software ma osobny widok dla programów 32-bitowych (WOW6432Node)."""
    import platform
    return os.name == "nt" and (platform.machine().endswith("64") or "PROCESSOR_ARCHITEW6432" in os.environ)


def read_script(app: Path, pid: str) -> dict | None:
    p = app / f"goggame-{pid}.script"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8", errors="replace"))
    except ValueError as ex:
        raise FinalizeError(f"goggame-{pid}.script: zły JSON ({ex})")


def _same(a: Path, b: Path) -> bool:
    """skrypt wskazał ten sam plik jako źródło i cel — kopiowanie nie ma sensu (i kończy się błędem)"""
    return os.path.normcase(os.path.abspath(a)) == os.path.normcase(os.path.abspath(b))


_UNINSTALL = re.compile(r"\\Windows\\CurrentVersion\\Uninstall\\", re.I)


def _run_local(exe: Path, args: str, cwd: Path) -> None:
    """Program instalatora bez uprawnień administratora (.bat/.cmd przez cmd.exe); wynik jak w Galaxy — w logu."""
    is_script = exe.suffix.lower() in (".cmd", ".bat")
    cmd = f'cmd.exe /c ""{exe}" {args}"' if is_script else f'"{exe}" {args}'.strip()
    try:
        r = subprocess.run(cmd if os.name == "nt" else [str(exe), *args.split()], cwd=str(cwd), capture_output=True,
                           timeout=600, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode:
            log.warning("GOG: %s zakończył się kodem %d", exe.name, r.returncode)
    except (OSError, subprocess.TimeoutExpired) as ex:
        log.warning("GOG: %s: %s", exe.name, ex)


RUN_LOCAL = _run_local


def _execute(args: dict, app: Path, pid: str, sysf: dict, res: dict, hkcu, resolve) -> None:
    """Akcja Execute (emustart/gogexec.py): znane polecenia skryptów .cmd jako własne kroki (cofane przy
    odinstalowaniu), reszta — program bez zmian: z runAsAdmin w kroku administratora, bez — od razu."""
    from emustart import gogexec
    exe_s = str(args.get("executable") or "")
    name = exe_s.replace("\\", "/").rsplit("/", 1)[-1].lower()
    argstr = str(args.get("arguments") or args.get("argument") or "")
    if not exe_s:
        res["skipped"].append("Execute bez programu")
        return
    if name in gogexec.SKIP:
        res["skipped"].append(f"Execute {name} (Eksplorator gier Windows)")
        return
    if re.match(r"^galaxy_.+\.exe$", name):
        res["skipped"].append(f"Execute {name} (instalator rejestrujący GOG Galaxy)")
        return
    if name == "attrib.exe" and exe_s.lower().startswith("{sys}"):
        # S.T.A.L.K.E.R.: attrib +r fsgame.ltx — plik w katalogu gry tylko do odczytu
        m = re.match(r'^\s*\+r\s+"?([^"]+?)"?\s*$', argstr, re.I)
        base = resolve(args.get("workingDir")) if args.get("workingDir") else app
        target = base / m.group(1) if m else None
        if not target or not _inside(target, app) or not target.is_file():
            raise FinalizeError(f"Execute attrib: {argstr!r}")
        target.chmod(target.stat().st_mode & ~0o222)
        res["done"].append(f"attrib +r {target.name}")
        return
    exe = resolve(exe_s) if "{" in exe_s else app / exe_s.replace("\\", os.sep)
    if not _inside(exe, app) or exe.suffix.lower() not in (".exe", ".cmd", ".bat"):
        raise FinalizeError(f"Execute: program poza katalogiem gry albo nieobsługiwany: {exe_s}")
    if not exe.is_file():
        raise FinalizeError(f"Execute: brak pliku {exe_s}")
    cwd = resolve(args["workingDir"]) if args.get("workingDir") else exe.parent
    cwd = cwd if _inside(cwd, app) else exe.parent
    steps = None
    if exe.suffix.lower() in (".cmd", ".bat"):
        steps = gogexec.parse_cmd(exe.read_text(encoding="latin-1", errors="replace"), exe.parent)
    if steps is not None:
        for st in steps:
            if "reg" in st:
                r = st["reg"]
                a = registry_action({"root": r["root"], "subkey": r["subkey"], "valueName": r["name"],
                                     "valueData": r["data"], "valueType": r["type"]}, app, pid, sysf)
                if a["root"] == "HKCU":
                    hkcu(a)
                    res["hkcu"].append(a)
                else:
                    res["admin"].append(a)
                continue
            f = st.get("program") or st.get("file")
            if f and not _inside(Path(f), app):
                raise FinalizeError(f"Execute {name}: plik poza katalogiem gry: {f}")
            res["admin"].append(st)
        res["done"].append(f"Execute {name} ({len(steps)} kroków)")
    elif args.get("runAsAdmin"):
        res["admin"].append({"op": "exec", "exe": str(exe), "args": argstr, "cwd": str(cwd), "root": str(app)})
    else:
        RUN_LOCAL(exe, argstr, cwd)
        res["done"].append(f"Execute {name}")


def apply_script(app: Path, pid: str, hkcu=None, docs: Path | None = None, known: set | None = None,
                 folders: dict | None = None) -> dict:
    """Akcje instalacyjne `goggame-<pid>.script`. Zwraca {"done", "admin" (kroki HKLM), "skipped", "saves",
    "created" (pliki utworzone kopią — do odinstalowania), "dirs" (puste foldery utworzone przez skrypt)}; błąd akcji,
    która musi się udać → FinalizeError. `known` — pliki gry z manifestu (małe litery, względne): kopia poza nimi
    należy do instalacji także wtedy, gdy powstała w przerwanej wcześniej finalizacji."""
    res: dict[str, list] = {"done": [], "admin": [], "skipped": [], "saves": [], "created": [], "hkcu": [], "dirs": []}
    hkcu = hkcu or set_hkcu
    data = read_script(app, pid)
    if not data:
        return res
    docs_dir = docs or user_documents()
    if folders is None:
        from emustart import gogsaves
        folders = gogsaves.system_folders()
    sysf = {**folders, "winDocuments": str(docs_dir)}
    # poza katalogiem gry skrypt może pisać tylko w folderach użytkownika (Dokumenty, AppData, ProgramData)
    user_dirs = [docs_dir] + [Path(sysf[k]) for k in ("winAppData", "winLocalAppData", "winProgramData") if sysf.get(k)]

    def resolve(s: str | None) -> Path:
        s = _symbols(s or "", app, pid, sysf)
        if "{" in s:
            raise FinalizeError(f"nieznany symbol w ścieżce {s!r}")
        return Path(s.replace("\\", os.sep).replace("/", os.sep))

    def is_new(t: Path) -> bool:
        if known is None:
            return not t.exists()
        if not _inside(t, app):
            # Dokumenty/AppData: plik gracza, który już był, nie jest „utworzony przez instalację”;
            # bez relpath — między dyskami (gra na D:, profil na C:) rzuca ValueError
            return not t.exists()
        return os.path.relpath(t, app).replace("\\", "/").lower() not in known

    for act in data.get("actions") or []:
        ins = (act or {}).get("install") or {}
        kind, args = ins.get("action"), ins.get("arguments") or {}
        if kind == "supportData" and not args.get("source"):
            # bez źródła: instalator tworzy pusty folder (np. {app}/cloud_saves)
            dst = resolve(args.get("target"))
            if str(args.get("type") or "").lower() != "folder" or not args.get("target") or not _inside(dst, app, *user_dirs):
                raise FinalizeError(f"supportData bez źródła: {args.get('target')}")
            dst.mkdir(parents=True, exist_ok=True)
            if _inside(dst, app):
                res["dirs"].append(os.path.relpath(dst, app).replace("\\", "/"))
            res["done"].append(f"folder {dst.name}")
        elif kind == "supportData":
            src, dst = resolve(args.get("source")), resolve(args.get("target"))
            if not (_inside(src, app) and _inside(dst, app, *user_dirs)):
                raise FinalizeError(f"supportData poza katalogiem gry: {args.get('source')} → {args.get('target')}")
            typ = str(args.get("type") or "").lower()
            if not src.exists() and (moved := support_app_target(src, app)) is not None and moved.exists():
                src = moved                    # {supportDir}/app/… — pliki „support” instalator zapisał w katalogu gry
            if typ == "folder" and same_path(src, dst):
                # {supportDir}/app → {app} (Al-Qadim, Prisoner of Ice): nic do kopiowania
                res["done"].append("supportData app (pliki już w katalogu gry)")
                continue
            if typ == "file" and not src.is_file():
                # skrypt wskazuje miejsce sprzed przebudowy paczki (Control, Fallout: London): ten sam plik gdzie indziej w grze
                src = next(iter(sorted(p for p in app.rglob(src.name) if p.is_file())), src)
            if typ == "folder" and src.is_dir():
                for f in src.rglob("*"):
                    if f.is_file():
                        t = dst / f.relative_to(src)
                        t.parent.mkdir(parents=True, exist_ok=True)
                        if _same(f, t):
                            continue
                        if is_new(t):
                            res["created"].append(str(t))
                        shutil.copy2(f, t)
            elif typ == "file" and src.is_file():
                t = (dst / src.name) if (dst.is_dir() or not dst.suffix) else dst
                t.parent.mkdir(parents=True, exist_ok=True)
                if not _same(src, t):
                    if is_new(t):
                        res["created"].append(str(t))
                    shutil.copy2(src, t)
            else:
                raise FinalizeError(f"supportData: brak źródła {args.get('source')}")
            res["done"].append(f"supportData {src.name}")
        elif kind == "setIni":
            fn = resolve(args.get("filename"))
            if not _inside(fn, app, *user_dirs):
                raise FinalizeError(f"setIni poza katalogiem gry i folderami użytkownika: {args.get('filename')}")
            if not fn.exists() and _inside(fn, app):
                res["created"].append(str(fn))       # plik w katalogu gry utworzony przez instalację
            ini_set(fn, str(args.get("section") or ""), str(args.get("keyName") or ""), str(args.get("keyValue") or ""))
            res["done"].append(f"setIni {fn.name} [{args.get('section')}] {args.get('keyName')}")
        elif kind == "setRegistry":
            if _UNINSTALL.search(str(args.get("subkey") or "").replace("/", "\\")):
                res["skipped"].append("wpis deinstalatora w rejestrze")   # gra nie ma deinstalatora Windows
                continue
            a = registry_action(args, app, pid, sysf)
            if a["root"] == "HKCU":
                hkcu(a)
                res["hkcu"].append(a)
                res["done"].append(f"rejestr HKCU\\{a['subkey']} {a['name']}")
            else:
                res["admin"].append(a)
        elif kind in ("Execute", "execute"):
            _execute(args, app, pid, sysf, res, hkcu, resolve)
        elif kind == "installSDB":
            # baza poprawek zgodności Windows (sdbinst) — krok administratora, cofany przy odinstalowaniu
            f = resolve(args.get("sdbFile"))
            guid = "{" + str(args.get("GUID") or "").strip().strip("{}") + "}"      # „{{…}” = nawias Inno Setup
            if not _GUID.fullmatch(guid) or f.suffix.lower() != ".sdb" or not _inside(f, app):
                raise FinalizeError(f"installSDB: zły plik albo GUID: {args.get('sdbFile')} {args.get('GUID')}")
            if not f.is_file():
                raise FinalizeError(f"installSDB: brak pliku {args.get('sdbFile')}")
            res["admin"].append({"op": "sdb", "file": str(f), "guid": guid.lower()})
        elif kind == "savePath":
            try:
                res["saves"].append(str(resolve(args.get("savePath"))))
            except FinalizeError:
                res["skipped"].append("savePath z nieznanym symbolem")
        else:
            res["skipped"].append(str(kind))
            log.info("GOG %s: pomijam akcję %s", pid, kind)
    return res


def _shell_runas(exe: str, params: str, cwd: str | None = None) -> bool:
    """Program z UAC (ShellExecuteEx „runas”), czeka na koniec; True = kod 0."""
    if os.name != "nt":
        return False
    import ctypes
    from ctypes import wintypes

    class SEI(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("fMask", ctypes.c_ulong), ("hwnd", wintypes.HWND),
                    ("lpVerb", wintypes.LPCWSTR), ("lpFile", wintypes.LPCWSTR), ("lpParameters", wintypes.LPCWSTR),
                    ("lpDirectory", wintypes.LPCWSTR), ("nShow", ctypes.c_int), ("hInstApp", wintypes.HINSTANCE),
                    ("lpIDList", ctypes.c_void_p), ("lpClass", wintypes.LPCWSTR), ("hkeyClass", wintypes.HKEY),
                    ("dwHotKey", wintypes.DWORD), ("hIcon", wintypes.HANDLE), ("hProcess", wintypes.HANDLE)]
    sei = SEI(cbSize=ctypes.sizeof(SEI), fMask=0x40, lpVerb="runas", lpFile=exe, lpParameters=params,
              lpDirectory=cwd, nShow=0)
    if not ctypes.windll.shell32.ShellExecuteExW(ctypes.byref(sei)):
        return False                                   # odmowa w oknie UAC
    k32 = ctypes.windll.kernel32
    k32.WaitForSingleObject(sei.hProcess, 0xFFFFFFFF)
    code = wintypes.DWORD()
    k32.GetExitCodeProcess(sei.hProcess, ctypes.byref(code))
    k32.CloseHandle(sei.hProcess)
    return code.value == 0


# biblioteki systemowe z zależności GOG — znane instalatory i ich ciche parametry; inne pliki nie są uruchamiane
RUNTIMES = {
    re.compile(r"^MSVC20(05|08)(_x64)?$", re.I): ("vcredist_x*.exe", "/q"),
    re.compile(r"^MSVC201[0-3](_x64)?$", re.I): ("vcredist_x*.exe", "/q /norestart"),
    re.compile(r"^MSVC20(1[5-9]|2\d)(_x64)?$", re.I): ("vc_redist.x*.exe", "/install /quiet /norestart"),
    re.compile(r"^DirectX$", re.I): ("DXSETUP.exe", "/silent"),
}


def runtime_steps(app: Path, dep_ids: list) -> list:
    """[{"id", "exe", "args"}] dla zależności, które są znanymi bibliotekami systemowymi (plik w __redist)."""
    out = []
    for did in dep_ids:
        for pat, (glob, args) in RUNTIMES.items():
            if not pat.match(did):
                continue
            base = app / "__redist" / did
            hits = sorted(base.glob(glob)) if base.is_dir() else []
            for exe in hits[:1]:
                try:
                    safe_join(app, exe.relative_to(app).as_posix())
                except (UnsafePath, ValueError):
                    continue
                out.append({"id": did, "exe": str(exe), "args": args})
    return out


def run_runtimes(steps: list, elevate=None) -> dict:
    """Instalatory bibliotek — jeden po drugim, każdy z UAC (zgoda użytkownika). {id: ok}."""
    res = {}
    for s in steps:
        ok = (elevate or _shell_runas)(s["exe"], s["args"], str(Path(s["exe"]).parent))
        # kod 1638 (nowsza wersja już jest) / 3010 (wymaga restartu) _shell_runas traktuje jako błąd — log
        res[s["id"]] = bool(ok)
        log.info("GOG: biblioteka %s: %s", s["id"], "OK" if ok else "nie zainstalowano")
    return res


# ── uruchamianie ────────────────────────────────────────────────────────────────

def pick_play_task(tasks: list):
    """Zadanie gry przed launcherem zewnętrznym (np. REDprelauncher Wiedźmina 3 wymaga instalatora GOG):
    główne zadanie gry → dowolne zadanie gry → główne zadanie → pierwsze z plikiem."""
    fts = [t for t in tasks or [] if t.get("path") and (t.get("type") or "FileTask") == "FileTask"]
    fts = [t for t in fts if not t.get("isHidden")] or fts    # ukryte „launcher process” — tylko gdy nie ma innych
    game = [t for t in fts if (t.get("category") or "").lower() == "game"]
    return (next((t for t in game if t.get("isPrimary")), None) or (game[0] if game else None)
            or next((t for t in fts if t.get("isPrimary")), None) or (fts[0] if fts else None))


def _info(app: Path, pid: str) -> dict:
    try:
        return json.loads((app / f"goggame-{pid}.info").read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError) as ex:
        raise FinalizeError(f"brak opisu uruchamiania (goggame-{pid}.info): {ex}")


def play_tasks(app: Path, pid: str) -> list:
    """Zadania uruchamiania gry (np. launcher i obie części Wing Commandera) do wyboru w interfejsie:
    [{"index", "name", "category", "default"}] — tylko pliki .exe wewnątrz katalogu gry."""
    data = _info(app, pid)
    tasks = [t for t in data.get("playTasks") or [] if t.get("path") and (t.get("type") or "FileTask") == "FileTask"]
    best = pick_play_task(tasks)
    out = []
    for i, t in enumerate(tasks):
        try:
            exe = safe_join(app, t["path"])
        except UnsafePath:
            continue
        if exe.suffix.lower() == ".exe" and exe.is_file() and not t.get("isHidden"):
            out.append({"index": i, "name": str(t.get("name") or exe.stem), "category": str(t.get("category") or ""),
                        "default": t is best})
    return out


def _args_in_root(args: str, app: Path, exe_dir: Path) -> bool:
    """Zadanie bez workingDir, a pliki z argumentów (DOSBox: -conf x.conf) leżą w głównym folderze gry, nie obok programu."""
    names = [a or b for a, b in re.findall(r'"([^"]+)"|(\S+)', args) if "." in (a or b) and not (a or b).startswith("-")]
    def inside(base: Path, n: str) -> bool:
        try:
            return safe_join(base, n).is_file()
        except UnsafePath:
            return False
    return any(inside(app, n) and not inside(exe_dir, n) for n in names)


def launch_spec(app: Path, pid: str, task: int | None = None) -> dict:
    """{"exe", "args", "cwd", "name"} z goggame-<pid>.info — ścieżki tylko wewnątrz katalogu gry, tylko .exe.
    `task` — numer zadania z play_tasks (domyślnie zadanie gry przed launcherem)."""
    data = _info(app, pid)
    tasks = [t for t in data.get("playTasks") or [] if t.get("path") and (t.get("type") or "FileTask") == "FileTask"]
    if task is not None and task >= 0:
        if task >= len(tasks):
            raise FinalizeError("nie ma takiego zadania uruchamiania")
        t = tasks[task]
    else:
        def on_disk(x: dict) -> bool:
            try:
                return safe_join(app, x["path"]).is_file()
            except UnsafePath:
                return True                  # niebezpieczna ścieżka — błąd niżej, nie cicha zamiana zadania
        t = pick_play_task([x for x in tasks if on_disk(x)])
    if not t:
        raise FinalizeError("goggame-*.info nie ma zadania uruchamiania gry")
    try:
        exe = safe_join(app, t["path"])
        cwd = safe_join(app, t["workingDir"]) if t.get("workingDir") else exe.parent
    except UnsafePath as ex:
        raise FinalizeError(f"ścieżka uruchamiania poza katalogiem gry: {ex}")
    if exe.suffix.lower() != ".exe":
        raise FinalizeError(f"plik uruchamiania nie jest programem .exe: {t['path']}")
    if not exe.is_file():
        raise FinalizeError(f"brak pliku gry: {t['path']}")
    args = str(t.get("arguments") or "")
    if any(ord(c) < 32 for c in args):
        raise FinalizeError("argumenty uruchamiania zawierają znaki sterujące")
    if not t.get("workingDir") and _args_in_root(args, app, exe.parent):
        cwd = app
    return {"exe": str(exe), "args": args, "cwd": str(cwd if cwd.is_dir() else exe.parent),
            "name": str(t.get("name") or data.get("name") or "")}


def start(spec: dict) -> subprocess.Popen:
    """Gra jako osobny proces (bez powłoki): linia poleceń = "exe" + argumenty z playTask, jak GOG Galaxy."""
    cmd = f'"{spec["exe"]}" {spec["args"]}'.strip()
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    return subprocess.Popen(cmd if os.name == "nt" else [spec["exe"], *spec["args"].split()], cwd=spec["cwd"],
                            close_fds=True, creationflags=flags)


def processes_under(root: Path) -> list:
    """PID-y procesów, których plik programu leży w `root` (Windows; poza nim — pusta lista)."""
    if os.name != "nt":
        return []
    import ctypes
    from ctypes import wintypes

    class PE(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_void_p), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]
    k32 = ctypes.windll.kernel32
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = k32.CreateToolhelp32Snapshot(2, 0)
    if snap in (0, wintypes.HANDLE(-1).value):
        return []
    want = os.path.normcase(os.path.abspath(root)) + os.sep
    out = []
    try:
        pe = PE(dwSize=ctypes.sizeof(PE))
        ok = k32.Process32FirstW(snap, ctypes.byref(pe))
        while ok:
            h = k32.OpenProcess(0x1000, False, pe.th32ProcessID)     # PROCESS_QUERY_LIMITED_INFORMATION
            if h:
                buf = ctypes.create_unicode_buffer(1024)
                n = wintypes.DWORD(1024)
                if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)):
                    if os.path.normcase(buf.value).startswith(want):
                        out.append(int(pe.th32ProcessID))
                k32.CloseHandle(h)
            ok = k32.Process32NextW(snap, ctypes.byref(pe))
    finally:
        k32.CloseHandle(snap)
    return out
