"""dosmidi — wyjście MIDI dla gier DOSBox: Roland MT-32 albo Roland SC-55 per gra (etap 11, zgłoszenie 2026-11-16).

Zasady zatwierdzone przez użytkownika (2026-11-16):
  * pliki gry bez zmian — przy starcie DOSBox dostaje dodatkowy plik `-conf` (podfolder gry `.emustart-midi`, ścieżka
    względna) z dwiema liniami `[midi]`: `mididevice=win32` i `midiconfig=<numer portu Windows>`; ostatni `-conf`
    wygrywa, więc reszta konfiguracji gry zostaje,
  * porty wybierane raz w Ustawieniach PO NAZWIE (np. „MIDI 1” = SC-55, „MIDI 2” = MT-32 — config.json:
    `midi_sc55_port`, `midi_mt32_port`); numer liczony przy każdym starcie (numery zmieniają się po odłączeniu USB),
  * tryb gry: auto | mt32 | sc55 | default (DOSBox jak w pliku gry). Auto: najpierw lista gier, które FAŁSZYWIE
    deklarują MT-32 (midigames.FALSE): wysyła General MIDI → SC-55, sterownik MT-32 psuje grę / muzyka cyfrowa / dane
    FM → bez zmian (z uwagą); potem lista MT-32 (midigames.GAMES) → MT-32 (gry z MT-32 i GM też — priorytet MT-32);
    gry spoza list → bez zmian,
  * urządzenie w samej grze (SOUND.CFG, SETUP) ustawia się jej programem konfiguracji — tu tylko port DOSBoxa;
    uwagi z listy (np. „Select GM driver in setup for MT-32 output”) pokazujemy przy grze.
"""

from __future__ import annotations

import ctypes
import re
import sys
from pathlib import Path

MODES = ("auto", "mt32", "sc55", "default")
LABEL = {"mt32": "Roland MT-32", "sc55": "Roland SC-55", "default": "domyślne DOSBoxa"}
MIDI_DIR = ".emustart-midi"
NONE = "-"                                  # w config.json: urządzenie wyłączone (bez zgadywania portu)
_MARKS = re.compile(r"[™®©]")
_SUFFIX = re.compile(r"\s*(?:[-–:]\s*)?(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+anniversary\s+edition|gold(?:\s+edition)?|"
                     r"classic|cd(?:-rom)?\s+version|enhanced\s+edition|legacy\s+edition|trilogy|collection|"
                     r"(?:complete|deluxe|special)(?:\s+edition)?|\(\d{4}\))\s*$", re.IGNORECASE)
_ROMAN = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7", "viii": "8", "ix": "9",
          "x": "10", "xi": "11", "xii": "12", "xiii": "13"}
_NUM = re.compile(r"^\d{1,2}$")
_index: dict = {}
_false: dict = {}
FALSE_WHY = {"gm": "deklaruje MT-32, ale wysyła General MIDI", "digital": "muzyka cyfrowa / z płyty, nie MIDI",
             "broken": "sterownik MT-32 nie działa w tej grze", "fm": "deklaruje MT-32, ale wysyła dane FM",
             "other": "deklaruje MT-32 bez prawdziwej obsługi"}


def norm(title: str) -> str:
    """Tytuł do porównania: bez ™/®, przedimka „The”, znaków przestankowych; „&” = „and”."""
    t = _MARKS.sub("", str(title or "")).lower().replace("&", " and ")
    t = re.sub(r"[^\w]+", " ", t, flags=re.UNICODE).strip()
    words = re.sub(r"^the\s+", "", t).split()
    # cyfry rzymskie jak arabskie („Ultima VII” = „Ultima 7”); samo „i” tylko na końcu albo przed podtytułem
    return " ".join(_ROMAN.get(w, w) if (w != "i" or k == len(words) - 1) else w for k, w in enumerate(words))


def _numbers(n: str) -> set:
    return {w for w in n.split() if _NUM.match(w)}


def _strip_suffix(title: str) -> str:
    t = _MARKS.sub("", str(title or "")).strip()
    for _ in range(3):
        new = _SUFFIX.sub("", t).strip()
        if new == t:
            break
        t = new
    return t


