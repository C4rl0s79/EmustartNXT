// Okno „na pulpicie”: nad tapetą i ikonami pulpitu, pod zwykłymi oknami aplikacji, poza Alt+Tab,
// bez zabierania focusu. Port PyLinksDeck/deck/winshell.py (tryb `desktop`) do TypeScript przez koffi.
//
// Rzecz nieoczywista (z winshell.py): dno kolejności Z (HWND_BOTTOM) leży POD warstwą pulpitu — okno
// tam wysłane system uważa za widoczne, a użytkownik go nie widzi. Dlatego okno wstawiamy tuż NAD
// najwyższym oknem warstwy pulpitu (Progman albo WorkerW z tapetą), a strażnik co kilka sekund sprawdza,
// czy Explorer nie podniósł pulpitu nad nas (kliknięcie w tapetę, „Pokaż pulpit”).
//
// Część czysta (decyzje na liście okien) jest oddzielona od wywołań WinAPI, żeby dało się ją testować.
//
// Sprawdzone w próbie (etap 0, 2026-11-10, Windows 11 26340, Electron 44.9.0): okna Electrona z
// `focusable: false` + makeUnobtrusive dostają WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, leżą tuż nad pulpitem,
// pod zwykłymi oknami, bez focusu, poza Alt+Tab; najechanie, kółko, Ctrl+kółko, klik, dwuklik i menu
// kontekstowe (Menu.popup) działają. Strażnik naprawdę jest potrzebny — Explorer podnosił pulpit nad okno
// (Win+D / klik w tapetę), a TaskbarCreated przychodzi po restarcie Explorera. Na tym systemie Progman jest
// zawsze ostatni w kolejności Z: HWND_BOTTOM zostawia okno NAD nim (pułapka z winshell.py nie występuje,
// kod zostaje bezpieczny w obu przypadkach).

/** Okno najwyższego poziomu w kolejności Z (lista: od góry do dołu). */
export interface WinInfo {
  hwnd: bigint
  cls: string
  visible: boolean
}

export const DESKTOP_CLASSES: ReadonlySet<string> = new Set(['Progman', 'WorkerW'])

const isLayer = (w: WinInfo): boolean => w.visible && DESKTOP_CLASSES.has(w.cls)

/**
 * Najwyższe w kolejności Z widoczne okno warstwy pulpitu. Tapetę rysuje raz Progman, raz osobne WorkerW
 * (zależnie od przejść tła), więc liczy się to, które leży wyżej. Zapas: Progman w ogóle (jak FindWindow).
 */
export function desktopLayer(order: readonly WinInfo[]): bigint | undefined {
  return (order.find(isLayer) ?? order.find((w) => w.cls === 'Progman'))?.hwnd
}

/**
 * Czy warstwa pulpitu leży NAD oknem `own` (czyli je zasłania) — pierwsze napotkane schodząc w dół.
 * Jak winshell.is_below_desktop: okna nie ma na liście, a pulpit jest → true (strażnik wstawi je ponownie).
 */
export function isBelowDesktop(order: readonly WinInfo[], own: bigint): boolean {
  for (const w of order) {
    if (w.hwnd === own) return false
    if (isLayer(w)) return true
  }
  return false
}

export type PinPlan =
  /** okno już leży tuż nad pulpitem */
  | { kind: 'ok' }
  /** SetWindowPos(own, after): `own` trafia tuż pod `after`, czyli tuż nad pulpit */
  | { kind: 'insertAfter'; after: bigint }
  /** nad pulpitem nie ma żadnego okna: na wierzch (HWND_TOP) */
  | { kind: 'top' }
  /** nie znaleziono warstwy pulpitu */
  | { kind: 'none' }

/** Gdzie wstawić okno, żeby leżało tuż nad warstwą pulpitu (winshell.pin_above_desktop). */
export function pinPlan(order: readonly WinInfo[], own: bigint): PinPlan {
  const layer = desktopLayer(order)
  if (layer === undefined) return { kind: 'none' }
  const i = order.findIndex((w) => w.hwnd === layer)
  const above = i > 0 ? order[i - 1] : undefined
  if (!above) return { kind: 'top' }
  if (above.hwnd === own) return { kind: 'ok' }
  return { kind: 'insertAfter', after: above.hwnd }
}

// ---------------- WinAPI (koffi) ----------------

const GWL_EXSTYLE = -20
export const WS_EX_TOOLWINDOW = 0x00000080
export const WS_EX_APPWINDOW = 0x00040000
export const WS_EX_NOACTIVATE = 0x08000000
const GW_HWNDNEXT = 2
const HWND_TOP = 0n
export const HWND_BOTTOM = 1n
const HWND_NOTOPMOST = -2n
const SWP_NOSIZE = 0x0001
const SWP_NOMOVE = 0x0002
const SWP_NOACTIVATE = 0x0010
const MAX_WINDOWS = 20_000

interface User32 {
  getTopWindow: (h: bigint) => number | bigint
  getWindow: (h: bigint, cmd: number) => number | bigint
  getClassName: (h: bigint, buf: Buffer, len: number) => number
  isVisible: (h: bigint) => number
  setWindowPos: (h: bigint, after: bigint, x: number, y: number, cx: number, cy: number, flags: number) => number
  getLong: (h: bigint, idx: number) => number | bigint
  setLong: (h: bigint, idx: number, v: bigint) => number | bigint
  registerMessage: (name: string) => number
}

let user32: User32 | null | undefined

