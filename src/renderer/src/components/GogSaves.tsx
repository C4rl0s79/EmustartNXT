import { useEffect, useRef, useState } from 'react'
import type { Game, GogLaunchResult, GogSaveChoice, GogSavesStatus } from '@shared/types'
import { api, askChoice, askText, attempt, useStore } from '../store'
import { focusFirst } from '../nav/engine'
import { Modal } from './Modal'

// Saves and settings of a GOG game, synced through the EmuStart server (engine/emustart/gogsaves.py) — never GOG's
// cloud. Rules: the player's own → the server's correction → ludusavi-manifest. Desktop: "Zapisy…" in the game's
// actions; TV: a row in the game's options. Same window in both layouts.

const SOURCE: Record<GogSavesStatus['source'], string> = {
  user: 'Twoje reguły (to urządzenie)',
  server: 'poprawka serwera EmuStart',
  ludusavi: 'ludusavi-manifest',
  ambiguous: 'niejednoznaczne — wybierz wpis',
  none: 'brak reguł'
}

const when = (t: number): string => (t ? new Date(t * 1000).toLocaleString('pl-PL') : 'jeszcze nie')

/** Conflict before a game or a manual sync: the player picks a version (nothing is lost — the other one is kept
 *  in a backup / in the server's history). Returns the choice or null (cancelled). */
export async function askSaveChoice(r: GogLaunchResult): Promise<GogSaveChoice | null> {
  const c = r.conflict?.[0]
  const dev = c?.serverDevice ? ` (${c.serverDevice})` : ''
  const i = await askChoice(`Zapisy zmieniły się tutaj i na innym urządzeniu${dev}. Którą wersję zachować?`, [
    'Wersja z tego urządzenia (wersja z serwera zostaje w historii serwera)',
    'Wersja z serwera (pliki z tego urządzenia trafią do kopii zapasowej)',
    'Na razie bez synchronizacji (zapytam przy następnej grze)'
  ])
  return i === 0 ? 'local' : i === 1 ? 'remote' : i === 2 ? 'skip' : null
}

/** Launch with the save sync: a conflict asks the player first, then starts the game with that choice. */
export async function launchGog(gameId: string, task?: number): Promise<GogLaunchResult | undefined> {
  const r = await attempt(api().gog.launch(gameId, task))
  if (!r || r.ok || !r.conflict) return r
  const choice = await askSaveChoice(r)
  if (!choice) return { ok: false, error: 'Nie uruchomiono — konflikt zapisów czeka na decyzję.' }
  return attempt(api().gog.launch(gameId, task, choice))
}

