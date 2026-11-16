"""Buduje emustart/midigames.py — gry DOS z obsługą Roland MT-32 (lista „List of MT-32-compatible computer games”,
sekcja IBM PC compatibles; vogonswiki.com, licencja CC BY-SA 4.0) dla dosmidi.py (etap 11, 2026-11-16).

Użycie:  python tools/build_midi_games.py            (pobiera stronę)
         python tools/build_midi_games.py plik.wiki  (z zapisanego wikitekstu)
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from pathlib import Path

URL = "https://vogonswiki.com/index.php?title=List_of_MT-32-compatible_computer_games&action=raw"
OUT = Path(__file__).resolve().parent.parent / "emustart" / "midigames.py"


def clean(x: str) -> str:
    x = re.sub(r"\[https?://\S+ ([^\]]+)\]", r"\1", x)
    x = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", x)
    x = re.sub(r"<[^>]+>", "", x).replace("''", "")
    return " ".join(x.split()).strip()


def parse(text: str) -> list:
    a = text.index("== IBM PC compatibles ==")
    b = text.index("\n|}", a)
    out = []
    for r in text[a:b].split("\n|-")[1:]:
        lines = [ln for ln in r.strip().split("\n") if ln.startswith("|") and not ln.startswith("|+")]
        cells = [c for ln in lines for c in ln[1:].split("||")]
        if len(cells) < 7:
            continue
        title, notes = clean(cells[0]), cells[1]
        m = re.search(r"aka ''([^']+)''", notes)
        aka = [clean(x) for x in m.group(1).split("/") if clean(x)] if m else []
        if title:
            out.append((title, tuple(aka), clean(cells[6]), clean(notes)[:400]))
    return out


def kind_of(reason: str) -> str:
    """Rodzaj „fałszywego MT-32”: gm (wysyła General MIDI), digital (muzyka cyfrowa / CD), broken (sterownik MT-32
    psuje grę), fm (wysyła dane FM), other."""
    r = reason.lower()
    if "sends gm" in r:
        return "gm"
    if "digital" in r or "red book" in r or "lacks music" in r:
        return "digital"
    if "crash" in r or "bugged" in r or "nonfunctional" in r or "lacks mt-32 driver" in r or "outputs no music" in r:
        return "broken"
    if "sends fm" in r:
        return "fm"
    return "other"


def parse_false(text: str) -> list:
    """Sekcja „Games that falsely claim MT-32 compatibility” (IBM PC): [tytuł, [inne nazwy], rodzaj, powód]."""
    a = text.index("===Games that falsely claim MT-32 compatibility===")
    b = text.index("\n==", a + 10)
    out = []
    for ln in text[a:b].splitlines():
        if not ln.startswith("*"):
            continue
        # tytuł w ''…'' (może mieć dwukropek), opcjonalny dopisek w nawiasie (aka …, rok, „demo only”), potem „: powód”
        m = re.match(r"^\*\s*''(.+?)''\s*((?:\([^()]*(?:\([^()]*\))?[^()]*\)\s*)*):\s*(.*)$", ln)
        if not m:
            continue
        aka = []
        am = re.search(r"aka ''(.+?)''", m.group(2) or "")
        if am:
            aka = [clean(x) for x in am.group(1).replace("'')", "").split("/") if clean(x)]
        reason = clean(m.group(3))
        out.append((clean(m.group(1)), tuple(aka), kind_of(reason), reason[:400]))
    return out


def main() -> None:
    if len(sys.argv) > 1:
        text = Path(sys.argv[1]).read_text(encoding="utf-8")
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "EmuStart build_midi_games"})
        text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    rows = parse(text)
    false = parse_false(text)
    dump = lambda rs: ",\n".join("    " + json.dumps(list(r[:1]) + [list(r[1])] + list(r[2:]), ensure_ascii=False)  # noqa: E731
                                  for r in rs)
    body = dump(rows)
    OUT.write_text(
        '"""midigames — gry DOS z obsługą Roland MT-32 (wygenerowane: tools/build_midi_games.py — nie edytować ręcznie).\n\n'
        "Źródło: „List of MT-32-compatible computer games” (sekcja IBM PC compatibles), vogonswiki.com, licencja\n"
        "CC BY-SA 4.0. GAMES: [tytuł, [inne nazwy], oryginalny sprzęt audio (puste = MT-32), uwagi]. FALSE (sekcja\n"
        "„Games that falsely claim MT-32 compatibility”): [tytuł, [inne nazwy], rodzaj: gm | digital | broken | fm |\n"
        "other, powód].\n"
        '"""\n\nSOURCE = "https://vogonswiki.com/index.php/List_of_MT-32-compatible_computer_games"\n'
        f"GAMES = [\n{body},\n]\n\nFALSE = [\n{dump(false)},\n]\n", encoding="utf-8", newline="\n")
    print(f"{OUT.name}: {len(rows)} gier MT-32, {len(false)} fałszywie deklarujących MT-32")


if __name__ == "__main__":
    main()
