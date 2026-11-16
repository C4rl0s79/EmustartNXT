import { log } from './logger'

/** Praca procesu głównego dłuższa niż próg → `[perf] proces główny: …` w logu (dane do zawieszeń, etapy 9a / 9b). */
export const SLOW_MS = 200

export function timed<T>(what: string | (() => string), fn: () => T): T {
  const t = performance.now()
  try {
    return fn()
  } finally {
    const ms = Math.round(performance.now() - t)
    if (ms > SLOW_MS) log.info('perf', `proces główny: ${typeof what === 'function' ? what() : what} ${ms} ms`)
  }
}
