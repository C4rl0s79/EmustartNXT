"""usercollections — kolekcje gier kont (serwer EmuStart): kategorie Lumena z grami EmuStart, dla APK.

Plik: `<dane serwera>/collections.json` — dla każdego konta `by_device`: {urządzenie: {"items": [...], "at"}}.
Lumen przysyła wszystkie swoje kolekcje z grami EmuStart (`POST /v1/collections`); zestaw zastępuje poprzedni zestaw
TEGO urządzenia i nie rusza innych (drugi komputer konta bez tych kolekcji ich nie kasuje — jak nazwy kolekcji
w userart, 0.63.5). `GET /v1/collections` łączy zestawy urządzeń konta: ta sama nazwa — jedna kolekcja, suma gier.

Gra = `savesync.game_id(system, nazwa)` — ten sam identyfikator na każdym urządzeniu (Lumen: `sid`, APK:
`SaveSync.gameId`). Konto zawsze z tokenu urządzenia (remote._sync_identity), nigdy z treści.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

from emustart import paths

MAX_COLLECTIONS = 500                 # na urządzenie
MAX_GAMES = 20000                     # gier w jednej kolekcji
MAX_AGE = 90 * 86400                  # zestaw z urządzenia, które tyle się nie synchronizowało, nie jest pokazywany
COL_ID = re.compile(r"^[A-Za-z0-9:_.-]{1,120}$")
GAME_ID = re.compile(r"^g[0-9a-f]{20}$")       # savesync.game_id
_lock = threading.Lock()


class CollectionsError(ValueError):
    pass


def _file() -> Path:
    return paths.DATA / "collections.json"


def _load() -> dict:
    try:
        d = json.loads(_file().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) and isinstance(d.get("accounts"), dict) else {"accounts": {}}
    except (OSError, ValueError):
        return {"accounts": {}}


def _save(d: dict) -> None:
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, f)


def _name(v) -> str:
    return " ".join("".join(ch for ch in str(v or "") if ch.isprintable() or ch.isspace()).split())[:120].strip()


def clean(items) -> list:
    """Lista od Lumena → [{id, name, games}] bez błędnych wpisów; zła lista (nie lista, za długa) — błąd."""
    if not isinstance(items, list) or len(items) > MAX_COLLECTIONS:
        raise CollectionsError("zła lista kolekcji")
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        cid, name, games = str(it.get("id") or ""), _name(it.get("name")), it.get("games")
        if not COL_ID.match(cid) or not name or not isinstance(games, list):
            continue
        ids = list(dict.fromkeys(str(g) for g in games[:MAX_GAMES] if isinstance(g, str) and GAME_ID.match(g)))
        if ids:
            out.append({"id": cid, "name": name, "games": ids})
    return out


def _device_of_account(dev: str, account: str) -> bool:
    from emustart import userart
    return userart._device_of_account(dev, account)   # noqa: SLF001 — ta sama reguła co nazwy kolekcji


def sync(account: str, device: str, items) -> dict:
    """Zestaw kolekcji urządzenia → serwer (zastępuje poprzedni zestaw tego urządzenia); wynik jak `get`."""
    items = clean(items)
    with _lock:
        d = _load()
        a = d["accounts"].setdefault(str(account).lower(), {})
        by_dev = a.get("by_device")
        if not isinstance(by_dev, dict):
            by_dev = a["by_device"] = {}
        changed = False
        for dev in [k for k in by_dev if not _device_of_account(k, account)]:
            del by_dev[dev]                     # urządzenie odwołane / przeniesione — plik nie rośnie
            changed = True
        cur, now = by_dev.get(str(device)), time.time()
        # znacznik czasu najwyżej raz na dobę: synchronizacja co 10 minut nie zapisuje pliku bez zmian
        if not isinstance(cur, dict) or cur.get("items") != items or now - float(cur.get("at") or 0) > 86400:
            by_dev[str(device)] = {"items": items, "at": now}
            changed = True
        if changed:
            _save(d)
    return get(account)


def get(account: str) -> dict:
    """Kolekcje konta ze wszystkich jego urządzeń: {"ok", "collections": [{name, games}]} — po nazwie (bez wielkości
    liter), gry bez powtórzeń; zestawy urządzeń odwołanych albo nieaktywnych od 90 dni się nie liczą."""
    a = (_load()["accounts"].get(str(account).lower()) or {})
    old = time.time() - MAX_AGE
    merged: dict = {}
    for dev, e in sorted((a.get("by_device") or {}).items(), key=lambda x: -float((x[1] or {}).get("at") or 0)):
        if not isinstance(e, dict) or float(e.get("at") or 0) < old or not _device_of_account(dev, account):
            continue
        for it in e.get("items") or []:
            if not isinstance(it, dict) or not isinstance(it.get("games"), list):
                continue
            c = merged.setdefault(str(it.get("name") or "").lower(), {"name": it.get("name"), "games": {}})
            c["games"].update(dict.fromkeys(it["games"]))      # kolejność: pierwsze wystąpienie, bez powtórzeń
    cols = [{"name": c["name"], "games": list(c["games"])} for k, c in merged.items() if k and c["games"]]
    return {"ok": True, "collections": sorted(cols, key=lambda c: str(c["name"]).lower())}
