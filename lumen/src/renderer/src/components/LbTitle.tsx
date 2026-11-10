import { useEffect, useState } from 'react'
import type { Game, LbTitleInfo } from '@shared/types'
import { api, attempt, useStore } from '../store'
import { Modal } from './Modal'
import { TextField } from './TextField'

// The name a GOG game / a shortcut has in the LaunchBox database, when the store's differs (a Polish
// GOG title, a shortcut named by hand). The server's administrator sets it for every device; others see it.

export function LbTitleButton({ game, matched, onSaved }: { game: Game; matched?: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const own = useStore((s) => s.prefs?.lbTitles?.[game.id])
  return (
    <>
      <button
        className="btn"
        data-nav
        data-key="lb-title"
        title="Nazwa gry w bazie LaunchBox (opis, ocena, liczba graczy), gdy nazwa ze sklepu się nie znajduje"
        onClick={() => setOpen(true)}
      >
        Nazwa w LaunchBox{own ? `: ${own}` : ''}
      </button>
      {open && (
        <LbTitleDialog
          game={game}
          matched={matched}
          onClose={(saved) => {
            setOpen(false)
            if (saved) onSaved()
          }}
        />
      )}
    </>
  )
}

function LbTitleDialog({ game, matched, onClose }: { game: Game; matched?: string; onClose: (saved: boolean) => void }) {
  const [info, setInfo] = useState<LbTitleInfo | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void attempt(api().launchbox.title(game.id)).then((r) => {
      if (!alive || !r) return
      setInfo(r)
      setName(r.name || matched || game.name)
    })
    return () => {
      alive = false
    }
  }, [game.id, game.name, matched])

  const save = async (value: string, remove = false): Promise<void> => {
    // Enter on an empty field never deletes the name for every device: only the dedicated button does
    if (busy || (!remove && !value.trim())) return
    setBusy(true)
    const r = await attempt(api().launchbox.setTitle(game.id, value))
    setBusy(false)
    if (!r) return
    useStore.getState().toast(r.ok ? (r.message ?? 'Zapisano') : r.error, r.ok ? 'info' : 'error')
    if (r.ok) {
      const p = await attempt(api().prefs.get())
      if (p) useStore.getState().setPrefs(p)
      onClose(true)
    }
  }

  return (
    <Modal title="Nazwa w LaunchBox" onClose={() => onClose(false)}>
      <p className="card__desc">
        Lumen szuka opisu tej gry w bazie LaunchBox po nazwie. Gdy nazwa ze sklepu się nie znajduje (np. polska nazwa w GOG), wpisz nazwę z
        LaunchBox. {matched ? `Teraz dopasowano: „${matched}”.` : 'Teraz nie dopasowano żadnej gry.'}
      </p>
      {!info && <p className="details__loading">Wczytywanie…</p>}
      {info && !info.admin && (
        <p className="card__desc">
          {info.name ? `Nazwa ustawiona przez administratora: „${info.name}”.` : 'Nazwy ustala administrator serwera EmuStart — dla wszystkich urządzeń.'}
        </p>
      )}
      {info?.admin && (
        <>
          <TextField label="Nazwa w LaunchBox" value={name} onChange={setName} onSubmit={(v) => void save(v)} />
          <p className="card__desc">Zapis na serwerze EmuStart — nazwa obowiązuje na wszystkich urządzeniach.</p>
          <div className="modal__actions">
            <button className="btn btn--primary" data-nav disabled={busy || !name.trim()} onClick={() => void save(name)}>
              Zapisz
            </button>
            {info.name && (
              <button className="btn" data-nav disabled={busy} onClick={() => void save('', true)}>
                Szukaj po nazwie ze sklepu
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}
