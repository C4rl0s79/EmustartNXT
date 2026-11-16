import { app, webContents, type WebContents } from 'electron'
import { log } from './logger'

/**
 * Dane o zawieszeniach okien Lumena (etap 9a, zgłoszenie 2026-11-16: Deck zawiesza się na minuty, a log nie miał o
 * nim nic): „nie odpowiada / znów odpowiada” z czasem trwania, komunikaty czujnika zacięć strony (lib/perf.ts) do
 * logu, awarie procesów Electrona (GPU, narzędzia), a co 10 minut pamięć procesów — żeby po następnym zawieszeniu
 * było widać, co działo się przed nim.
 */
const METRICS_EVERY = 10 * 60_000

/** Okno (Deck, główne) pod obserwacją: `name` w logu. */
export function watchWindow(wc: WebContents, name: string): void {
  let since = 0
  wc.on('unresponsive', () => {
    if (since) return // to samo zawieszenie zgłoszone ponownie — czas od pierwszego zgłoszenia
    since = Date.now()
    log.warn('hang', `${name}: nie odpowiada`)
  })
  wc.on('responsive', () => {
    if (!since) return
    const s = Math.round((Date.now() - since) / 1000)
    since = 0
    log.warn('hang', `${name}: znów odpowiada po ${s} s`)
  })
  wc.on('console-message', (e: unknown, ...rest: unknown[]) => {
    const msg = String((e as { message?: string }).message ?? rest[1] ?? '')
    if (msg.startsWith('[perf] ')) log.info('perf', `${name}: ${msg.slice(7)}`)
  })
}

let started = false

/** Awarie procesów i pamięć — raz na proces główny. */
export function watchProcesses(): void {
  if (started) return
  started = true
  app.on('child-process-gone', (_e, d) => {
    log.error('hang', `proces ${d.type}${d.name ? ` (${d.name})` : ''} zakończony: ${d.reason}, kod ${d.exitCode}`)
  })
  const t = setInterval(() => log.info('hang', memoryLine()), METRICS_EVERY)
  t.unref?.()
}

/** „pamięć: Deck 312 MB, okno 540 MB, GPU 820 MB, …” — working set procesów Electrona. */
export function memoryLine(): string {
  const names = new Map<number, string>()
  for (const wc of webContents.getAllWebContents()) {
    try {
      const pid = wc.getOSProcessId()
      if (pid) names.set(pid, /[\\/]deck\.html(?:[?#]|$)/i.test(wc.getURL()) ? 'Deck' : names.get(pid) ?? 'okno')
    } catch {
      /* zniszczone w międzyczasie */
    }
  }
  const parts = app.getAppMetrics().map((m) => {
    const who = m.type === 'Tab' ? (names.get(m.pid) ?? 'strona') : m.type === 'Browser' ? 'główny' : m.type
    return `${who} ${Math.round((m.memory.workingSetSize ?? 0) / 1024)} MB`
  })
  return `pamięć: ${parts.join(', ')}`
}
