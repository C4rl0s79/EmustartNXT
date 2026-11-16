import type { ServerActivity } from '@shared/types'
import { useStore } from '../store'

// Wymiana „systemowa” z serwerem EmuStart w toku (prośba 2026-11-16): po jednym małym pasku z opisem na wymianę,
// jeden pod drugim — pod „EmuStart” na górnym pasku i pod paskiem pobierania w trybie TV. Pobieranie gier — osobno
// (Jobs.tsx). Bez `total` pasek przesuwa się bez procentu (wiadomo tylko, że trwa).

export function activityPct(a: ServerActivity): number | null {
  return a.total ? Math.max(0, Math.min(100, Math.floor(((a.done ?? 0) / a.total) * 100))) : null
}

function Row({ a }: { a: ServerActivity }) {
  const pct = activityPct(a)
  return (
    <div className="activity" role="status">
      <div className="activity__text">
        <b>{a.label}</b>
        {a.detail ? ` — ${a.detail}` : ''}
        {pct !== null ? ` · ${pct}%` : ''}
      </div>
      <div className={`activity__bar ${pct === null ? 'is-busy' : ''}`}>
        <i style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** lista pasków; `className` — miejsce (górny pasek, tryb TV) */
export function ActivityList({ className }: { className: string }) {
  const list = useStore((s) => s.activity)
  if (!list.length) return null
  return (
    <div className={`activity-list ${className}`}>
      {list.map((a) => (
        <Row key={a.id} a={a} />
      ))}
    </div>
  )
}
