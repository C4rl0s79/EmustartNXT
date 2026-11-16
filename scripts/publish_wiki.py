"""Składa wiki GitHub EmustartNXT z plików repozytorium i (z --push) ją publikuje.

Źródła (repozytorium jest jedynym miejscem edycji — strony na wiki są nadpisywane):
  emustart/docs/wiki/*.md   — EmuStart dla gracza (format wiki GitHub; jej Home.md staje się stroną „EmuStart”)
  lumen/docs/wiki/*.md      — Lumen dla gracza (tryb TV, poradniki kluczy API)
  openwiki/**/*.md          — dokumentacja techniczna z OpenWiki: strony „Technika-…”, bez nagłówka YAML, linki .md
                              przepisane na strony wiki, pliki źródłowe jako linki do GitHuba
Home.md i _Sidebar.md powstają tutaj (mapa trzech sekcji).

Użycie:
  python scripts/publish_wiki.py <folder kopii wiki>            # tylko złożenie, bez commita
  python scripts/publish_wiki.py <folder kopii wiki> --push     # złożenie, commit i push

Folder kopii: git clone https://github.com/C4rl0s79/EmustartNXT.wiki.git <folder>
Strony, które skrypt kiedyś zapisał (znacznik w pierwszej linii), a których już nie ma w źródłach, są usuwane;
strony dodane ręcznie na wiki (bez znacznika) zostają.
"""

from __future__ import annotations

import posixpath
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GITHUB = "https://github.com/C4rl0s79/EmustartNXT"
MARK = "<!-- wiki: z repozytorium EmustartNXT (scripts/publish_wiki.py) — zmiany wprowadzaj w repozytorium: {src} -->"
MARK_RE = re.compile(r"^<!-- wiki: z repozytorium EmustartNXT")

# OpenWiki: ścieżka strony → nazwa strony na wiki (strony index.md katalogów — sama lista plików — prowadzą do mapy)
OPENWIKI_PAGES = {
    "quickstart.md": "Dla-deweloperów",
    "architektura/przeglad-systemu.md": "Technika-Przegląd-systemu",
    "architektura/serwer-emustart.md": "Technika-Serwer-EmuStart",
    "architektura/klienci-emustart.md": "Technika-Klienci-EmuStart",
    "architektura/lumen.md": "Technika-Lumen",
    "integracje/most-lumen-silnik.md": "Technika-Most-Lumen-silnik",
    "przeplywy/api-v1.md": "Technika-API-v1",
    "operacje/budowa-testy-i-wydania.md": "Technika-Budowa-testy-i-wydania",
    "operacje/konfiguracja-porty-i-sciezki.md": "Technika-Konfiguracja-porty-ścieżki-i-logi",
    "operacje/rozwiazywanie-problemow.md": "Technika-Rozwiązywanie-problemów",
}
DIR_INDEX = "Dla-deweloperów"

LINK = re.compile(r"\]\(([^)\s]+)\)")


def split_front(text: str) -> tuple[str, str]:
    """(nagłówek YAML, treść) — nagłówek między pierwszymi dwiema liniami '---'."""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[3:end], text[end + 4 :].lstrip("\n")
    return "", text


def openwiki_sources(front: str) -> list[str]:
    return [m.group(1) for m in re.finditer(r"resource:\s*repo://(\S+)", front)]


def rewrite_openwiki_links(body: str, page_path: str) -> str:
    base = posixpath.dirname(page_path)

    def sub(m: re.Match[str]) -> str:
        target = m.group(1)
        if re.match(r"^[a-z]+:", target) or target.startswith("#"):
            return m.group(0)
        path, _, anchor = target.partition("#")
        resolved = posixpath.normpath(posixpath.join(base, path)) if path else page_path
        if path.endswith("/") or resolved in {"index.md", "."} or resolved.endswith("/index.md"):
            name = DIR_INDEX
        elif resolved in OPENWIKI_PAGES:
            name = OPENWIKI_PAGES[resolved]
        elif resolved.endswith(".md"):
            raise SystemExit(f"{page_path}: link do nieznanej strony {target}")
        else:  # plik repozytorium
            return f"]({GITHUB}/blob/main/{resolved}{'#' + anchor if anchor else ''})"
        return f"]({name}{'#' + anchor if anchor else ''})"

    return LINK.sub(sub, body)


