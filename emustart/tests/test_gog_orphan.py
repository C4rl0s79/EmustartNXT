"""Instalacja przerwana poza silnikiem (zamknięty Lumen, awaria): stan „installing” bez zadania."""

from emustart import goginstall as gi
from emustart import goglib

PID = "1207666943"


def test_orphaned_installing_is_shown_as_cancelled_and_resumable():
    gi.save_entry({"product_id": PID, "state": gi.ST_INSTALLING, "title": "Gra"})
    svc = goglib.GogService(lambda: {})
    # bez zadania „przerwij” nic by nie zrobił („Brak zadania tej gry”) — gra pokazana jako przerwana (przycisk „wznów”)
    assert svc.summary(gi.load_entry(PID), running=set())["state"] == gi.ST_CANCELLED
    assert gi.ST_INSTALLING in gi.RESUMABLE
    # zadanie w kolejce albo w toku — nadal „instalowanie”
    svc._queue.append({"pid": PID})
    assert svc.summary(gi.load_entry(PID), running=set())["state"] == gi.ST_INSTALLING
    svc._queue.clear()
    svc._job = {"pid": PID}
    assert svc.summary(gi.load_entry(PID), running=set())["state"] == gi.ST_INSTALLING