function api(): User32 {
  if (user32) return user32
  if (user32 === null) throw new Error('WinAPI niedostępne')
  if (process.platform !== 'win32') {
    user32 = null
    throw new Error('warstwa pulpitu działa tylko w Windows')
  }
  try {
    user32 = bind()
  } catch (e) {
    user32 = null // load once: a failed bind is not retried on every call
    throw new Error(`WinAPI niedostępne: ${(e as Error).message}`)
  }
  return user32
}

function bind(): User32 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const u = koffi.load('user32.dll')
  return {
    getTopWindow: u.func('__stdcall', 'GetTopWindow', 'intptr', ['intptr']),
    getWindow: u.func('__stdcall', 'GetWindow', 'intptr', ['intptr', 'uint32']),
    // nazwa klasy do zwykłego bufora (drugi argument koffi.pointer to głębokość, nie długość)
    getClassName: u.func('__stdcall', 'GetClassNameW', 'int32', ['intptr', 'void *', 'int32']),
    isVisible: u.func('__stdcall', 'IsWindowVisible', 'int32', ['intptr']),
    setWindowPos: u.func('__stdcall', 'SetWindowPos', 'int32', ['intptr', 'intptr', 'int32', 'int32', 'int32', 'int32', 'uint32']),
    getLong: u.func('__stdcall', 'GetWindowLongPtrW', 'intptr', ['intptr', 'int32']),
    setLong: u.func('__stdcall', 'SetWindowLongPtrW', 'intptr', ['intptr', 'int32', 'intptr']),
    registerMessage: u.func('__stdcall', 'RegisterWindowMessageW', 'uint32', ['str16'])
  }
}

function className(u: User32, h: bigint): string {
  const buf = Buffer.alloc(512)
  const n = u.getClassName(h, buf, 256)
  return buf.toString('utf16le', 0, Math.max(0, n) * 2)
}

/** Okna najwyższego poziomu od góry do dołu kolejności Z. */
export function zOrder(): WinInfo[] {
  const u = api()
  const out: WinInfo[] = []
  let h = BigInt(u.getTopWindow(0n))
  while (h !== 0n && out.length < MAX_WINDOWS) {
    out.push({ hwnd: h, cls: className(u, h), visible: !!u.isVisible(h) })
    h = BigInt(u.getWindow(h, GW_HWNDNEXT))
  }
  return out
}

/**
 * Uchwyt okna Electrona jako liczba (getNativeWindowHandle: bufor 8 bajtów w 64-bit) — ze znakiem, tak jak
 * koffi zwraca HWND jako 'intptr' z GetWindow: uchwyt z ustawionym bitem 31 bywa rozszerzony znakiem, a bez
 * zgodnych znaków zOrder() nie odnalazłby własnego okna.
 */
export function handleOf(buf: Buffer): bigint {
  return buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0))
}

export function exStyle(hwnd: bigint): number {
  return Number(BigInt.asUintN(32, BigInt(api().getLong(hwnd, GWL_EXSTYLE))))
}

/** Bez focusu przy kliknięciu, bez Alt+Tab, bez przycisku na pasku zadań. */
export function makeUnobtrusive(hwnd: bigint): void {
  const ex = (exStyle(hwnd) | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
  api().setLong(hwnd, GWL_EXSTYLE, BigInt(ex >>> 0))
}

function setPos(hwnd: bigint, after: bigint): boolean {
  return !!api().setWindowPos(hwnd, after, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
}

/** Wstawia okno tuż nad warstwę pulpitu. Zwraca plan, który wykonano. */
export function pinAboveDesktop(hwnd: bigint): PinPlan {
  setPos(hwnd, HWND_NOTOPMOST) // tryb „zawsze na wierzchu” zdjęty (jak winshell.set_topmost(False))
  const plan = pinPlan(zOrder(), hwnd)
  if (plan.kind === 'insertAfter') setPos(hwnd, plan.after)
  if (plan.kind === 'top') setPos(hwnd, HWND_TOP)
  return plan
}

/** Tylko do diagnostyki i autotestu: dno kolejności Z (pod pulpitem — okno znika z oczu). */
export function sendToBottom(hwnd: bigint): boolean {
  return setPos(hwnd, HWND_BOTTOM)
}

export function isBelowDesktopNow(hwnd: bigint): boolean {
  return isBelowDesktop(zOrder(), hwnd)
}

/** Komunikat rozgłaszany przez powłokę po (ponownym) starcie Explorera. */
export function taskbarCreatedMessage(): number {
  return api().registerMessage('TaskbarCreated')
}

/**
 * Strażnik warstwy: co `intervalMs` sprawdza, czy pulpit nie leży nad którymś z okien, i wstawia je
 * z powrotem (deck_app._guard_layer). `windows()` zwraca uchwyty widocznych okien.
 */
export class DesktopLayerGuard {
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly windows: () => bigint[],
    private readonly onRepin: (hwnd: bigint) => void = () => {},
    private readonly intervalMs = 3000,
    private readonly onError: (e: Error) => void = () => {}
  ) {}

  /** Jedno sprawdzenie; zwraca liczbę okien wstawionych ponownie. */
  check(): number {
    const own = this.windows()
    if (!own.length) return 0
    const order = zOrder()
    let n = 0
    for (const h of own) {
      if (!isBelowDesktop(order, h)) continue
      pinAboveDesktop(h)
      this.onRepin(h)
      n++
    }
    return n
  }

  start(): void {
    this.stop()
    let reported = false
    this.timer = setInterval(() => {
      try {
        this.check()
        reported = false
      } catch (e) {
        // a WinAPI failure must not throw from a timer in the main process every 3 s — reported once
        if (!reported) this.onError(e as Error)
        reported = true
      }
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
