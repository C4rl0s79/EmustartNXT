"""Motywy TV Lumena jako paczki .zip (etap 14a): co serwer przyjmuje, co odrzuca, zapis i pliki dla urządzeń."""

import io
import json
import zipfile

import pytest

from emustart import themes

PAL = {"bg": "#05010f", "text": "#f4ecff", "dim": "#c5b4eb", "accent": "#2de2ff", "selText": "#05010f",
       "selBg": "#2de2ff", "panel": "rgba(13, 6, 38, 0.82)"}
META = {"id": "portal-nexus", "name": "Portal Nexus", "version": "1.0", "description": "Neon i synthwave",
        "palette": PAL, "games": {"layout": "coverflow", "reflection": True}, "ambient": "stars",
        "fonts": {"text": ["atkinson", "orbitron"], "head": ["orbitron"]},
        "fontFaces": [{"name": "orbitron", "file": "assets/fonts/orbitron.woff2"}],
        "animations": ["off", "low", "med", "high"], "categories": {"family:pc": "assets/categories/pc.webp"}}
CSS = ".tv[data-theme='portal-nexus'] { background: url(assets/bg.webp) } .x { mask: url(#m); }"
LAYERS = '<div class="nx-particles" aria-hidden="true"><i></i><i></i><img src="assets/glow.png" alt=""></div>'


def pack(files: dict, prefix: str = "") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(prefix + name, data if isinstance(data, bytes) else str(data))
    return buf.getvalue()


def good(**over) -> dict:
    f = {"theme.json": json.dumps(META), "theme.css": CSS, "layers.html": LAYERS, "assets/bg.webp": b"RIFF....WEBP",
         "assets/glow.png": b"\x89PNG", "assets/fonts/orbitron.woff2": b"wOF2", "assets/categories/pc.webp": b"RIFF"}
    f.update(over)
    return {k: v for k, v in f.items() if v is not None}


@pytest.fixture()
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(themes, "themes_dir", lambda: tmp_path / "themes")
    return tmp_path / "themes"


def test_install_index_and_files(root):
    r = themes.install(pack(good()))
    assert r == {"ok": True, "id": "portal-nexus", "name": "Portal Nexus", "version": "1.0", "files": 7}
    idx = themes.index()
    t = idx["themes"][0]
    assert t["id"] == "portal-nexus" and t["games"]["layout"] == "coverflow" and t["palette"]["accent"] == "#2de2ff"
    assert {f["path"] for f in t["files"]} == {"theme.json", "theme.css", "layers.html", "assets/bg.webp", "assets/glow.png",
                                                "assets/fonts/orbitron.woff2", "assets/categories/pc.webp"}
    assert all(len(f["sha256"]) == 64 for f in t["files"])
    assert themes.file_path("portal-nexus", "assets/bg.webp").read_bytes() == b"RIFF....WEBP"
    # tylko pliki z indeksu — żadnej innej ścieżki serwera
    assert themes.file_path("portal-nexus", ".theme-info.json") is None
    assert themes.file_path("portal-nexus", "../index.json") is None
    assert themes.file_path("../x", "theme.css") is None


def test_new_version_replaces_and_remove(root):
    themes.install(pack(good()))
    m2 = {**META, "version": "1.1"}
    themes.install(pack(good(**{"theme.json": json.dumps(m2), "layers.html": None})))
    t = themes.index()["themes"][0]
    assert t["version"] == "1.1" and "layers.html" not in {f["path"] for f in t["files"]}
    assert themes.remove("portal-nexus") == {"ok": True}
    assert themes.index()["themes"] == []
    assert not themes.remove("portal-nexus")["ok"]


def test_zip_with_its_folder(root):
    assert themes.install(pack(good(), prefix="portal-nexus/"))["ok"]


