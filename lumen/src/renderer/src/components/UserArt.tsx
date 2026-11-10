import { useEffect, useState } from 'react'
import type { ArtKind, ArtLayout, UserArtGallery } from '@shared/types'
import { api, attempt, useStore } from '../store'

// Images uploaded to the EmuStart server by the accounts of this server, one more source of art: picking somebody's
// image copies it to your account's choices (their image, your choice — it stays even if they remove theirs).
// Always on screen, so it is clear what the server holds: this game's images, or everything of this kind.

export function UserArtSection({ gameId, kind, layout, label, onChosen }: { gameId: string; kind: ArtKind; layout?: ArtLayout; label?: string; onChosen?: () => void }) {
  const [all, setAll] = useState(false)
  const [res, setRes] = useState<UserArtGallery | null>(null)
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    let alive = true
    setRes(null)
    void api()
      .art.userGallery(all ? '' : gameId, kind)
      .then((r) => alive && setRes(r))
      .catch(() => alive && setRes({ ok: false, error: 'Nie udało się odczytać grafik z serwera.' }))
    return () => {
      alive = false
    }
  }, [gameId, kind, all])
  return (
    <>
      <h3 className="gopt__head">Grafiki na serwerze{label ? ` — ${label}` : ''}</h3>
      <div className="modal__row">
        <button className="btn" data-nav onClick={() => setAll(!all)}>
          {all ? 'Tylko dla tej pozycji' : 'Wszystkie na serwerze'}
        </button>
      </div>
      {!res && <p className="details__loading">Wczytywanie…</p>}
      {res && !res.ok && <p className="details__muted">{res.error}</p>}
      {res?.ok && res.items.length === 0 && (
        <p className="details__muted">{all ? 'Na serwerze nie ma jeszcze grafik tego rodzaju.' : 'Na serwerze nie ma jeszcze grafik tego rodzaju dla tej pozycji. Własny plik trafi tutaj po wybraniu.'}</p>
      )}
      {res?.ok && res.items.length > 0 && (
        <div className={`thumbs thumbs--${kind}`} data-nav-group={`user-${kind}`}>
          {res.items.map((o) => (
            <button
              key={o.sha}
              className="thumb thumb--fit"
              data-nav
              title={`${o.mine ? 'Twoja grafika' : `Wgrał(a): ${o.by}`}${all ? ` · ${o.game}` : ''}`}
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
      )}
    </>
  )
}
