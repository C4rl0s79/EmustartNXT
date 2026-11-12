"""unelevated — program gracza (emulator, gra GOG) bez uprawnień administratora, także gdy silnik je ma.

Lumen może działać „jako administrator” (jedno okno UAC przy starcie — kroki instalacji gier nie pytają już o zgodę).
Silnik jest jego procesem potomnym, więc też ma uprawnienia — a gry i emulatory nie powinny: Steam, nakładki,
wirtualizacja zapisów starych gier i bezpieczeństwo. `popen` w procesie z uprawnieniami uruchamia program z tokenem
powłoki zalogowanego użytkownika (okno pulpitu — explorer.exe): GetShellWindow → OpenProcessToken → DuplicateTokenEx →
CreateProcessWithTokenW. Bez uprawnień (klient EmuStart, Lumen z kodu źródłowego) — zwykły subprocess.Popen.

Zwracany obiekt ma metody Popen używane przez launchery: pid, returncode, poll(), wait(), terminate(), kill().
"""

from __future__ import annotations

import ctypes
import logging
import os
import subprocess

log = logging.getLogger("emustart.unelevated")

CREATE_UNICODE_ENVIRONMENT = 0x400
INFINITE = 0xFFFFFFFF


class Proc:
    """Proces uruchomiony przez CreateProcessWithTokenW — interfejs jak subprocess.Popen."""

    def __init__(self, handle, pid: int):
        self._h = handle
        self.pid = pid
        self.returncode: int | None = None

    def _code(self) -> int:
        """Kod wyjścia — wołane tylko po zakończeniu procesu (uchwyt zasygnalizowany): 259 to wtedy zwykły kod
        wyjścia gry, nie STILL_ACTIVE (jak subprocess.Popen)."""
        from ctypes import wintypes
        code = wintypes.DWORD()
        ctypes.windll.kernel32.GetExitCodeProcess(self._h, ctypes.byref(code))
        return int(code.value)

    def poll(self) -> int | None:
        if self.returncode is None and ctypes.windll.kernel32.WaitForSingleObject(self._h, 0) == 0:
            self.returncode = self._code()
        return self.returncode

    def wait(self, timeout: float | None = None) -> int | None:
        if self.returncode is None:
            ms = INFINITE if timeout is None else int(timeout * 1000)
            if ctypes.windll.kernel32.WaitForSingleObject(self._h, ms) != 0:
                raise subprocess.TimeoutExpired("unelevated", timeout or 0)
            self.returncode = self._code()
        return self.returncode

    def terminate(self) -> None:
        if self.poll() is None:
            ctypes.windll.kernel32.TerminateProcess(self._h, 1)

    kill = terminate

    def __del__(self):
        try:
            ctypes.windll.kernel32.CloseHandle(self._h)
        except Exception:                               # noqa: BLE001 — zamykanie przy końcu interpretera
            pass


def _env_block(env: dict) -> ctypes.Array:
    text = "".join(f"{k}={v}\0" for k, v in sorted(env.items(), key=lambda kv: kv[0].upper())) + "\0"
    return ctypes.create_unicode_buffer(text, len(text))


def _shell_token():
    """Kopia tokenu procesu powłoki (pulpit zalogowanego użytkownika) do uruchomienia programu; None — brak powłoki."""
    from ctypes import wintypes
    u32, k32, adv = ctypes.windll.user32, ctypes.windll.kernel32, ctypes.windll.advapi32
    k32.OpenProcess.restype = wintypes.HANDLE
    hwnd = u32.GetShellWindow()
    if not hwnd:
        return None
    pid = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    hproc = k32.OpenProcess(0x1000, False, pid.value)                    # PROCESS_QUERY_LIMITED_INFORMATION
    if not hproc:
        return None
    tok, dup = wintypes.HANDLE(), wintypes.HANDLE()
    try:
        if not adv.OpenProcessToken(hproc, 0x0002, ctypes.byref(tok)):  # TOKEN_DUPLICATE
            return None
        # TOKEN_ASSIGN_PRIMARY | DUPLICATE | QUERY | ADJUST_DEFAULT | ADJUST_SESSIONID; impersonation, primary
        if not adv.DuplicateTokenEx(tok, 0x018B, None, 2, 1, ctypes.byref(dup)):
            return None
        return dup
    finally:
        if tok:
            k32.CloseHandle(tok)
        k32.CloseHandle(hproc)


