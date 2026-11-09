import { useEffect, useState } from 'react'
import type { ArtKind, ArtLayout, UserArtItem } from '@shared/types'
import { api, attempt, useStore } from '../store'

// Images uploaded to the EmuStart server by the accounts of this server, one more source of art: picking somebody's
// image copies it to your account's choices (their image, your choice — it stays even if they remove theirs).

export function UserArtSection({ gameId, kind, layout, onChosen }: { gameId: string; kind: ArtKind; layout?: ArtLayout; onChosen?: () => void }) {
  const [items, setItems] = useState<UserArtItem[] | null>(null)
  const toast = useStore((s) => s.toast)
  const load = (): void => void attempt(api().art.userGallery(gameId, kind)).then((r) => setItems(r ?? []))
  useEffect(load, [gameId, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!items?.length) return null
  return (
    <>
      <h3 className="gopt__head">Wgrane przez użytkowników serwera</h3>
      <div className={`thumbs thumbs--${kind}`} data-nav-group={`user-${kind}`}>
        {items.map((o) => (
          <button
            key={o.sha}
            className="thumb thumb--fit"
            data-nav
            title={o.mine ? 'Twoja grafika' : `Wgrał(a): ${o.by}`}
            onClick={() =>
              void attempt(api().art.chooseUser(gameId, kind, o.sha, o.ext, layout)).then((p) => {
                if (p) {
                  toast('Zapisano wybór grafiki')
                  onChosen?.()
                }
              })
            }
          >
            <img src={api().art.url(`usr:${o.sha}.${o.ext}`, 'grid')} alt="" loading="lazy" decoding="async" />
            <span className="thumb__tag">{o.mine ? 'moja' : o.by}</span>
          </button>
        ))}
      </div>
    </>
  )
}