def build() -> dict[str, str]:
    pages: dict[str, str] = {}

    def put(name: str, src: str, text: str) -> None:
        if name in pages:
            raise SystemExit(f"dwie strony o nazwie {name} (druga z {src})")
        pages[name] = MARK.format(src=src) + "\n\n" + text.rstrip() + "\n"

    # EmuStart (gracz): bez zmian treści; Home → EmuStart, link (Home) prowadzi do strony EmuStart
    emu = REPO / "emustart" / "docs" / "wiki"
    for f in sorted(emu.glob("*.md")):
        if f.name == "_Sidebar.md":
            continue
        text = f.read_text(encoding="utf-8").replace("](Home)", "](EmuStart)")
        put("EmuStart" if f.name == "Home.md" else f.stem, f"emustart/docs/wiki/{f.name}", text)

    # Lumen (gracz)
    for f in sorted((REPO / "lumen" / "docs" / "wiki").glob("*.md")):
        put(f.stem, f"lumen/docs/wiki/{f.name}", f.read_text(encoding="utf-8"))

    # OpenWiki (technika)
    ow = REPO / "openwiki"
    for rel, name in OPENWIKI_PAGES.items():
        front, body = split_front((ow / rel).read_text(encoding="utf-8"))
        body = rewrite_openwiki_links(body, rel)
        srcs = openwiki_sources(front)
        if srcs:
            body += "\n\n## Pliki źródłowe\n\n" + "\n".join(f"- [`{s}`]({GITHUB}/blob/main/{s})" for s in srcs) + "\n"
        body += (
            "\n---\n_Strona wygenerowana przez OpenWiki z kodu repozytorium; fragmenty oznaczone „TODO: do weryfikacji” "
            "nie zostały jeszcze sprawdzone._\n"
        )
        put(name, f"openwiki/{rel}", body)

    tech = [(n, (ow / r).read_text(encoding="utf-8")) for r, n in OPENWIKI_PAGES.items() if n != DIR_INDEX]
    titles = {n: (re.search(r'^title:\s*"?(.*?)"?\s*$', t, re.M) or [None, n])[1] for n, t in tech}
    lumen = ["Lumen", "Lumen-tryb-TV", "Klucze-API", "Klucz-Steam-Web-API", "Klucz-SteamGridDB", "Klucze-IGDB", "Klucz-TheGamesDB", "Xbox-aplikacja-Azure"]
    missing = [n for n in lumen if n not in pages]
    if missing:
        raise SystemExit(f"brak stron Lumena: {missing}")

    home = f"""# EmustartNXT — wiki

System do grania na emulowanych platformach i w gry Steam / GOG / Xbox: **serwer EmuStart** trzyma kolekcję gier,
grafiki, konta i zapisy; **Lumen** (Windows) i aplikacja **EmuStart na Androida** biorą wszystko od niego.

## [Lumen](Lumen) — launcher na Windows

- [Tryb TV — listy gier, strona gry, sterowanie](Lumen-tryb-TV)
- [Klucze API (Steam, SteamGridDB, IGDB, TheGamesDB, Azure)](Klucze-API)

## [EmuStart](EmuStart) — serwer, klient i Android

- [EmuStart Server](EmuStart-Server)
- [Instalacja i pierwsze uruchomienie](Instalacja-i-pierwsze-uruchomienie)
- [Rozwiązywanie problemów](Rozwiązywanie-problemów)

## [Dla deweloperów](Dla-deweloperów) — architektura i kod

""" + "\n".join(f"- [{titles[n]}]({n})" for n, _ in tech) + f"""

Pobieranie: [wydania]({GITHUB}/releases) (Lumen: `lumen-v…`, EmuStart: `emustart-v…`).
"""
    put("Home", "scripts/publish_wiki.py", home)

    emu_side = (emu / "_Sidebar.md").read_text(encoding="utf-8")
    emu_side = re.sub(r"^\*\*\[EmuStart\]\(Home\)\*\*\s*\n", "", emu_side)
    emu_side = re.sub(r"\n\[📦 Pobierz\]\([^)]*\)\s*$", "", emu_side.strip())
    sidebar = (
        "**[Strona główna](Home)**\n\n"
        "### [Lumen](Lumen)\n"
        "- [Tryb TV](Lumen-tryb-TV)\n"
        "- [Klucze API](Klucze-API)\n\n"
        "### [EmuStart](EmuStart)\n\n" + emu_side + "\n\n"
        "### [Dla deweloperów](Dla-deweloperów)\n" + "\n".join(f"- [{titles[n]}]({n})" for n, _ in tech) + "\n\n"
        f"[📦 Pobierz]({GITHUB}/releases)\n"
    )
    put("_Sidebar", "scripts/publish_wiki.py", sidebar)
    return pages


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    wiki = Path(sys.argv[1])
    if not (wiki / ".git").exists():
        raise SystemExit(f"{wiki}: to nie jest kopia repozytorium wiki (git clone {GITHUB}.wiki.git)")
    pages = build()
    for f in wiki.glob("*.md"):
        first = f.read_text(encoding="utf-8").split("\n", 1)[0]
        if f.stem not in pages and MARK_RE.match(first):
            f.unlink()
            print("usunięta:", f.name)
    for name, text in pages.items():
        (wiki / f"{name}.md").write_text(text, encoding="utf-8", newline="\n")
    print(f"zapisano {len(pages)} stron w {wiki}")
    git = ["git", "-C", str(wiki)]
    subprocess.run(git + ["add", "-A"], check=True)
    status = subprocess.run(git + ["status", "--short"], check=True, capture_output=True, text=True).stdout
    print(status or "bez zmian")
    if "--push" in sys.argv and status:
        rev = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        subprocess.run(git + ["commit", "-q", "-m", f"Wiki z repozytorium EmustartNXT ({rev})"], check=True)
        subprocess.run(git + ["push", "-q"], check=True)
        print("opublikowano")


if __name__ == "__main__":
    main()
