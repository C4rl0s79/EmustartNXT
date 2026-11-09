import { useEffect, useRef } from 'react'
import type { ArtKind } from '@shared/types'
import { api, attempt, pickPath, useStore } from '../store'
import { focusFirst } from '../nav/engine'
import { Modal } from '../components/Modal'
import type { TvSystem } from './data'
import { UserArtSection } from '../components/UserArt'

// Own art of a library group in the TV layout (PC, Komputery, Konsole, Steam, GOG, a collection…): logo on
// the carousel and the picture behind it, from a file the player picks. EmuStart platforms keep their logo
// and console photo from the server (Opcje systemu). Stored like a game's TV art (prefs.artTv, id navgrp:…).

/** art id of a carousel item without an EmuStart platform; undefined for platforms */
export function groupArtId(sys: TvSystem): string | undefined {
  if (sys.es) return undefined
  if (sys.sub) return `navgrp:${sys.sub.id}`
  if (sys.group) return `navgrp:grp:${sys.group.id}`
  return undefined
}

export function useGroupArt(sys: TvSystem | undefined): { id?: string; logo: boolean; hero: boolean; rev: number } {
  const id = sys ? groupArtId(sys) : undefined
  const choice = useStore((s) => (id ? s.prefs?.artTv?.[id] : undefined))
  const rev = useStore((s) => (id ? (s.artRev[id] ?? 0) : 0))
  const set = (t?: string): boolean => t === 'file' || t === 'user'
  return { id, logo: set(choice?.logo?.type), hero: set(choice?.hero?.type), rev }
}

export function GroupArtOptions({ sys, onClose }: { sys: TvSystem; onClose: () => void }) {
  const art = useGroupArt(sys)
  const toast = useStore((s) => s.toast)
  const setPrefs = useStore((s) => s.setPrefs)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [art.logo, art.hero])
  const id = art.id
  if (!id) return null

  const pick = async (kind: ArtKind, title: string): Promise<void> => {
    const file = await pickPath({ kind: 'file', title, extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] })
    if (!file) return
    const p = await attempt(api().art.useFile(id, kind, file, 'tv'))
    if (p) {
      setPrefs(p)
      toast(kind === 'logo' ? 'Logo grupy zapisane.' : 'Tło grupy zapisane.')
    }
  }
  const clear = async (kind: ArtKind): Promise<void> => {
    const p = await attempt(api().art.reset(id, kind, 'tv'))
    if (p) setPrefs(p)
  }
  const rows = [
    { label: 'Logo z pliku…', value: art.logo ? 'zmień' : 'brak — pokazuje nazwę', act: () => void pick('logo', 'Logo grupy') },
    { label: 'Tło z pliku…', value: art.hero ? 'zmień' : 'brak', act: () => void pick('hero', 'Tło grupy') },
    ...(art.logo ? [{ label: 'Usuń logo', value: '', act: () => void clear('logo') }] : []),
    ...(art.hero ? [{ label: 'Usuń tło', value: '', act: () => void clear('hero') }] : [])
  ]
  return (
    <Modal title={`Grafika grupy — ${sys.display}`} onClose={onClose} wide className="gopt" handlers={{ back: () => (onClose(), true) }} hints={[{ action: 'confirm', label: 'Wybierz' }, { action: 'back', label: 'Zamknij' }]}>
      <div className="gopt__list" ref={listRef}>
        {rows.map((r, i) => (
          <button key={r.label} className="gopt__row" data-nav data-autofocus={i === 0 || undefined} onClick={r.act}>
            <span className="gopt__label">{r.label}</span>
            {r.value && <span className="gopt__value">{r.value}</span>}
          </button>
        ))}
      </div>
      <UserArtSection gameId={id} kind="logo" layout="tv" label="logo" />
      <UserArtSection gameId={id} kind="hero" layout="tv" label="tło" />
    </Modal>
  )
}