@pytest.mark.parametrize("files, why", [
    ({"../evil.css": "x"}, "ścieżka"),
    ({"assets/run.exe": b"MZ"}, "typ pliku"),
    ({"notes.txt": "x"}, "spoza dozwolonych"),
    ({"theme.css": "@import url(https://evil/x.css);"}, "@import"),
    ({"theme.css": ".a{background:url(https://evil/x.png)}"}, "url("),
    ({"theme.css": ".a{background:url(assets/missing.png)}"}, "url("),
    ({"theme.css": ".a{width:expression(alert(1))}"}, "expression"),
    ({"layers.html": "<script>alert(1)</script>"}, "<script>"),
    ({"layers.html": '<div onclick="x()"></div>'}, "onclick"),
    ({"layers.html": '<div style="background:url(http://x)"></div>'}, "style"),
    ({"layers.html": '<img src="https://evil/x.png">'}, "src="),
    ({"layers.html": '<a href="x">x</a>'}, "<a>"),
    ({"layers.html": "<iframe src='x'></iframe>"}, "<iframe>"),
    ({"assets/x.svg": b'<svg><script>alert(1)</script></svg>'}, "SVG"),
    ({"assets/y.svg": b'<svg><image href="https://evil/x.png"/></svg>'}, "SVG"),
    ({"assets/z.svg": b'<svg onload="x()"></svg>'}, "SVG"),
])
def test_rejected(root, files, why):
    with pytest.raises(themes.ThemeError, match=why if why != "url(" else r"url\("):
        themes.install(pack(good(**files)))
    assert not (root / "portal-nexus").exists()


@pytest.mark.parametrize("change, why", [
    ({"id": "sf"}, "wbudowany"),
    ({"id": "Zła Nazwa"}, "id"),
    ({"name": ""}, "name"),
    ({"palette": {**PAL, "dim": "#3a3a3a"}}, "kontrast"),
    ({"palette": {**PAL, "selText": "#2de2ff"}}, "kontrast"),
    ({"palette": {**PAL, "bg": "red"}}, "palette.bg"),
    ({"games": {"layout": "grid"}}, "games.layout"),
    ({"ambient": "fireworks"}, "ambient"),
    ({"fontFaces": [{"name": "x", "file": "assets/fonts/none.woff2"}]}, "fontFaces"),
    ({"categories": {"family:pc": "assets/categories/none.webp"}}, "categories"),
    ({"animations": ["turbo"]}, "animations"),
])
def test_rejected_meta(root, change, why):
    with pytest.raises(themes.ThemeError, match=why):
        themes.install(pack(good(**{"theme.json": json.dumps({**META, **change})})))


def test_not_a_zip_and_missing_files(root):
    with pytest.raises(themes.ThemeError, match="zip"):
        themes.install(b"not a zip")
    with pytest.raises(themes.ThemeError, match="theme.css"):
        themes.install(pack({"theme.json": json.dumps(META)}))


def test_contrast_matches_lumen_rule():
    assert themes.contrast("#ffffff", "#000000") == pytest.approx(21.0)
    assert themes.contrast("#767676", "#ffffff") == pytest.approx(4.54, abs=0.01)


def test_panel_upload_then_device_download_over_http(root, monkeypatch):
    """Panel (akcja theme_upload, base64) → serwer → urządzenie: indeks i plik przez /v1/themes (jak Lumen)."""
    import base64
    import http.client

    from emustart import remote, server, srvadmin
    if not hasattr(srvadmin, "theme_upload"):
        pytest.skip("panel serwera — tylko w EmuStart (kopia silnika w Lumenie go nie ma)")
    monkeypatch.setattr(remote, "authorized", lambda handler: (handler.headers.get("Authorization") or "") == "Bearer pc")
    r = srvadmin.theme_upload(None, {"data": base64.b64encode(pack(good())).decode()})
    assert r["ok"], r
    assert srvadmin.themes_list(None)["list"][0]["layout"] == "coverflow"
    assert srvadmin.theme_upload(None, {"data": "!!!"})["reason"].startswith("uszkodzony")
    host, port = server.start(0, bind="127.0.0.1").removeprefix("http://").split(":")

    def get(path, auth="Bearer pc"):
        c = http.client.HTTPConnection(host, int(port), timeout=10)
        c.request("GET", path, headers={"Authorization": auth})
        resp = c.getresponse()
        return resp.status, resp.getheader("Content-Type"), resp.read()

    st, _ct, body = get("/v1/themes")
    assert st == 200 and json.loads(body)["themes"][0]["id"] == "portal-nexus"
    st, ct, body = get("/v1/themes/portal-nexus/theme.css")
    assert st == 200 and ct.startswith("text/css") and body.decode() == CSS
    assert get("/v1/themes/portal-nexus/assets/fonts/orbitron.woff2")[1] == "font/woff2"
    assert get("/v1/themes/portal-nexus/../index.json")[0] == 404
    assert get("/v1/themes/portal-nexus/.theme-info.json")[0] == 404
    assert get("/v1/themes", auth="Bearer obcy")[0] == 401
    assert srvadmin.theme_delete(None, {"id": "portal-nexus"}) == {"ok": True}
    assert get("/v1/themes/portal-nexus/theme.css")[0] == 404