def _with_shell_token(cmdline: str, cwd: str | None, env: dict | None, flags: int) -> Proc:
    from ctypes import wintypes

    class STARTUPINFO(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("lpReserved", wintypes.LPWSTR), ("lpDesktop", wintypes.LPWSTR),
                    ("lpTitle", wintypes.LPWSTR), ("dwX", wintypes.DWORD), ("dwY", wintypes.DWORD),
                    ("dwXSize", wintypes.DWORD), ("dwYSize", wintypes.DWORD), ("dwXCountChars", wintypes.DWORD),
                    ("dwYCountChars", wintypes.DWORD), ("dwFillAttribute", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                    ("wShowWindow", wintypes.WORD), ("cbReserved2", wintypes.WORD), ("lpReserved2", ctypes.c_void_p),
                    ("hStdInput", wintypes.HANDLE), ("hStdOutput", wintypes.HANDLE), ("hStdError", wintypes.HANDLE)]

    class PROCESS_INFORMATION(ctypes.Structure):
        _fields_ = [("hProcess", wintypes.HANDLE), ("hThread", wintypes.HANDLE),
                    ("dwProcessId", wintypes.DWORD), ("dwThreadId", wintypes.DWORD)]

    tok = _shell_token()
    if not tok:
        raise OSError("brak procesu powłoki Windows (explorer.exe) — nie da się uruchomić bez uprawnień administratora")
    k32, adv = ctypes.windll.kernel32, ctypes.windll.advapi32
    try:
        si, pi = STARTUPINFO(cb=ctypes.sizeof(STARTUPINFO)), PROCESS_INFORMATION()
        buf = ctypes.create_unicode_buffer(cmdline)                   # CreateProcess* może zmienić bufor
        block = _env_block(env) if env is not None else None
        ok = adv.CreateProcessWithTokenW(tok, 0, None, buf, flags | CREATE_UNICODE_ENVIRONMENT, block, cwd,
                                         ctypes.byref(si), ctypes.byref(pi))
        if not ok:
            raise ctypes.WinError()
        k32.CloseHandle(pi.hThread)
        return Proc(pi.hProcess, int(pi.dwProcessId))
    finally:
        k32.CloseHandle(tok)


def popen(cmd, cwd=None, env=None, creationflags: int = 0, close_fds: bool = True):
    """Jak subprocess.Popen(cmd, cwd, env, creationflags); w procesie z uprawnieniami administratora — bez nich.
    Gdy uruchomienie z tokenem powłoki się nie uda, program startuje zwykle (z uprawnieniami) i trafia to do logu —
    gra działa, zamiast nie wystartować wcale."""
    from emustart import gogadmin
    if os.name == "nt" and gogadmin.is_elevated():
        line = cmd if isinstance(cmd, str) else subprocess.list2cmdline([str(c) for c in cmd])
        try:
            p = WITH_SHELL_TOKEN(line, str(cwd) if cwd else None, env, creationflags)
            log.info("bez uprawnień administratora: %s", line[:200])
            return p
        except OSError as ex:
            log.warning("nie uruchomiono bez uprawnień administratora (%s) — zwykłe uruchomienie: %s", ex, line[:200])
    return subprocess.Popen(cmd, cwd=cwd, env=env, creationflags=creationflags, close_fds=close_fds)


WITH_SHELL_TOKEN = _with_shell_token
