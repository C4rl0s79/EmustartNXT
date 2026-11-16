"""MT-32 / SC-55 dla gier DOSBox (emustart/dosmidi.py, etap 11): lista MT-32, tryb gracza, port po nazwie, -conf."""

from __future__ import annotations

from pathlib import Path

from emustart import dosmidi as M

NAMES = ["Microsoft GS Wavetable Synth", "SC55", "MT32", "MT-32 Synth Emulator"]


def test_titles_from_the_mt32_list_with_gog_suffixes():
    assert M.find("Eye of the Beholder III: Assault on Myth Drannor")[0].startswith("Eye of the Beholder III")
    assert M.find("Wing Commander™ III: Heart of the Tiger 30th Anniversary Edition")[0] == "Wing Commander III: Heart of the Tiger"
    assert M.find("Cyberpunk 2077") is None and M.find("Doom") is None


def test_auto_picks_mt32_for_listed_games_and_leaves_others():
    d = M.decide("Eye of the Beholder III: Assault on Myth Drannor", "auto", {}, NAMES)
    assert d["device"] == "mt32" and d["port"] == "MT32" and d["index"] == 2
    d = M.decide("Wing Commander III: Heart of the Tiger", "auto", {}, NAMES)
    assert d["device"] == "mt32" and "SC-55" in d["reason"]                 # muzyka pod SC-55, priorytet MT-32
    d = M.decide("Some Unknown Game", "auto", {}, NAMES)
    assert d["device"] is None and d["index"] is None


def test_player_choice_and_default():
    assert M.decide("Some Unknown Game", "sc55", {}, NAMES)["index"] == 1
    assert M.decide("Eye of the Beholder III: Assault on Myth Drannor", "default", {}, NAMES)["index"] is None


def test_port_by_name_survives_renumbering_and_missing_port():
    cfg = {"midi_mt32_port": "MT32"}
    assert M.decide("Betrayal at Krondor", "auto", cfg, ["MT32", "SC55"])["index"] == 0
    d = M.decide("Betrayal at Krondor", "auto", cfg, ["SC55"])
    assert d["index"] is None and "nie jest podłączony" in d["reason"]


def test_guess_prefers_hardware_over_emulator():
    assert M.guess_port("mt32", ["MT-32 Synth Emulator", "UM-ONE MT32"]) == "UM-ONE MT32"
    assert M.guess_port("mt32", ["MT-32 Synth Emulator"]) == "MT-32 Synth Emulator"
    assert M.guess_port("sc55", ["SC-55"]) == "SC-55"
    assert M.port_settings({"midi_sc55_port": "Microsoft GS Wavetable Synth"}, NAMES)["sc55"] == "Microsoft GS Wavetable Synth"


def test_apply_adds_a_relative_conf_and_leaves_game_files(tmp_path):
    app = tmp_path / "g"
    (app / "DOSBOX").mkdir(parents=True)
    spec = {"exe": str(app / "DOSBOX" / "dosbox.exe"), "args": r'-conf "..\a.conf" -noconsole', "cwd": str(app / "DOSBOX")}
    out = M.apply(spec, app, {"index": 2})
    assert out["args"].startswith(spec["args"])
    assert out["args"].endswith((r'-conf "..\.emustart-midi\midi.conf"', '-conf "../.emustart-midi/midi.conf"'))
    conf = (app / M.MIDI_DIR / "midi.conf").read_text(encoding="latin-1")
    assert "mididevice=win32" in conf and "midiconfig=2" in conf
    assert M.apply(spec, app, {"index": None}) is spec


def test_games_that_falsely_claim_mt32():
    """vogonswiki „Games that falsely claim MT-32 compatibility”: GM → SC-55, reszta bez zmian (z powodem)."""
    assert M.auto("Albion")[0] == "sc55"                                    # wysyła General MIDI
    assert M.auto("Theme Hospital")[0] is None                              # brak sterownika MT-32
    assert M.auto("Gabriel Knight 2: The Beast Within")[0] is None          # muzyka cyfrowa (nazwa z „aka”)
    d = M.decide("The Adventures of Nikko", "auto", {}, NAMES)
    assert d["device"] is None and "nie działa" in d["reason"] and d["note"]
    assert M.decide("The Adventures of Nikko", "mt32", {}, NAMES)["index"] == 2   # gracz może wymusić


def test_database_covers_both_sections():
    from emustart import midigames
    assert len(midigames.GAMES) > 700 and len(midigames.FALSE) >= 300
    assert {r[2] for r in midigames.FALSE} <= {"gm", "digital", "broken", "fm", "other"}


def test_gog_titles_and_sequels_review():
    """code review etapu 11: sequel nie łapie pierwszej części, nazwy GOG (cyfry arabskie, pakiety) trafiają"""
    assert M.find("Wing Commander 2")[0].startswith("Wing Commander II")
    assert M.find("Ultima™ 7: The Complete Edition")[0].startswith("Ultima VII")
    assert M.find("King's Quest 4+5+6")[0].startswith("King's Quest IV")
    assert M.find("Dune 2: The Building of a Dynasty")[0] == "Dune II: The Building of a Dynasty"
    assert M.find("Doom") is None


def test_unwritable_game_folder_starts_without_midi(tmp_path, monkeypatch):
    app = tmp_path / "g"
    (app / "DOSBOX").mkdir(parents=True)
    spec = {"exe": "dosbox.exe", "args": "", "cwd": str(app / "DOSBOX")}

    def deny(*a, **k):
        raise PermissionError("tylko do odczytu")
    monkeypatch.setattr(Path, "mkdir", deny)
    assert M.apply(spec, app, {"index": 1}) is spec


def test_port_can_be_switched_off():
    assert M.port_settings({"midi_sc55_port": M.NONE}, NAMES)["sc55"] == ""
    assert M.decide("Albion", "auto", {"midi_sc55_port": M.NONE}, NAMES)["index"] is None
