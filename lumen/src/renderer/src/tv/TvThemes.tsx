import { useState } from 'react'
import { TV_ANIM_LEVELS, type ThemePackage, type TvAnim } from '@shared/types'
import { useActions } from '../nav/input'
import { api, attempt, useStore } from '../store'
import { allThemes } from './themes'
import { useTvAnim } from './usePackages'

// Theme chooser of the TV layout (Menu → Motyw): moving through the list shows each theme at once
// on the whole screen behind the panel; A keeps it, B goes back to the one in use. Motywy z serwera
// (paczki — etap 14) na liście za wbudowanymi; lewo / prawo — poziom animacji (wył. / niskie / średnie / wysokie).

export const ANIM_LABEL: Record<TvAnim, string> = { off: 'wyłączone', low: 'niskie', med: 'średnie', high: 'wysokie' }

export function TvThemes({ current, themes: pkgs = [], onPreview, onDone }: { current: string; themes?: ThemePackage[]; onPreview: (id: string) => void; onDone: (id: string | null) => void }) {
  const list = allThemes(pkgs)
  const [idx, setIdx] = useState(() => Math.max(0, list.findIndex((t) => t.id === current)))
  const level = useStore((s) => s.settings?.tvAnim ?? 'med')
  const effective = useTvAnim()
  const pick = (i: number): void => {
    setIdx(i)
    onPreview(list[i].id)
  }
  const anim = (d: 1 | -1): boolean => {
    const i = TV_ANIM_LEVELS.indexOf(level)
    const next = TV_ANIM_LEVELS[Math.max(0, Math.min(TV_ANIM_LEVELS.length - 1, i + d))]
    if (next !== level) void attempt(api().settings.patch({ tvAnim: next })).then((s) => s && useStore.getState().setSettings(s))
    return true
  }
  useActions(
    {
      up: () => (pick((idx - 1 + list.length) % list.length), true),
      down: () => (pick((idx + 1) % list.length), true),
      left: () => anim(-1),
      right: () => anim(1),
      confirm: () => (onDone(list[idx].id), true),
      back: () => (onDone(null), true),
      menu: () => (onDone(null), true)
    },
    {
      modal: true,
      hints: [
        { action: 'up', label: 'Motyw' },
        { action: 'left', label: 'Animacje' },
        { action: 'confirm', label: 'Ustaw' },
        { action: 'back', label: 'Anuluj' }
      ]
    }
  )
  const t = list[Math.min(idx, list.length - 1)]
  return (
    <div className="tv-modal tv-modal--side">
      <div className="tv-panel tv-themes">
        <h2>Motyw</h2>
        <ul className="tv-menulist">
          {list.map((th, i) => (
            <li key={th.id} className={i === idx ? 'sel' : ''} onMouseEnter={() => pick(i)} onClick={() => onDone(th.id)}>
              {th.name}
              {th.pkg && <span className="tv-themes__from">z serwera</span>}
              {th.id === current && <span className="tv-themes__now">w użyciu</span>}
            </li>
          ))}
        </ul>
        <p className="tv-themes__desc">{t.description}</p>
        <p className="tv-themes__anim">
          Animacje: <b>‹ {ANIM_LABEL[level]} ›</b>
          {effective !== level && <span> — wyłączone przez ograniczenie ruchu w Windows</span>}
        </p>
      </div>
    </div>
  )
}
