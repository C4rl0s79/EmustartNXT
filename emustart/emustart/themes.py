"""themes — motywy trybu TV Lumena jako paczki .zip (etap 14): sprawdzenie, zapis na serwerze, lista i pliki dla
urządzeń. Lumen sprawdza paczkę jeszcze raz u siebie (działa jako administrator) — ta sama lista zasad.

Paczka:
    theme.json      opis (id, nazwa, wersja, paleta, układ listy, czcionki, blokady edytora „Wygląd”, kategorie…)
    theme.css       wygląd, zawężony do .tv[data-theme="<id>"]
    layers.html     opcjonalnie: dekoracje (cząsteczki, poświaty) — bez skryptów, tylko dozwolone znaczniki
    assets/…        obrazy (png, jpg, webp, gif, svg) i czcionki (woff2)

Zasady (Lumen z uprawnieniami administratora nie może dostać z motywem kodu ani zasobów spoza paczki):
- tylko powyższe pliki, ścieżki wewnątrz paczki, rozmiary w limitach;
- CSS bez `@import`, `expression(`, `behavior:`, `-moz-binding`, `javascript:`; `url()` tylko do `assets/…`,
  `data:image/…`, `data:font/…` albo `#id` (filtry SVG);
- `layers.html` — tylko dozwolone znaczniki i atrybuty, `src` obrazów wyłącznie z `assets/`;
- SVG bez skryptów, `foreignObject`, zdarzeń `on…` i odwołań na zewnątrz;
- paleta czytelna z kanapy: tekst, tekst przygaszony i zaznaczenie ≥ 4.5:1, akcent ≥ 3:1 (jak testy Lumena).

Na serwerze: `<serwer>/themes/<id>/` + `<serwer>/themes/index.json` (id, nazwa, wersja, pliki z SHA-256).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import re
import shutil
import threading
import time
import zipfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

log = logging.getLogger("emustart.themes")

MAX_ZIP = 64 << 20
MAX_FILE = 16 << 20
MAX_FILES = 400
MAX_UNPACKED = 128 << 20
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
# wbudowane motywy Lumena — paczka nie może ich podmienić
RESERVED = {"emustart", "fantasy", "sf"}
ROOT_FILES = {"theme.json", "theme.css", "layers.html"}
ASSET_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".woff2"}
LAYOUTS = {"list", "coverflow"}
AMBIENT = {"none", "embers", "stars"}
ANIM_LEVELS = ("off", "low", "med", "high")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
COLOR = re.compile(r"^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[0-9.\s,%]+\))$")
KEY = re.compile(r"^[a-z0-9_-]{1,40}$")
VERSION = re.compile(r"^[0-9A-Za-z.\-]{1,20}$")
_lock = threading.Lock()


class ThemeError(Exception):
    pass


def themes_dir() -> Path:
    from emustart import paths
    return paths.SERVER / "themes"


# ── kontrast (WCAG 2) — te same progi co testy motywów Lumena ───────────────────

def _lum(hexcolor: str) -> float:
    n = int(hexcolor[1:], 16)
    out = 0.0
    for shift, w in ((16, 0.2126), (8, 0.7152), (0, 0.0722)):
        c = ((n >> shift) & 255) / 255
        out += w * (c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return out


def contrast(a: str, b: str) -> float:
    x, y = sorted((_lum(a), _lum(b)), reverse=True)
    return (x + 0.05) / (y + 0.05)


# ── pliki paczki ────────────────────────────────────────────────────────────────

def _rel(name: str) -> str:
    """Ścieżka pliku w paczce (posix, bez wyjścia poza paczkę) albo ThemeError."""
    if "\\" in name or name.startswith("/") or ":" in name:
        raise ThemeError(f"niedozwolona ścieżka w paczce: {name}")
    p = PurePosixPath(name)
    if any(part in ("", ".", "..") for part in p.parts):
        raise ThemeError(f"niedozwolona ścieżka w paczce: {name}")
    rel = p.as_posix()
    if rel in ROOT_FILES:
        return rel
    if p.parts[0] != "assets" or len(p.parts) < 2:
        raise ThemeError(f"plik spoza dozwolonych (theme.json, theme.css, layers.html, assets/…): {name}")
    if p.suffix.lower() not in ASSET_EXT:
        raise ThemeError(f"niedozwolony typ pliku w assets: {name} (obrazy png/jpg/webp/gif/svg, czcionki woff2)")
    return rel


_CSS_BAD = re.compile(r"@import|expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:", re.I)
_CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I | re.S)


def check_css(text: str, files: set) -> None:
    m = _CSS_BAD.search(text)
    if m:
        raise ThemeError(f"theme.css: niedozwolone „{m.group(0)}”")
    for m in _CSS_URL.finditer(text):
        u = m.group(2).strip()
        if u.startswith("#") or re.match(r"^data:(image|font)/", u, re.I):
            continue
        if u.startswith("assets/") and u.split("?")[0].split("#")[0] in files:
            continue
        raise ThemeError(f"theme.css: url({u}) — dozwolone tylko pliki z assets/ tej paczki, data:image, data:font i #id")


_SVG_BAD = re.compile(rb"<script|foreignObject|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*['\"](?!#)", re.I)


def check_svg(name: str, data: bytes) -> None:
    m = _SVG_BAD.search(data)
    if m:
        raise ThemeError(f"{name}: niedozwolone w SVG „{m.group(0).decode('utf-8', 'replace').strip()}”")


# dekoracje: tylko struktura i grafika, bez skryptów, odnośników, formularzy, osadzonych stron i stylu w atrybutach
TAGS = {"div", "span", "i", "b", "em", "strong", "p", "img", "svg", "g", "path", "circle", "ellipse", "rect", "line",
        "polyline", "polygon", "defs", "lineargradient", "radialgradient", "stop", "filter", "fegaussianblur"}
ATTRS = {"class", "aria-hidden", "role", "alt", "width", "height", "src", "viewbox", "fill", "stroke", "stroke-width",
         "stroke-linecap", "stroke-linejoin", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
         "points", "transform", "opacity", "fill-opacity", "stroke-opacity", "offset", "stop-color", "stop-opacity",
         "gradientunits", "gradienttransform", "id", "xmlns", "preserveaspectratio", "stddeviation", "data-n"}


class _Layers(HTMLParser):
    def __init__(self, files: set):
        super().__init__(convert_charrefs=True)
        self.files = files

    def handle_starttag(self, tag, attrs):
        if tag not in TAGS:
            raise ThemeError(f"layers.html: niedozwolony znacznik <{tag}>")
        for k, v in attrs:
            if k not in ATTRS:
                raise ThemeError(f"layers.html: niedozwolony atrybut {k} w <{tag}>")
            v = v or ""
            if "javascript:" in v.lower() or ("url(" in v.lower() and not re.fullmatch(r"url\(#[A-Za-z0-9_-]+\)", v)):
                raise ThemeError(f"layers.html: niedozwolona wartość {k}=\"{v[:40]}\"")
            if k == "src" and (tag != "img" or v not in self.files or not v.startswith("assets/")):
                raise ThemeError(f"layers.html: src=\"{v[:60]}\" — tylko obrazy z assets/ tej paczki")

    handle_startendtag = handle_starttag

    def handle_decl(self, decl):
        raise ThemeError("layers.html: deklaracje niedozwolone")

    def handle_pi(self, data):
        raise ThemeError("layers.html: instrukcje przetwarzania niedozwolone")


def check_layers(text: str, files: set) -> None:
    p = _Layers(files)
    p.feed(text)
    p.close()


def _str(meta: dict, key: str, n: int, required: bool = False) -> str:
    v = meta.get(key, "")
    if not isinstance(v, str) or len(v) > n or (required and not v.strip()):
        raise ThemeError(f"theme.json: „{key}” — tekst do {n} znaków{' (wymagany)' if required else ''}")
    return v.strip()


def check_meta(meta, files: set) -> dict:
    """theme.json → znormalizowany opis motywu albo ThemeError (z powodem dla autora motywu)."""
    if not isinstance(meta, dict):
        raise ThemeError("theme.json: oczekiwany obiekt JSON")
    tid = meta.get("id")
    if not isinstance(tid, str) or not ID.match(tid):
        raise ThemeError("theme.json: „id” — małe litery, cyfry i „-”, do 40 znaków")
    if tid in RESERVED:
        raise ThemeError(f"theme.json: „{tid}” to wbudowany motyw Lumena — wybierz inne id")
    out: dict = {"id": tid, "name": _str(meta, "name", 40, True), "description": _str(meta, "description", 300),
                 "author": _str(meta, "author", 60)}
    ver = meta.get("version", "1")
    if not isinstance(ver, str) or not VERSION.match(ver):
        raise ThemeError("theme.json: „version” — np. „1.0”")
    out["version"] = ver
    if "minLumen" in meta:
        if not isinstance(meta["minLumen"], str) or not re.match(r"^\d+\.\d+\.\d+$", meta["minLumen"]):
            raise ThemeError("theme.json: „minLumen” — np. „1.0.61”")
        out["minLumen"] = meta["minLumen"]
    pal = meta.get("palette")
    if pal is not None:
        if not isinstance(pal, dict):
            raise ThemeError("theme.json: „palette” — obiekt kolorów")
        for k in ("bg", "text", "dim", "accent", "selText", "selBg"):
            if not isinstance(pal.get(k), str) or not HEX.match(pal[k]):
                raise ThemeError(f"theme.json: palette.{k} — kolor #rrggbb")
        if not isinstance(pal.get("panel"), str) or not COLOR.match(pal["panel"].strip()):
            raise ThemeError("theme.json: palette.panel — kolor (#rgb, #rrggbb, rgba(…))")
        for a, b, need, what in (("text", "bg", 4.5, "tekst na tle"), ("dim", "bg", 4.5, "tekst przygaszony na tle"),
                                 ("selText", "selBg", 4.5, "zaznaczenie"), ("accent", "bg", 3.0, "akcent na tle")):
            c = contrast(pal[a], pal[b])
            if c < need:
                raise ThemeError(f"theme.json: za słaby kontrast — {what} {c:.2f}:1, potrzeba co najmniej {need}:1")
        out["palette"] = {k: pal[k].strip() for k in ("bg", "text", "dim", "accent", "selText", "selBg", "panel")}
    games = meta.get("games") or {}
    if not isinstance(games, dict) or games.get("layout", "list") not in LAYOUTS:
        raise ThemeError("theme.json: games.layout — „list” albo „coverflow”")
    out["games"] = {"layout": games.get("layout", "list"), "reflection": bool(games.get("reflection"))}
    for k in ("logoPlate", "consoleBackdrop"):
        out[k] = bool(meta.get(k))
    amb = meta.get("ambient", "none")
    if amb not in AMBIENT:
        raise ThemeError("theme.json: „ambient” — none, embers albo stars")
    out["ambient"] = amb
    locks = meta.get("locks") or []
    if not isinstance(locks, list) or not all(isinstance(x, str) and KEY.match(x) for x in locks):
        raise ThemeError("theme.json: „locks” — lista kluczy edytora „Wygląd”")
    out["locks"] = locks[:40]
    faces = meta.get("fontFaces") or []
    if not isinstance(faces, list):
        raise ThemeError("theme.json: „fontFaces” — lista {name, file}")
    out["fontFaces"] = []
    for f in faces[:12]:
        if not isinstance(f, dict) or not isinstance(f.get("name"), str) or not KEY.match(f["name"]) \
                or f.get("file") not in files or not str(f["file"]).endswith(".woff2"):
            raise ThemeError("theme.json: fontFaces — {\"name\": \"klucz\", \"file\": \"assets/….woff2\"} (plik w paczce)")
        out["fontFaces"].append({"name": f["name"], "file": f["file"]})
    fonts = meta.get("fonts") or {}
    if not isinstance(fonts, dict):
        raise ThemeError("theme.json: „fonts” — {\"text\": […], \"head\": […]}")
    out["fonts"] = {}
    for k in ("text", "head"):
        lst = fonts.get(k) or []
        if not isinstance(lst, list) or not all(isinstance(x, str) and KEY.match(x) for x in lst):
            raise ThemeError(f"theme.json: fonts.{k} — lista nazw czcionek")
        out["fonts"][k] = lst[:8]
    levels = meta.get("animations") or list(ANIM_LEVELS)
    if not isinstance(levels, list) or not all(x in ANIM_LEVELS for x in levels):
        raise ThemeError("theme.json: „animations” — poziomy z off, low, med, high")
    out["animations"] = [x for x in ANIM_LEVELS if x in levels]
    cats = meta.get("categories") or {}
    if not isinstance(cats, dict):
        raise ThemeError("theme.json: „categories” — {\"klucz\": \"assets/…\"}")
    out["categories"] = {}
    for k, v in list(cats.items())[:200]:
        if not isinstance(k, str) or not re.match(r"^[A-Za-z0-9:_-]{1,60}$", k) or v not in files \
                or PurePosixPath(str(v)).suffix.lower() not in ASSET_EXT - {".woff2"}:
            raise ThemeError(f"theme.json: categories.{k} — obraz z assets/ tej paczki")
        out["categories"][k] = v
    return out


def read_zip(data: bytes) -> tuple:
    """(opis motywu, {ścieżka: bajty}) sprawdzonej paczki albo ThemeError."""
    if len(data) > MAX_ZIP:
        raise ThemeError(f"paczka większa niż {MAX_ZIP >> 20} MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ThemeError("to nie jest plik .zip")
    infos = [i for i in z.infolist() if not i.is_dir()]
    if len(infos) > MAX_FILES:
        raise ThemeError(f"za dużo plików w paczce (najwyżej {MAX_FILES})")
    # paczka spakowana razem z folderem (motyw/theme.json): folder pomijany
    names = [i.filename for i in infos]
    prefix = ""
    if "theme.json" not in names:
        roots = {n.split("/", 1)[0] for n in names}
        if len(roots) == 1 and f"{next(iter(roots))}/theme.json" in names:
            prefix = next(iter(roots)) + "/"
    files: dict = {}
    total = 0
    for i in infos:
        name = i.filename[len(prefix):] if prefix and i.filename.startswith(prefix) else i.filename
        rel = _rel(name)
        if i.file_size > MAX_FILE:
            raise ThemeError(f"{rel}: plik większy niż {MAX_FILE >> 20} MB")
        total += i.file_size
        if total > MAX_UNPACKED:
            raise ThemeError(f"paczka po rozpakowaniu większa niż {MAX_UNPACKED >> 20} MB")
        b = z.read(i)
        if len(b) != i.file_size:
            raise ThemeError(f"{rel}: uszkodzony plik w paczce")
        files[rel] = b
    return check_files(files), files


def check_files(files: dict) -> dict:
    """Zestaw plików motywu ({ścieżka: bajty}) → opis motywu albo ThemeError. To samo sprawdzenie na serwerze
    (paczka z panelu) i w silniku Lumena (pliki pobrane z serwera, przed zapisem u gracza)."""
    for rel in files:
        _rel(rel)
    if "theme.json" not in files or "theme.css" not in files:
        raise ThemeError("w paczce brak theme.json albo theme.css")
    keys = set(files)
    try:
        meta = json.loads(files["theme.json"].decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as ex:
        raise ThemeError(f"theme.json: zły JSON ({ex})")
    info = check_meta(meta, keys)
    try:
        check_css(files["theme.css"].decode("utf-8-sig"), keys)
        if "layers.html" in files:
            check_layers(files["layers.html"].decode("utf-8-sig"), keys)
    except UnicodeDecodeError:
        raise ThemeError("theme.css / layers.html: zapisz w UTF-8")
    for rel, b in files.items():
        if rel.lower().endswith(".svg"):
            check_svg(rel, b)
    return info


# ── serwer: zapis, lista, usuwanie, pliki ───────────────────────────────────────

def _index_entry(d: Path) -> dict | None:
    try:
        info = json.loads((d / ".theme-info.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    files = []
    for p in sorted(d.rglob("*")):
        if p.is_file() and p.name != ".theme-info.json":
            b = p.read_bytes()
            files.append({"path": p.relative_to(d).as_posix(), "size": len(b), "sha256": hashlib.sha256(b).hexdigest()})
    return {**info, "files": files}


def rebuild_index() -> dict:
    root = themes_dir()
    themes = []
    if root.is_dir():
        for d in sorted(root.iterdir()):
            if d.is_dir() and ID.match(d.name):
                e = _index_entry(d)
                if e:
                    themes.append(e)
    idx = {"version": 1, "updated": int(time.time()), "themes": themes}
    root.mkdir(parents=True, exist_ok=True)
    tmp = root / "index.json.tmp"
    tmp.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    tmp.replace(root / "index.json")
    return idx


def index() -> dict:
    try:
        return json.loads((themes_dir() / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        with _lock:
            return rebuild_index()


def _write(root: Path, tid: str, files: dict, info: dict) -> None:
    """Motyw w całości do `root/<id>` (najpierw obok, potem podmiana — nigdy pół starej, pół nowej wersji)."""
    root.mkdir(parents=True, exist_ok=True)
    tmp = root / f".{tid}.new"
    shutil.rmtree(tmp, ignore_errors=True)
    for rel, b in files.items():
        p = tmp / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b)
    (tmp / ".theme-info.json").write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
    dst = root / tid
    old = root / f".{tid}.old"
    shutil.rmtree(old, ignore_errors=True)
    if dst.exists():
        dst.rename(old)
    tmp.rename(dst)
    shutil.rmtree(old, ignore_errors=True)


def install(data: bytes) -> dict:
    """Paczka .zip z panelu → `<serwer>/themes/<id>/` (zastępuje poprzednią wersję tego motywu)."""
    info, files = read_zip(data)
    root = themes_dir()
    with _lock:
        _write(root, info["id"], files, {**info, "installed": int(time.time())})
        rebuild_index()
    log.info("motyw TV %s %s wgrany (%d plików)", info["id"], info["version"], len(files))
    return {"ok": True, "id": info["id"], "name": info["name"], "version": info["version"], "files": len(files)}


def remove(tid: str) -> dict:
    if not isinstance(tid, str) or not ID.match(tid):
        return {"ok": False, "reason": "zły identyfikator motywu"}
    with _lock:
        d = themes_dir() / tid
        if not d.is_dir():
            return {"ok": False, "reason": "nie ma takiego motywu"}
        shutil.rmtree(d)
        rebuild_index()
    log.info("motyw TV %s usunięty", tid)
    return {"ok": True}


def file_path(tid: str, rel: str) -> Path | None:
    """Plik motywu dla urządzenia — tylko pliki z indeksu (żadnej innej ścieżki serwera)."""
    if not isinstance(tid, str) or not ID.match(tid):
        return None
    e = next((t for t in index().get("themes", []) if t.get("id") == tid), None)
    if not e or rel not in {f["path"] for f in e.get("files", [])}:
        return None
    p = themes_dir() / tid / rel
    return p if p.is_file() else None


# ── silnik Lumena: motywy z serwera do folderu Lumena ───────────────────────────

def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def local_info(d: Path) -> dict | None:
    try:
        info = json.loads((d / ".theme-info.json").read_text(encoding="utf-8"))
        return info if isinstance(info, dict) else None
    except (OSError, ValueError):
        return None


def sync(get, dest: Path) -> dict:
    """Motywy z serwera do `dest` (Lumen: `LumenData/themes`). `get(ścieżka)` → (status HTTP, bajty).

    Pobierane tylko pliki o innym SHA-256 niż u gracza; każdy plik zgodny z indeksem serwera (rozmiar, SHA-256), cały
    motyw sprawdzony jak na serwerze (check_files), podmieniany w całości. Motyw, którego nie ma już na serwerze,
    znika; motyw, którego nie dało się pobrać albo nie przeszedł sprawdzenia — zostaje w poprzedniej wersji."""
    st, body = get("/v1/themes")
    if st != 200:
        raise ThemeError(f"serwer: HTTP {st}")
    idx = json.loads(body)
    dest.mkdir(parents=True, exist_ok=True)
    keep: set = set()
    changed = 0
    failed: dict = {}
    for t in idx.get("themes") or []:
        tid = t.get("id") if isinstance(t, dict) else None
        if not isinstance(tid, str) or not ID.match(tid) or tid in RESERVED:
            continue
        here = dest / tid
        old = local_info(here)
        try:
            want = {}
            for f in t.get("files") or []:
                rel = _rel(str(f.get("path")))
                want[rel] = str(f.get("sha256") or "").lower()
            if old and old.get("sha") == want:
                keep.add(tid)
                continue
            files = {}
            for rel, sha in want.items():
                b = None
                if old and (old.get("sha") or {}).get(rel) == sha and (here / rel).is_file():
                    b = (here / rel).read_bytes()
                    if _sha(b) != sha:
                        b = None
                if b is None:
                    import urllib.parse
                    code, b = get(f"/v1/themes/{tid}/{urllib.parse.quote(rel)}")
                    if code != 200:
                        raise ThemeError(f"{rel}: serwer HTTP {code}")
                if len(b) > MAX_FILE or _sha(b) != sha:
                    raise ThemeError(f"{rel}: plik niezgodny z indeksem serwera")
                files[rel] = b
            info = check_files(files)
            if info["id"] != tid:
                raise ThemeError("id w theme.json inne niż w indeksie serwera")
            _write(dest, tid, files, {**info, "sha": want, "synced": int(time.time())})
            changed += 1
            keep.add(tid)
        except (ThemeError, OSError, ValueError, TypeError, AttributeError) as ex:
            failed[tid] = str(ex)
            log.warning("motyw TV %s: %s", tid, ex)
            if old:
                keep.add(tid)
    for d in dest.iterdir():
        if d.is_dir() and (d.name.startswith(".") or (ID.match(d.name) and d.name not in keep)):
            shutil.rmtree(d, ignore_errors=True)
    return {"ok": True, "themes": sorted(keep), "changed": changed, "failed": failed}
