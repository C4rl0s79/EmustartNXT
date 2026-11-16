"""memwatch — pamięć procesu serwera w logu (co godzinę).

Zgłoszenie: serwer prawie nieużywany zajmował po kilku dniach kilkanaście GB. Wpis co godzinę pokazuje, czy
pamięć rośnie sama (wyciek) czy skokami po konkretnych zdarzeniach (np. „Odśwież indeks” GOG) — bez profilera.
"""

from __future__ import annotations

import ctypes
import logging
import os
import sys
import threading
import time

log = logging.getLogger("emustart.memwatch")

FIRST_AFTER = 600           # s — pierwszy wpis po starcie (indeks GOG zwykle już działa)
EVERY = 3600                # s


class _Counters(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong),
                ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def usage() -> dict:
    """{"rss", "peak", "private"} w bajtach (0, gdy system nie podaje)."""
    if sys.platform == "win32":
        try:
            c = _Counters()
            c.cb = ctypes.sizeof(c)
            k32, psapi = ctypes.windll.kernel32, ctypes.windll.psapi
            k32.GetCurrentProcess.restype = ctypes.c_void_p
            if psapi.GetProcessMemoryInfo(ctypes.c_void_p(k32.GetCurrentProcess()), ctypes.byref(c), c.cb):
                return {"rss": c.WorkingSetSize, "peak": c.PeakWorkingSetSize, "private": c.PagefileUsage}
        except (OSError, AttributeError):
            pass
        return {"rss": 0, "peak": 0, "private": 0}
    try:                                       # Linux / macOS: bez pamięci prywatnej (0 = nie podano)
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak *= 1 if sys.platform == "darwin" else 1024          # macOS podaje bajty, Linux kilobajty
        rss = 0
        if os.path.exists(f"/proc/{os.getpid()}/statm"):
            with open(f"/proc/{os.getpid()}/statm") as f:
                rss = int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
        return {"rss": rss, "peak": peak, "private": 0}
    except (OSError, ValueError, ImportError):
        return {"rss": 0, "peak": 0, "private": 0}


def line() -> str:
    u = usage()
    mb = lambda v: f"{v / 2**20:.0f} MB"         # noqa: E731
    priv = f", prywatna {mb(u['private'])}" if u["private"] else ""
    return (f"pamięć procesu: {mb(u['rss'])} (szczyt {mb(u['peak'])}{priv}), "
            f"wątków: {threading.active_count()}")


def start() -> None:
    def loop():
        time.sleep(FIRST_AFTER)
        while True:
            try:
                log.info(line())
            except Exception:
                log.exception("pamięć procesu")
            time.sleep(EVERY)
    threading.Thread(target=loop, daemon=True, name="pamiec-procesu").start()