export function GogSaves({ game, onClose }: { game: Game; onClose: () => void }) {
  const [s, setS] = useState<GogSavesStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const toast = useStore((st) => st.toast)
  const load = (refresh = false): void => void attempt(api().gog.saves(game.id, refresh)).then((r) => r && setS(r))
  useEffect(() => load(), [game.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(() => listRef.current && focusFirst(listRef.current), 0)
    return () => clearTimeout(t)
  }, [!!s]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = async (opts: Parameters<ReturnType<typeof api>['gog']['savesSet']>[1]): Promise<void> => {
    const r = await attempt(api().gog.savesSet(game.id, opts))
    if (r && !r.ok) toast(r.error, 'error')
    load()
  }
  const sync = async (): Promise<void> => {
    setBusy(true)
    let r = await attempt(api().gog.savesSync(game.id))
    if (r && !r.ok && r.conflict) {
      const choice = await askSaveChoice(r)
      r = choice ? await attempt(api().gog.savesSync(game.id, choice)) : undefined
    }
    setBusy(false)
    if (r) toast(r.ok ? (r.message ?? 'Zsynchronizowano.') : r.error, r.ok ? 'info' : 'error')
    load()
  }
  const manual = async (): Promise<void> => {
    const first = s?.userRules?.files[0]?.path ?? s?.sets[0]?.template ?? '<winDocuments>/'
    const path = await askText('Ścieżka zapisów (symbole: <base> folder gry, <winDocuments>, <winAppData>, <winLocalAppData>, <home>…)', { initial: first })
    if (!path) return
    const k = await askChoice('Co jest w tej ścieżce?', ['Zapisy gry', 'Ustawienia gry'])
    if (k === null) return
    await set({ rules: { files: [{ path, tags: [k === 1 ? 'config' : 'save'] }] } })
  }
  const pick = async (): Promise<void> => {
    if (!s?.candidates.length) return
    const i = await askChoice('Który wpis ludusavi-manifest opisuje tę grę?', s.candidates)
    if (i !== null) await set({ pick: s.candidates[i] })
  }
  const restore = async (): Promise<void> => {
    const list = await attempt(api().gog.savesBackups(game.id))
    if (!list?.length) return toast('Brak kopii zapasowych zapisów tej gry na tym urządzeniu.')
    const i = await askChoice('Przywrócić kopię zapasową (bieżące pliki trafią do nowej kopii)?', list.map((b) => `${b.id.replace(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)$/, '$3.$2.$1 $4:$5:$6')} · ${b.sets.length} zbiór(y)`))
    if (i === null) return
    const r = await attempt(api().gog.savesRestore(game.id, list[i].id))
    if (r) toast(r.ok ? (r.message ?? 'Przywrócono.') : r.error, r.ok ? 'info' : 'error')
    load()
  }

  type Row = { label: string; value?: string; act?: () => void; disabled?: boolean }
  const rows: Row[] = !s?.ok
    ? []
    : [
        { label: 'Synchronizuj zapisy', value: s.enabled ? 'tak' : 'nie', act: () => void set({ enabled: !s.enabled }) },
        { label: 'Synchronizuj ustawienia', value: s.config ? 'tak (osobno od zapisów)' : 'nie', act: () => void set({ config: !s.config }) },
        {
          label: busy ? 'Synchronizuję…' : 'Synchronizuj teraz',
          value: s.running ? 'gra działa — po jej zamknięciu' : !s.profile ? 'zaloguj urządzenie do serwera' : undefined,
          act: () => void sync(),
          disabled: busy || s.running || !s.profile || !s.sets.length || !s.enabled
        },
        ...(s.source === 'ambiguous' ? [{ label: 'Wybierz wpis reguł', value: `${s.candidates.length} kandydatów`, act: () => void pick() }] : []),
        ...(s.pick ? [{ label: 'Wyczyść wybrany wpis', value: s.pick, act: () => void set({ pick: '' }) }] : []),
        { label: s.userRules ? 'Zmień swoje reguły' : 'Wskaż reguły ręcznie', value: 'ścieżka zapisów na tym urządzeniu', act: () => void manual() },
        ...(s.userRules ? [{ label: 'Usuń swoje reguły', value: 'wróć do reguł z serwera', act: () => void set({ rules: null }) }] : []),
        { label: 'Przywróć kopię zapasową…', value: 'kopie zrobione przed pobraniem z serwera', act: () => void restore() },
        { label: 'Odśwież reguły z serwera', act: () => load(true) }
      ]

  return (
    <Modal title={`Zapisy i ustawienia — ${game.name}`} onClose={onClose} wide className="gopt" hints={[{ action: 'confirm', label: 'Wybierz' }, { action: 'back', label: 'Zamknij' }]}>
      {!s && <p className="details__loading">Sprawdzam reguły i pliki zapisów…</p>}
      {s && !s.ok && <p className="details__muted">{s.reason}</p>}
      {s?.ok && (
        <>
          <p className="details__muted">
            Reguły: {SOURCE[s.source]}
            {s.title ? ` · „${s.title}”` : ''}
            {s.version ? ` · ${s.version}` : ''}
            {s.offline ? ' · serwer niedostępny — ostatnia znana wersja reguł' : ''}
            {s.reason ? ` · ${s.reason}` : ''}
          </p>
          <p className="details__muted">
            Ostatnia synchronizacja: {when(s.lastSync)}
            {s.pending ? ` · zmiany do wysłania: ${s.pending}` : ''}
            {s.last.message ? ` · ${s.last.message}` : ''}
          </p>
          <div className="gopt__list" ref={listRef}>
            {rows.map((r, i) => (
              <button key={r.label + i} className="gopt__row" data-nav={r.disabled && !r.act ? undefined : true} data-autofocus={i === 0 || undefined} disabled={r.disabled} onClick={r.act}>
                <span className="gopt__label">{r.label}</span>
                {r.value && <span className="gopt__value">{r.value}</span>}
              </button>
            ))}
          </div>
          {s.sets.length > 0 && <h3 className="gopt__head">Lokalizacje na tym komputerze</h3>}
          {s.sets.map((x) => (
            <p key={x.id} className="details__muted" title={x.template}>
              {x.kind === 'config' ? 'Ustawienia' : 'Zapisy'}: {x.folder}
              {x.pattern ? `\\${x.pattern}` : ''} — {x.error || (x.exists ? `${x.files} plików` : 'jeszcze nie istnieje (pojawi się po pierwszej grze albo pobraniu)')}
            </p>
          ))}
          {s.registry.map((x) => (
            <p key={x.path} className="details__muted">
              Rejestr ({x.kind === 'config' ? 'ustawienia' : 'zapisy'}): {x.path} — {x.reason}
            </p>
          ))}
          {s.skipped.map((x) => (
            <p key={x.path} className="details__muted">
              Pominięte: {x.path} — {x.reason}
            </p>
          ))}
          {s.attribution && <p className="details__muted">Źródło reguł: {s.attribution}.</p>}
        </>
      )}
    </Modal>
  )
}