def _server_get(calls: list, tamper: dict | None = None):
    """get() silnika Lumena — wprost do funkcji serwera (indeks, pliki z indeksu); `tamper`: podmienione bajty."""
    def get(path):
        calls.append(path)
        if path == "/v1/themes":
            return 200, json.dumps(themes.index()).encode()
        import urllib.parse
        parts = urllib.parse.unquote(path).split("/")[3:]
        rel = "/".join(parts[1:])
        if tamper and rel in tamper:
            return 200, tamper[rel]
        f = themes.file_path(parts[0], rel)
        return (200, f.read_bytes()) if f else (404, b"")
    return get


def test_sync_downloads_only_changed_files_and_removes_deleted(root, tmp_path):
    themes.install(pack(good()))
    dest = tmp_path / "LumenData" / "themes"
    calls: list = []
    r = themes.sync(_server_get(calls), dest)
    assert r == {"ok": True, "themes": ["portal-nexus"], "changed": 1, "failed": {}}
    assert (dest / "portal-nexus" / "theme.css").read_text() == CSS
    assert themes.local_info(dest / "portal-nexus")["palette"]["accent"] == "#2de2ff"
    assert len(calls) == 1 + 7
    calls.clear()
    assert themes.sync(_server_get(calls), dest)["changed"] == 0 and calls == ["/v1/themes"]   # bez zmian — sam indeks
    # nowa wersja: zmieniony tylko CSS → pobrany tylko CSS (i theme.json z nową wersją)
    themes.install(pack(good(**{"theme.css": CSS + "\n.y{}", "theme.json": json.dumps({**META, "version": "1.1"})})))
    calls.clear()
    assert themes.sync(_server_get(calls), dest)["changed"] == 1
    assert sorted(c.rsplit("/", 1)[-1] for c in calls[1:]) == ["theme.css", "theme.json"]
    assert themes.local_info(dest / "portal-nexus")["version"] == "1.1"
    themes.remove("portal-nexus")
    assert themes.sync(_server_get([]), dest)["themes"] == []
    assert not (dest / "portal-nexus").exists()


def test_sync_rejects_tampered_file_and_keeps_old_version(root, tmp_path):
    themes.install(pack(good()))
    dest = tmp_path / "lumen-themes"           # nie folder serwera (tmp_path/themes)
    themes.sync(_server_get([]), dest)
    themes.install(pack(good(**{"theme.css": CSS + "\n.z{}", "theme.json": json.dumps({**META, "version": "2"})})))
    r = themes.sync(_server_get([], tamper={"theme.css": b"@import url(https://evil/x.css);"}), dest)
    assert "portal-nexus" in r["failed"] and r["themes"] == ["portal-nexus"]
    assert themes.local_info(dest / "portal-nexus")["version"] == "1.0"
    assert (dest / "portal-nexus" / "theme.css").read_text() == CSS


def test_sync_rechecks_package_like_server(root, tmp_path, monkeypatch):
    """Serwer z błędem (albo podmieniony) poda indeks z groźną paczką — silnik jej nie zapisze."""
    themes.install(pack(good()))
    bad = b"<script>alert(1)</script>"
    idx = themes.index()
    for f in idx["themes"][0]["files"]:
        if f["path"] == "layers.html":
            f["sha256"] = themes._sha(bad)
    monkeypatch.setattr(themes, "index", lambda: idx)
    r = themes.sync(_server_get([], tamper={"layers.html": bad}), tmp_path / "t")
    assert "<script>" in r["failed"]["portal-nexus"] and r["themes"] == []
