// Czujnik zacięć interfejsu: zadania > 150 ms i spóźniona pętla zdarzeń → „[perf] …” w konsoli, a stamtąd do logu
// Lumena (main/index.ts, console-message). Z kontekstem: ekran, wybrana gra, obrazy jeszcze w drodze.
function context(): string {
  const screen = document.querySelector('.tv-screen')?.classList[1] ?? document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? '?'
  const sel = document.querySelector('.tv-flow__title h1, .tv-row.sel, .tv-info h1')?.textContent?.slice(0, 40) ?? ''
  const loading = Array.from(document.images).filter((i) => !i.complete).length
  return `ekran ${screen}${sel ? `, gra „${sel}”` : ''}, obrazów w drodze: ${loading}`
}

/** `scope` — przedrostek w logu („interfejs” — główne okno, „deck” — okno Decka). */
export function installPerfWatch(scope = 'interfejs'): void {
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.duration > 150) console.warn(`[perf] ${scope}: zadanie ${Math.round(e.duration)} ms (${context()})`)
    }).observe({ type: 'longtask', buffered: false })
  } catch {
    /* brak longtask — zostaje pomiar pętli */
  }
  let last = performance.now()
  // czas, gdy strona była ukryta (okno schowane przy włączonym Decku — Chromium budzi wtedy liczniki raz na minutę), to
  // nie zacięcie: pomiar zaczyna się od nowa po pokazaniu (wcześniej fałszywe „pętla spóźniona ~59 s”)
  document.addEventListener('visibilitychange', () => {
    last = performance.now()
  })
  setInterval(() => {
    const now = performance.now()
    const lag = now - last - 100
    last = now
    if (lag > 250 && !document.hidden) console.warn(`[perf] ${scope}: pętla spóźniona ${Math.round(lag)} ms (${context()})`)
  }, 100)
}
