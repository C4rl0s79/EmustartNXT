import { useEffect, useState } from 'react'
import type { GogInstallOptions } from '@shared/types'
import { api, attempt, useStore } from '../store'
import { Modal } from './Modal'
import { formatBytes } from '../lib/format'

// Install (or add DLC to) a GOG game from the EmuStart server — the same window in both layouts.
// Only what the server really has complete is offered: no silent switch to English.

const LANG_NAME: Record<string, string> = {
  pl: 'polski', en: 'angielski', de: 'niemiecki', fr: 'francuski', es: 'hiszpański', it: 'włoski', ru: 'rosyjski',
  cs: 'czeski', pt: 'portugalski', ja: 'japoński', ko: 'koreański', zh: 'chiński', tr: 'turecki', nl: 'niderlandzki',
  hu: 'węgierski', uk: 'ukraiński', sv: 'szwedzki', fi: 'fiński', da: 'duński', no: 'norweski', th: 'tajski', ar: 'arabski'
}
export const langName = (code: string): string => LANG_NAME[code] ?? code.toUpperCase()

export function GogInstallDialog() {
  const req = useStore((s) => s.gogInstall)
  if (!req) return null
  return <GogInstallWindow key={req.gameId} gameId={req.gameId} dlcOnly={req.dlcOnly} onClose={() => useStore.getState().setGogInstall(null)} />
}

function GogInstallWindow({ gameId, dlcOnly, onClose }: { gameId: string; dlcOnly: boolean; onClose: () => void }) {
  const [opts, setOpts] = useState<GogInstallOptions | null>(null)
  const [error, setError] = useState('')
  const [langs, setLangs] = useState<string[]>([])
  const [primary, setPrimary] = useState('')
  const [dlcs, setDlcs] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void api()
      .gog.options(gameId)
      .then((r) => {
        if (!alive) return
        if (!r.ok) return setError(r.error)
        setOpts(r)
        const pre = dlcOnly ? (r.installed?.languages ?? []) : r.defaultLanguages
        setLangs(pre)
        setPrimary(pre[0] ?? '')
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [gameId, dlcOnly])

  const have = new Set(opts?.installed?.dlcs ?? [])
  const dlcList = (opts?.dlcs ?? []).filter((d) => !dlcOnly || !have.has(d.id))
  const toggleLang = (l: string): void => {
    const next = langs.includes(l) ? langs.filter((x) => x !== l) : [...langs, l]
    setLangs(next)
    if (!next.includes(primary)) setPrimary(next[0] ?? '')
  }
  const toggleDlc = (id: string): void => {
    const next = new Set(dlcs)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDlcs(next)
  }
  const tooSmall = !!opts && opts.free !== null && opts.free < opts.size
  const can = !!opts && !busy && (dlcOnly ? dlcs.size > 0 : langs.length > 0 && !!primary && !tooSmall)

  const go = async (): Promise<void> => {
    if (!can) return
    setBusy(true)
    const r = await attempt(dlcOnly ? api().gog.addDlc(gameId, [...dlcs]) : api().gog.install(gameId, { languages: langs, primary, dlcs: [...dlcs] }))
    setBusy(false)
    if (!r) return
    useStore.getState().toast(r.ok ? (r.message ?? 'Dodano do zadań.') : r.error, r.ok ? 'info' : 'error')
    if (r.ok) onClose()
  }

  return (
    <Modal title={dlcOnly ? 'Dodaj DLC z serwera EmuStart' : 'Zainstaluj z serwera EmuStart'} onClose={onClose} wide>
      {!opts && !error && <p className="details__muted">Pytam serwer o dostępne wersje…</p>}
      {error && (
        <>
          <p className="details__error">{error}</p>
          <div className="modal__footer">
            <button className="btn btn--primary" data-nav data-autofocus onClick={onClose}>
              Zamknij
            </button>
          </div>
        </>
      )}
      {opts && (
        <div className="gog-install">
          <p className="details__muted">
            {opts.title} · build {opts.version || opts.buildId} · {formatBytes(opts.size) ?? '?'}
            {opts.dependencies.length ? ` · zależności: ${opts.dependencies.join(', ')}` : ''}
          </p>
          {opts.updateNote && <p className="details__warn">{opts.updateNote}</p>}
          {!dlcOnly && (
            <>
              <h3 className="gog-install__h">Języki</h3>
              {!opts.defaultLanguages.length && (
                <p className="details__warn">Języka z ustawień nie ma na serwerze dla tej gry — wybierz język (nie zamieniam go po cichu na inny).</p>
              )}
              <div className="list list--grid">
                {opts.languages.map((l, i) => (
                  <button
                    key={l}
                    className={`list__item list__item--check ${langs.includes(l) ? 'is-on' : ''}`}
                    data-nav
                    data-autofocus={i === 0 || undefined}
                    role="checkbox"
                    aria-checked={langs.includes(l)}
                    onClick={() => toggleLang(l)}
                  >
                    <span className="check" aria-hidden>
                      {langs.includes(l) ? '✓' : ''}
                    </span>
                    {langName(l)}
                    {primary === l && langs.length > 1 && <span className="list__meta">główny</span>}
                  </button>
                ))}
              </div>
              {langs.length > 1 && (
                <div className="modal__row">
                  <span className="details__muted">Język główny (pliki obecne w kilku językach):</span>
                  {langs.map((l) => (
                    <button key={l} className={`chip ${primary === l ? 'is-on' : ''}`} data-nav aria-pressed={primary === l} onClick={() => setPrimary(l)}>
                      {langName(l)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {dlcOnly && <p className="details__muted">Języki instalacji: {(opts.installed?.languages ?? []).map(langName).join(', ')}</p>}
          {dlcList.length > 0 && (
            <>
              <h3 className="gog-install__h">DLC dostępne na serwerze</h3>
              <div className="list">
                {dlcList.map((d, i) => (
                  <button
                    key={d.id}
                    className={`list__item list__item--check ${dlcs.has(d.id) ? 'is-on' : ''}`}
                    data-nav
                    data-autofocus={(dlcOnly && i === 0) || undefined}
                    role="checkbox"
                    aria-checked={dlcs.has(d.id)}
                    onClick={() => toggleDlc(d.id)}
                  >
                    <span className="check" aria-hidden>
                      {dlcs.has(d.id) ? '✓' : ''}
                    </span>
                    {d.name}
                    {!d.hasFiles && <span className="list__meta">bez plików</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {dlcOnly && !dlcList.length && <p className="details__muted">Wszystkie DLC z serwera są już zainstalowane.</p>}
          {!dlcOnly && (
            <p className="details__muted">
              Folder: <strong>{opts.target}</strong>
              {opts.free !== null && ` · wolne ${formatBytes(opts.free) ?? '?'}`}
              {' — zmienisz go w Ustawieniach → Gry GOG (dotyczy przyszłych instalacji).'}
            </p>
          )}
          {tooSmall && <p className="details__error">Za mało miejsca na dysku.</p>}
          <div className="modal__footer">
            <button className="btn btn--primary" data-nav disabled={!can} onClick={() => void go()}>
              {busy ? 'Dodaję…' : dlcOnly ? 'Zainstaluj DLC' : 'Zainstaluj'}
            </button>
            <button className="btn" data-nav onClick={onClose}>
              Anuluj
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
