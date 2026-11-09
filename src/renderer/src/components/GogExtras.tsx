import { useEffect, useRef, useState } from 'react'
import type { Game, GogExtra } from '@shared/types'
import { api, attempt, useStore } from '../store'
import { focusFirst } from '../nav/engine'
import { formatBytes } from '../lib/format'
import { Modal } from './Modal'

// Bonus content of a GOG game from the EmuStart server: pick what to download. Pre-selected like in GOG Manager:
// old versions of the game, language patches and multi-part packs start switched off. Files go to
// <shared GOG folder>\_extras\<game>, apart from the game — installing and removing the game does not touch them.

export function GogExtras({ game, onClose }: { game: Game; onClose: () => void }) {
  const [items, setItems] = useState<GogExtra[] | null>(null)
  const [target, setTarget] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    void attempt(api().gog.extras(game.id)).then((r) => {
      if (!r) return
      setItems(r.items)
      setTarget(r.target)
      setPicked(new Set(r.items.filter((x) => x.default && !x.have).map((x) => x.id)))
    })
  }, [game.id])
  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [!!items]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string): void =>
    setPicked((p) => {
      const n = new Set(p)
      if (!n.delete(id)) n.add(id)
      return n
    })
  const chosen = (items ?? []).filter((x) => picked.has(x.id) && !x.have)
  const download = async (): Promise<void> => {
    const r = await attempt(api().gog.extrasDownload(game.id, chosen.map((x) => x.id)))
    if (r) useStore.getState().toast(r.ok ? (r.message ?? 'Pobieranie dodatków — postęp na liście zadań.') : r.error, r.ok ? 'info' : 'error')
    if (r?.ok) onClose()
  }
  const total = chosen.reduce((a, x) => a + x.size, 0)

  return (
    <Modal title={`Dodatki — ${game.name}`} onClose={onClose} wide className="gopt" hints={[{ action: 'confirm', label: 'Zaznacz' }, { action: 'back', label: 'Zamknij' }]}>
      {!items && <p className="details__loading">Wczytuję dodatki…</p>}
      {items && !items.length && <p className="details__muted">Serwer nie ma dodatków tej gry.</p>}
      {items && items.length > 0 && (
        <>
          <p className="details__muted">Stare wersje gry, poprawki językowe i paczki w częściach są domyślnie odznaczone. Folder: {target}</p>
          <div className="gopt__list" ref={listRef}>
            <button className="gopt__row" data-nav data-autofocus disabled={!chosen.length} onClick={() => void download()}>
              <span className="gopt__label">Pobierz wybrane</span>
              <span className="gopt__value">
                {chosen.length} · {formatBytes(total) ?? '0 B'}
              </span>
            </button>
            {items.map((x) => (
              <button key={x.id} className="gopt__row" data-nav disabled={x.have} onClick={() => toggle(x.id)}>
                <span className="gopt__label">
                  {x.have ? '✓' : picked.has(x.id) ? '☑' : '☐'} {x.name}
                </span>
                <span className="gopt__value">{x.have ? 'pobrane' : `${x.type ? `${x.type} · ` : ''}${formatBytes(x.size) ?? '0 B'}`}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
