"""goginno — wpisy [Registry] z instalatora Inno Setup (galaxy_*.exe z depotów GOG), bez uruchamiania go.

GOG Galaxy uruchamia `galaxy_<gra>.exe` z uprawnieniami administratora: to pełny instalator Inno (pobiera i
rejestruje klienta Galaxy, tworzy skróty, deinstalator, wpisy rejestru). Nie uruchamiamy go — odczytujemy z jego
nagłówka (`setup.0`, skompresowany LZMA w blokach z CRC32) wpisy rejestru, a wykonuje je finalizacja.

Format (Inno Setup 5.5.0, unicode; opis jak w innoextract): tabela SetupLdr (ID `rDlPtS\\xCD\\xE6\\xD7\\x7B\\x0B\\x2A`)
wskazuje setup.0: 64 B wersji danych, potem blok: CRC32(4) + rozmiar(4) + kompresja(1), dane w kawałkach 4096 B
poprzedzonych CRC32; LZMA1 z 5 bajtami właściwości. Wpis rejestru: 9 napisów (długość 32-bit + UTF-16LE): klucz,
nazwa wartości, dane, Components, Tasks, Languages, Check, AfterInstall, BeforeInstall; dwa zakresy wersji Windows
(po 10 B); gałąź (u32, bez bitu 0x80000000); uprawnienia (i16); typ (u8).
"""

from __future__ import annotations

import lzma
import re
import struct
import zlib
from pathlib import Path

_LDR_ID = b"rDlPtS\xcd\xe6\xd7\x7b\x0b\x2a"
_DATA = b"Inno Setup Setup Data (5.5.0) (u)"
HIVES = {0: "HKCR", 1: "HKCU", 2: "HKLM", 3: "HKU"}
TYPES = {0: None, 1: "string", 2: "expandstring", 3: "dword", 4: "binary", 5: "multistring", 6: "qword"}


class InnoError(Exception):
    pass


def read_header(path: Path, max_scan: int = 8 * 1024 * 1024) -> bytes:
    """Rozpakowany nagłówek setup.0 (tylko Inno 5.5.0 unicode — tak budowane są galaxy_*.exe GOG)."""
    with open(path, "rb") as f:
        head = f.read(max_scan)
        m = head.find(_LDR_ID)
        if m < 0:
            raise InnoError("brak tabeli SetupLdr")
        off0 = struct.unpack_from("<8I", head, m + len(_LDR_ID))[5]
        f.seek(off0)
        blob = f.read(64 * 1024 * 1024)
    if not blob.startswith(_DATA):
        raise InnoError(f"nieobsługiwana wersja danych Inno: {blob[:40]!r}")
    pos = 64
    crc, stored, comp = struct.unpack_from("<IIB", blob, pos)
    if zlib.crc32(blob[pos + 4:pos + 9]) & 0xFFFFFFFF != crc:
        raise InnoError("zły CRC nagłówka bloku")
    pos += 9
    raw, end = bytearray(), pos + stored
    while pos < end:
        n = min(4096, end - pos - 4)
        c = struct.unpack_from("<I", blob, pos)[0]
        chunk = blob[pos + 4:pos + 4 + n]
        if zlib.crc32(chunk) & 0xFFFFFFFF != c:
            raise InnoError("zły CRC danych")
        raw += chunk
        pos += 4 + n
    if not comp:
        return bytes(raw)
    p0, dsize = raw[0], struct.unpack("<I", raw[1:5])[0]
    lc, rem = p0 % 9, p0 // 9
    flt = [{"id": lzma.FILTER_LZMA1, "dict_size": dsize, "lc": lc, "lp": rem % 5, "pb": rem // 5}]
    return lzma.LZMADecompressor(format=lzma.FORMAT_RAW, filters=flt).decompress(bytes(raw[5:]))


def _string(b: bytes, pos: int) -> tuple:
    n = struct.unpack_from("<i", b, pos)[0]
    if n < 0 or n % 2 or pos + 4 + n > len(b):
        raise InnoError("zły napis")
    return b[pos + 4:pos + 4 + n].decode("utf-16-le"), pos + 4 + n


def _entry_at(b: bytes, pos: int) -> dict | None:
    """Wpis rejestru zaczynający się od długości klucza w `pos`; None — to nie wpis rejestru."""
    try:
        vals = []
        for _ in range(9):
            s, pos = _string(b, pos)
            vals.append(s)
        pos += 20                                     # MinVersion, OnlyBelowVersion
        hive = struct.unpack_from("<I", b, pos)[0] & 0x7FFFFFFF
        typ = b[pos + 4 + 2]
    except (InnoError, struct.error, IndexError, UnicodeDecodeError):
        return None
    if hive not in HIVES or typ not in TYPES:
        return None
    return {"root": HIVES[hive], "subkey": vals[0], "name": vals[1], "data": vals[2], "type": TYPES[typ],
            "components": vals[3], "tasks": vals[4], "languages": vals[5], "check": vals[6]}


def registry_entries(header: bytes) -> list:
    """Wpisy [Registry]: szukamy napisów kluczy (UTF-16, z prefiksem długości) zaczynających się od gałęzi
    Software\\ / SOFTWARE\\ i czytamy od nich pełny wpis; powtórzenia (te same 3 pola) raz."""
    out, seen = [], set()
    for m in re.finditer(rb"(?i)S\x00O\x00F\x00T\x00W\x00A\x00R\x00E\x00\\\x00", header):
        start = m.start() - 4
        if start < 0:
            continue
        e = _entry_at(header, start)
        if not e:
            continue
        key = (e["root"], e["subkey"].lower(), e["name"].lower(), e["data"])
        if key not in seen:
            seen.add(key)
            out.append(e)
    return out


# wpisy, których nie odtwarzamy: rejestr GOG.com (etap rejestru GOG robi to sam), klient Galaxy, deinstalator,
# menu Start — reszta (flagi zgodności AppCompatFlags\Layers, klucze gry) tak
_SKIP = re.compile(r"(?i)^software\\(wow6432node\\)?(gog\.com\\|microsoft\\windows\\currentversion\\uninstall\\)")


def game_registry(path: Path, windows64: bool = True, language: str = "") -> list:
    """Wpisy rejestru galaxy_*.exe do odtworzenia: [{"root", "subkey", "name", "type", "data"}] — wartości
    z symbolami Inno ({app} zostaje do podstawienia), bez zadań i bez warunków Check innych niż Is32bit/Is64bit
    (te liczymy sami; reszta dotyczy Galaxy i parametrów jego wywołania). `language` — nazwa języka Inno
    (english, polish): wpis tylko dla innych języków jest pomijany; bez niej — tylko wpisy bez ograniczenia języka."""
    out = []
    for e in registry_entries(read_header(path)):
        langs = {x.strip().lower() for x in e["languages"].split() if x.strip()}
        if langs and language.lower() not in langs:
            continue
        check = e["check"].strip().lower()
        if check in ("is32bit", "is64bit"):
            if (check == "is64bit") != windows64:
                continue
        elif check:
            continue
        if _SKIP.match(e["subkey"]) or e["tasks"] or e["type"] in (None, "multistring", "qword"):
            continue
        out.append({k: e[k] for k in ("root", "subkey", "name", "type", "data")})
    return out