def _idx() -> dict:
    if not _index:
        from emustart.midigames import GAMES
        for row in GAMES:
            for name in [row[0], *row[1]]:
                _index.setdefault(norm(str(name)), row)
    return _index


def _false_idx() -> dict:
    if not _false:
        from emustart.midigames import FALSE
        for row in FALSE:
            for name in [row[0], *row[1]]:
                _false.setdefault(norm(str(name)), row)
    return _false


def find_false(title: str):
    """Wiersz listy gier fałszywie deklarujących MT-32 (tylko dokładnie, z dopiskami edycji zdjętymi)."""
    idx = _false_idx()
    for want in _candidates(title):
        hit = idx.get(want)
        if hit:
            return hit
    return None


def find(title: str):
    """Wiersz listy MT-32 dla tytułu gry albo None: dokładnie, bez dopisków edycji, potem podobieństwo ≥ 0,92."""
    idx = _idx()
    for want in _candidates(title):
        hit = idx.get(want)
        if hit:
            return hit
    # „Ultima 7” → „Ultima VII: The Black Gate”: początek tytułu z listy, tylko z numerem części (bez niego „Wing
    # Commander” złapałby „Wing Commander II”)
    for want in _candidates(title):
        if _numbers(want):
            hits = [row for k, row in idx.items() if k.startswith(want + " ")]
            if hits:                               # „Ultima 7” → Black Gate i Serpent Isle: obie z listy MT-32
                return hits[0]
    from emustart.art_sources import similarity
    want = norm(_strip_suffix(title))
    if len(want) < 4:
        return None
    best, score = None, 0.0
    for k, row in idx.items():
        if _numbers(k) != _numbers(want):          # „Wing Commander 2” ≠ „Wing Commander”
            continue
        s = similarity(want, k)
        if s > score:
            best, score = row, s
    return best if score >= 0.92 else None


def _candidates(title: str) -> list:
    """Postaci tytułu do porównania: cały, bez dopisków edycji, sam tytuł przed podtytułem, części pakietu
    („King's Quest 4+5+6” → „king s quest 4”, „… 5”, „… 6”)."""
    base = _strip_suffix(title)
    head = _strip_suffix(re.split(r"\s*:\s+", base)[0])
    out = [norm(title), norm(base), norm(head)]
    for t in (base, head):
        m = re.match(r"^(.*?)\s*(\d{1,2}(?:\s*[+&]\s*\d{1,2})+)$", _MARKS.sub("", t))
        if m:
            out += [norm(f"{m.group(1)} {n}") for n in re.findall(r"\d{1,2}", m.group(2))]
    seen, uniq = set(), []
    for x in out:
        if x and x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def auto(title: str, fake=False, row=False) -> tuple:
    """(urządzenie | None, powód) dla trybu „auto” (`fake` / `row` — już znalezione wiersze list)."""
    fake = find_false(title) if fake is False else fake
    if fake:
        why = f"lista vogonswiki: {FALSE_WHY.get(fake[2], FALSE_WHY['other'])}"
        return ("sc55", why) if fake[2] == "gm" else (None, why + " — DOSBox bez zmian")
    row = find(title) if row is False else row
    if not row:
        return None, "brak gry na liście MT-32 — DOSBox bez zmian"
    orig = row[2]
    why = "na liście gier MT-32" + (f" (muzyka pisana pod {orig})" if orig else " (muzyka pisana pod MT-32)")
    return "mt32", why


def ports() -> list:
    """Nazwy wyjść MIDI Windows w kolejności numerów (midiconfig DOSBoxa 0.74 = numer z tej listy)."""
    if sys.platform != "win32":
        return []

    class Caps(ctypes.Structure):
        _fields_ = [("wMid", ctypes.c_ushort), ("wPid", ctypes.c_ushort), ("vDriverVersion", ctypes.c_uint),
                    ("szPname", ctypes.c_wchar * 32), ("wTechnology", ctypes.c_ushort), ("wVoices", ctypes.c_ushort),
                    ("wNotes", ctypes.c_ushort), ("wChannelMask", ctypes.c_ushort), ("dwSupport", ctypes.c_uint)]
    try:
        mm = ctypes.windll.winmm
        out = []
        for i in range(mm.midiOutGetNumDevs()):
            c = Caps()
            out.append(c.szPname if mm.midiOutGetDevCapsW(i, ctypes.byref(c), ctypes.sizeof(c)) == 0 else "")
        return out
    except (OSError, AttributeError):
        return []


