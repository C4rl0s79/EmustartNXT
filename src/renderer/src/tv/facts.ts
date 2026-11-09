import { useEffect, useMemo, useState } from 'react'
import type { Game, GameFacts } from '@shared/types'
import { api } from '../store'

// Genre, developer, year and players of the PC games on a list, for the filters (filters.ts). Only while they are
// needed: Steam games not looked up yet are fetched by the main process in the background — asked again until done.

export function useFacts(games: Game[], wanted: boolean): { games: Game[]; missing: number } {
  const [facts, setFacts] = useState<Record<string, GameFacts>>({})
  const [missing, setMissing] = useState(0)
  useEffect(() => {
    const ids = games.filter((g) => !g.emu).map((g) => g.id)
    if (!wanted || !ids.length) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = (): void => {
      void api()
        .library.facts(ids)
        .then((r) => {
          if (!alive) return
          setFacts(r.facts)
          setMissing(r.missing)
          if (r.missing) timer = setTimeout(ask, 15_000)
        })
        .catch(() => undefined)
    }
    ask()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [wanted, games])
  const merged = useMemo(() => (Object.keys(facts).length ? games.map((g) => (facts[g.id] ? { ...g, facts: facts[g.id] } : g)) : games), [games, facts])
  return { games: merged, missing }
}
