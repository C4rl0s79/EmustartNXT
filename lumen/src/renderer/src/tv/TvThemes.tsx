import { useState } from 'react'
import { useActions } from '../nav/input'
import { THEMES } from './themes'

// Theme chooser of the TV layout (Menu → Motyw): moving through the list shows each theme at once
// on the whole screen behind the panel; A keeps it, B goes back to the one in use.

export function TvThemes({ current, onPreview, onDone }: { current: string; onPreview: (id: string) => void; onDone: (id: string | null) => void }) {
  const [idx, setIdx] = useState(() => Math.max(0, THEMES.findIndex((t) => t.id === current)))
  const pick = (i: number): void => {
    setIdx(i)
    onPreview(THEMES[i].id)
  }
  useActions(
    {
      up: () => (pick((idx - 1 + THEMES.length) % THEMES.length), true),
      down: () => (pick((idx + 1) % THEMES.length), true),
      left: () => true,
      right: () => true,
      confirm: () => (onDone(THEMES[idx].id), true),
      back: () => (onDone(null), true),
      menu: () => (onDone(null), true)
    },
    {
      modal: true,
      hints: [
        { action: 'up', label: 'Motyw' },
        { action: 'confirm', label: 'Ustaw' },
        { action: 'back', label: 'Anuluj' }
      ]
    }
  )
  const t = THEMES[idx]
  return (
    <div className="tv-modal tv-modal--side">
      <div className="tv-panel tv-themes">
        <h2>Motyw</h2>
        <ul className="tv-menulist">
          {THEMES.map((th, i) => (
            <li key={th.id} className={i === idx ? 'sel' : ''} onMouseEnter={() => pick(i)} onClick={() => onDone(th.id)}>
              {th.name}
              {th.id === current && <span className="tv-themes__now">w użyciu</span>}
            </li>
          ))}
        </ul>
        <p className="tv-themes__desc">{t.description}</p>
      </div>
    </div>
  )
}