def port_index(name: str, names: list | None = None) -> int | None:
    """Numer portu o tej nazwie (dokładnie, potem bez wielkości liter, potem jako początek nazwy)."""
    names = ports() if names is None else names
    want = str(name or "").strip()
    if not want:
        return None
    for test in (lambda n: n == want, lambda n: n.lower() == want.lower(), lambda n: n.lower().startswith(want.lower())):
        for i, n in enumerate(names):
            if test(n):
                return i
    return None


def decide(title: str, mode: str, cfg: dict, names: list | None = None) -> dict:
    """{"mode", "device", "port", "index", "reason", "note"} — co dostanie DOSBox tej gry."""
    mode = mode if mode in MODES else "auto"
    names = ports() if names is None else names            # jedno odczytanie portów na decyzję
    fake = find_false(title)
    row = None if fake else find(title)
    note = fake[3] if fake else (row[3] if row else "")
    if mode == "default":
        return {"mode": mode, "device": None, "port": "", "index": None, "reason": "wybór gracza: " + LABEL["default"],
                "note": note}
    if mode == "auto":
        device, reason = auto(title, fake, row)
    else:
        device, reason = mode, "wybór gracza"
    if device is None:
        return {"mode": mode, "device": None, "port": "", "index": None, "reason": reason, "note": note}
    port = port_settings(cfg, names)[device]
    if not port:
        return {"mode": mode, "device": device, "port": "", "index": None, "note": note,
                "reason": f"{reason} — nie wybrano portu {LABEL[device]} w Ustawieniach, DOSBox bez zmian"}
    idx = port_index(port, names)
    if idx is None:
        return {"mode": mode, "device": device, "port": port, "index": None, "note": note,
                "reason": f"{reason} — port „{port}” nie jest podłączony, DOSBox bez zmian"}
    return {"mode": mode, "device": device, "port": port, "index": idx, "note": note,
            "reason": f"{reason} → {LABEL[device]} („{port}”)"}


def apply(spec: dict, app: Path, d: dict) -> dict:
    """Spec DOSBoxa z dodatkowym `-conf` portu MIDI (gdy decyzja wskazuje port); inaczej bez zmian."""
    if d.get("index") is None:
        return spec
    import logging
    import os
    out = Path(app) / MIDI_DIR
    conf = out / "midi.conf"
    try:
        out.mkdir(parents=True, exist_ok=True)
        conf.write_text(f"[midi]\nmididevice=win32\nmidiconfig={int(d['index'])}\n", encoding="latin-1")
    except OSError as ex:                         # folder gry tylko do odczytu — gra startuje bez zmiany MIDI
        logging.getLogger("emustart.dosmidi").info("MIDI: nie zapisałem %s (%s) — DOSBox bez zmian", conf, ex)
        return spec
    try:
        rel = os.path.relpath(conf, spec["cwd"])
    except ValueError:
        rel = str(conf)
    return {**spec, "args": (spec["args"] + f' -conf "{rel}"').strip()}


# Program, który gra MIDI z portu urządzenia (zgłoszenie 2026-11-16: port loopMIDI „MT32” grał tylko przy ręcznie
# uruchomionym Munt mt32emu-qt — bez niego gra była cicha). config.json: midi_mt32_app / midi_sc55_app (ścieżka; „-” —
# nic nie uruchamiać); MT-32 bez ustawienia — Munt mt32emu-qt, jeśli zainstalowany.
MUNT_EXE = "mt32emu-qt.exe"


def _munt() -> str:
    import os
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", "")):
        p = Path(base or "") / "Munt" / MUNT_EXE
        if base and p.is_file():
            return str(p)
    return ""


