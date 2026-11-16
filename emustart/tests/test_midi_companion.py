"""Program grający port MIDI przed startem DOSBoxa (zgłoszenie 2026-11-16: port loopMIDI „MT32” grał tylko przy ręcznie
uruchomionym Munt mt32emu-qt; bez niego Eye of the Beholder III było ciche)."""

from __future__ import annotations

from emustart import dosmidi, unelevated

D = {"device": "mt32", "index": 2, "port": "MT32"}


def test_companion_from_config_and_munt(tmp_path, monkeypatch):
    exe = tmp_path / "synth.exe"
    exe.write_bytes(b"")
    monkeypatch.setattr(dosmidi, "_munt", lambda: r"C:\Program Files\Munt\mt32emu-qt.exe")
    assert dosmidi.companion("mt32", {}) == r"C:\Program Files\Munt\mt32emu-qt.exe"    # MT-32 — Munt sam
    assert dosmidi.companion("mt32", {"midi_mt32_app": "-"}) == ""                     # „-” — nic
    assert dosmidi.companion("sc55", {}) == ""                                          # SC-55 tylko z ustawienia
    assert dosmidi.companion("sc55", {"midi_sc55_app": str(exe)}) == str(exe)
    assert dosmidi.companion("sc55", {"midi_sc55_app": str(tmp_path / "brak.exe")}) == ""
    assert dosmidi.companion(None, {}) == ""


def test_started_minimized_once(monkeypatch):
    started = []
    monkeypatch.setattr(dosmidi, "_munt", lambda: r"C:\Munt\mt32emu-qt.exe")
    monkeypatch.setattr(unelevated, "popen", lambda cmd, cwd=None, show=None, **k: started.append((cmd, show)))
    monkeypatch.setattr(dosmidi, "_running", lambda exe: False)
    assert "uruchomiono" in dosmidi.ensure_companion(D, {}, wait=0)
    assert started == [([r"C:\Munt\mt32emu-qt.exe"], unelevated.SW_SHOWMINNOACTIVE)]
    monkeypatch.setattr(dosmidi, "_running", lambda exe: True)
    assert dosmidi.ensure_companion(D, {}, wait=0) == ""                                # już działa — bez drugiej kopii
    assert dosmidi.ensure_companion({**D, "index": None}, {}, wait=0) == ""            # DOSBox bez zmiany MIDI
    assert len(started) == 1


def test_warmup_starts_only_chosen_ports_without_waiting(tmp_path, monkeypatch):
    """Przy starcie Lumena: odtwarzacze portów, które są wybrane (odtwarzacz SC-55 długo się uruchamia)."""
    sc = tmp_path / "88emuPlayer.exe"
    sc.write_bytes(b"")
    started = []
    monkeypatch.setattr(dosmidi, "_munt", lambda: r"C:\Munt\mt32emu-qt.exe")
    monkeypatch.setattr(dosmidi, "_running", lambda exe: False)
    monkeypatch.setattr(unelevated, "popen", lambda cmd, cwd=None, show=None, **k: started.append(cmd[0]))
    names = ["Microsoft GS Wavetable Synth", "SC55", "MT32"]
    cfg = {"midi_mt32_port": "MT32", "midi_sc55_port": "SC55", "midi_sc55_app": str(sc)}
    assert len(dosmidi.warmup(cfg, names)) == 2 and started == [r"C:\Munt\mt32emu-qt.exe", str(sc)]
    started.clear()
    assert dosmidi.warmup({**cfg, "midi_sc55_port": "-"}, names) and started == [r"C:\Munt\mt32emu-qt.exe"]
    assert dosmidi.apps(cfg)["sc55"] == str(sc) and dosmidi.apps(cfg)["mt32_set"] == ""