def companion(device: str | None, cfg: dict) -> str:
    """Ścieżka programu grającego port urządzenia albo "" (nic do uruchomienia)."""
    if device not in ("mt32", "sc55"):
        return ""
    own = str(cfg.get(f"midi_{device}_app") or "").strip()
    if own == "-":
        return ""
    if own:
        return own if Path(own).is_file() else ""
    return _munt() if device == "mt32" else ""


def _running(exe: str) -> bool:
    import subprocess
    name = Path(exe).name
    try:
        out = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {name}", "/NH", "/FO", "CSV"], capture_output=True,
                             text=True, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except (OSError, subprocess.SubprocessError):
        return True                                   # nie wiadomo — lepiej nie uruchamiać drugiej kopii
    return name.lower() in out.lower()


def apps(cfg: dict) -> dict:
    """Programy grające porty: {"mt32": ścieżka|"", "sc55": …} (to, co zostanie uruchomione) i ustawienie gracza
    ({"mt32_set": "", "sc55_set": ""}: "" — domyślnie, "-" — nic, inaczej ścieżka)."""
    return {"mt32": companion("mt32", cfg), "sc55": companion("sc55", cfg),
            "mt32_set": str(cfg.get("midi_mt32_app") or ""), "sc55_set": str(cfg.get("midi_sc55_app") or "")}


def warmup(cfg: dict, names: list | None = None) -> list:
    """Przy starcie Lumena (zgłoszenie 2026-11-16: odtwarzacz SC-55 długo się uruchamia): programy grające porty
    MT-32 / SC-55, które są wybrane i jeszcze nie działają — zminimalizowane, bez fokusu, bez czekania. → uruchomione."""
    ports_ = port_settings(cfg, names)
    out = []
    for device in ("mt32", "sc55"):
        if not ports_.get(device):
            continue
        r = ensure_companion({"device": device, "index": 0}, cfg, wait=0)
        if r:
            out.append(r)
    return out


def ensure_companion(d: dict, cfg: dict, wait: float = 2.0) -> str:
    """Przed startem DOSBoxa: program grający wybrany port (Munt mt32emu-qt) — gdy nie działa, uruchomiony bez
    uprawnień administratora (jak DOSBox — sterownik w grze łączy się z nim), zminimalizowany i bez fokusu (nie
    zabiera pełnego ekranu grze). → opis do logu albo "" (nic nie trzeba było robić)."""
    if d.get("index") is None:
        return ""
    exe = companion(d.get("device"), cfg)
    if not exe or _running(exe):
        return ""
    import time
    from emustart import unelevated
    try:
        unelevated.popen([exe], cwd=str(Path(exe).parent), show=unelevated.SW_SHOWMINNOACTIVE)
    except OSError as ex:
        return f"nie uruchomiono {Path(exe).name}: {ex}"
    time.sleep(wait)                                  # program otwiera porty MIDI, zanim gra zacznie grać
    return f"uruchomiono {Path(exe).name} (zminimalizowany)"


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def guess_port(device: str, names: list) -> str:
    """Domyślny port urządzenia, gdy gracz go nie wybrał: nazwa „SC55” / „SC-55” / „MT32” / „MT-32” (dokładnie, potem
    jako część nazwy; emulator MT-32 tylko, gdy nie ma sprzętu)."""
    want = {"mt32": "mt32", "sc55": "sc55"}.get(device, "")
    if not want:
        return ""
    for n in names:
        if _key(n) == want:
            return n
    hits = [n for n in names if want in _key(n)]
    hits.sort(key=lambda n: "emulator" in n.lower())
    return hits[0] if hits else ""


def port_settings(cfg: dict, names: list | None = None) -> dict:
    """{"ports", "mt32", "sc55"} — wybrane porty (z config.json) albo zgadnięte po nazwie."""
    names = ports() if names is None else names

    def one(d: str) -> str:
        v = str(cfg.get(f"midi_{d}_port") or "")
        return "" if v == NONE else (v or guess_port(d, names))
    return {"ports": names, "mt32": one("mt32"), "sc55": one("sc55")}
