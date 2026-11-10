import type { SteamFamilyStatus } from '@shared/types'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ArtDataSource, CacheStats, Category, EmuSettings, LaunchBoxStatus, SecretName, Settings as AppSettings, SettingsPatch } from '@shared/types'
import type { PickPathOptions } from '@shared/api'
import { loginFlow, logoutFlow } from '../lib/account'
import { detectEmulators, installMissing } from '../lib/emusettings'
import { api, attempt, pickPath, sortedCategories, useStore } from '../store'
import { collectionGames } from '@shared/libraryNav'
import { findSub, useNav } from '../lib/nav'
import { langName } from '../components/GogInstall'
import { useActions } from '../nav/input'
import { focusEl, focusFirst, move } from '../nav/engine'
import { TextField } from '../components/TextField'
import { Modal } from '../components/Modal'
import { formatBytes, gameCountLabel } from '../lib/format'
import { UpdateSection } from '../components/Update'
import { EmuLibraryOptions } from '../components/EmuOptions'

// Two panes: the list of sections on the left, the chosen section on the right (scrolled on its own).
// Moving along the list shows the section; right / A goes into it, B (or left at its edge) back to the list.
const PAGES: { id: string; label: string; render: () => ReactNode }[] = [
  { id: 'interface', label: 'Interfejs', render: () => <InterfaceSection /> },
  { id: 'steam', label: 'Steam', render: () => <SteamSection /> },
  { id: 'emustart', label: 'EmuStart', render: () => <EmustartSection /> },
  { id: 'gog', label: 'Gry GOG', render: () => <GogSection /> },
  {
    id: 'library',
    label: 'Biblioteka EmuStart',
    render: () => (
      <Section
        title="Biblioteka EmuStart"
        desc="Te same ustawienia co w EmuStart (tryb TV → Ustawienia) — zapisane raz, działają w obu trybach."
      >
        <EmuLibraryOptions part="library" />
      </Section>
    )
  },
  {
    id: 'systems',
    label: 'Systemy',
    render: () => (
      <Section title="Systemy" desc="Emulator dla każdego systemu na tym komputerze; wyłączony system znika z biblioteki.">
        <EmuLibraryOptions part="systems" />
      </Section>
    )
  },
  { id: 'groups', label: 'Szybki dostęp', render: () => <CategoriesSection /> },
  {
    id: 'art',
    label: 'Grafiki i opisy',
    render: () => (
      <>
        <ArtSection />
        <LaunchBoxSection />
      </>
    )
  },
  { id: 'behaviour', label: 'Zachowanie', render: () => <BehaviourSection /> },
  { id: 'data', label: 'Dane', render: () => <DataSection /> },
  {
    id: 'update',
    label: 'Aktualizacja',
    render: () => (
      <Section
        title="Aktualizacja Lumen"
        desc="Jak w EmuStart: nowe wersje z wydań na GitHubie (C4rl0s79/Launcher), sprawdzane przy starcie i raz dziennie. Plik jest sprawdzany skrótem SHA-256 i podpisem wydania Lumen; dane w LumenData zostają nietknięte."
      >
        <UpdateSection />
      </Section>
    )
  },
  { id: 'help', label: 'Sterowanie', render: () => <HelpSection /> }
]
let lastPage = PAGES[0].id // kept while the program runs

export function SettingsScreen({ active }: { active: boolean }) {
  const [page, setPageState] = useState(lastPage)
  const setPage = (id: string): void => {
    lastPage = id
    setPageState(id)
  }
  const menuRef = useRef<HTMLElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const inPane = (): boolean => !!paneRef.current?.contains(document.activeElement)
  const toMenu = (): void => {
    const b = menuRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (b) focusEl(b, false)
  }
  useActions(
    {
      back: () => {
        if (inPane()) toMenu()
        else useStore.getState().setTab('home')
        return true
      },
      // up / down never leave the pane they are in (the nearest control may lie in the other one)
      up: () => (move('up', true, (inPane() ? paneRef.current : menuRef.current) ?? undefined), true),
      down: () => (move('down', true, (inPane() ? paneRef.current : menuRef.current) ?? undefined), true),
      right: () => {
        if (!paneRef.current) return false
        // from the list: into the section (its first control)
        if (!inPane()) focusFirst(paneRef.current)
        else move('right', true, paneRef.current)
        return true
      },
      left: () => {
        // at the left edge of the section: back to its own entry of the list
        if (!inPane()) return true
        if (!move('left', true, paneRef.current ?? undefined)) toMenu()
        return true
      }
    },
    {
      enabled: active,
      hints: [
        { action: 'confirm', label: 'Wybierz' },
        { action: 'back', label: 'Wstecz' },
        { action: 'lb', label: 'Poprzednia zakładka' }
      ]
    }
  )
  const current = PAGES.find((p) => p.id === page) ?? PAGES[0]
  return (
    <div className="settings">
      <nav className="settings__menu" ref={menuRef} aria-label="Działy ustawień">
        {PAGES.map((p) => (
          <button
            key={p.id}
            className={`settings__item ${p.id === page ? 'is-on' : ''}`}
            data-nav
            data-page={p.id}
            data-autofocus={p.id === page ? '' : undefined}
            onFocus={() => setPage(p.id)}
            onClick={() => {
              setPage(p.id)
              setTimeout(() => paneRef.current && focusFirst(paneRef.current), 0)
            }}
          >
            {p.label}
          </button>
        ))}
      </nav>
      <div className="settings__pane" ref={paneRef} data-scroll="center" key={current.id}>
        {current.render()}
      </div>
    </div>
  )
}

function Section({ title, children, desc }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {desc && <p className="card__desc">{desc}</p>}
      {children}
    </section>
  )
}

function Toggle({ label, value, onChange, desc }: { label: string; value: boolean; onChange: (v: boolean) => void; desc?: string }) {
  return (
    <button className="toggle" data-nav role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span className="toggle__text">
        {label}
        {desc && <small>{desc}</small>}
      </span>
      <span className={`toggle__knob ${value ? 'is-on' : ''}`} />
    </button>
  )
}

const patch = async (p: SettingsPatch): Promise<void> => {
  const s = await attempt(api().settings.patch(p))
  if (s) useStore.getState().setSettings(s)
}

function SecretField({ name, label, has }: { name: SecretName; label: string; has: boolean }) {
  const [value, setValue] = useState('')
  const save = async (v: string | null): Promise<void> => {
    const s = await attempt(api().settings.setSecret(name, v))
    if (s) {
      useStore.getState().setSettings(s)
      useStore.getState().toast(v ? 'Zapisano klucz' : 'Usunięto klucz')
      setValue('')
    }
  }
  return (
    <div className="field-row">
      <label>{label}</label>
      <span className={`pill ${has ? 'pill--ok' : ''}`}>{has ? 'Zapisany' : 'Brak'}</span>
      <TextField type="password" label={label} placeholder={has ? 'Wpisz nowy, aby zmienić' : 'Wklej klucz'} value={value} onChange={setValue} onSubmit={(v) => v && void save(v)} />
      <button className="btn" data-nav disabled={!value.trim()} onClick={() => void save(value)}>
        Zapisz
      </button>
      {has && (
        <button className="btn btn--ghost" data-nav onClick={() => void save(null)}>
          Usuń
        </button>
      )}
    </div>
  )
}

function SteamSection() {
  const snapshot = useStore((s) => s.snapshot)!
  const settings = useStore((s) => s.settings)!
  const [steamId, setSteamId] = useState(settings.steamIdOverride ?? '')
  const { steam, account } = snapshot
  const statusText = { running: 'działa', notRunning: 'zainstalowany, wyłączony', notInstalled: 'nie znaleziono', unknown: 'nieznany' }[steam.status]
  const [family, setFamily] = useState<SteamFamilyStatus | null>(null)
  useEffect(() => void attempt(api().library.familyStatus()).then((s) => s && setFamily(s)), [snapshot])

  const accountText =
    account.state === 'ok'
      ? `${gameCountLabel(account.count)} na koncie · pobrano ${new Date(account.fetchedAt).toLocaleString('pl-PL')}`
      : account.state === 'private'
        ? 'Steam zwrócił pustą odpowiedź — profil lub „Szczegóły gier” są prywatne.'
        : account.state === 'error'
          ? account.message
          : account.reason === 'noKey'
            ? 'Wyłączona — brak klucza Web API.'
            : 'Wyłączona — nie ustalono SteamID.'

  return (
    <Section
      title="Steam"
      desc="Gry zainstalowane są odczytywane z plików Steam na dysku (bez logowania). Pełną listę posiadanych gier daje oficjalne Steam Web API — wymaga osobistego klucza."
    >
      <dl className="facts facts--compact">
        <div className="facts__row">
          <dt>Klient Steam</dt>
          <dd>{statusText}</dd>
        </div>
        {steam.installPath && (
          <div className="facts__row">
            <dt>Instalacja</dt>
            <dd>{steam.installPath}</dd>
          </div>
        )}
        {steam.libraryFolders.length > 0 && (
          <div className="facts__row">
            <dt>Biblioteki</dt>
            <dd>{steam.libraryFolders.join(' · ')}</dd>
          </div>
        )}
        <div className="facts__row">
          <dt>Konto (SteamID64)</dt>
          <dd>{steam.activeSteamId ?? 'nie wykryto'}</dd>
        </div>
        <div className="facts__row">
          <dt>Biblioteka konta</dt>
          <dd>{accountText}</dd>
        </div>
      </dl>
      <SecretField name="steamWebApiKey" label="Klucz Steam Web API" has={settings.hasSteamWebKey} />
      <p className="card__desc">
        Klucz wygenerujesz na stronie{' '}
        <button className="link" data-nav onClick={() => void api().app.openExternal('https://steamcommunity.com/dev/apikey')}>
          steamcommunity.com/dev/apikey
        </button>
        . Klucz jest przechowywany lokalnie{settings.secretsEncrypted ? ' i szyfrowany (Windows DPAPI)' : ''}.
      </p>
      <div className="field-row">
        <label>Inne SteamID64 (opcjonalnie)</label>
        <TextField label="SteamID64" placeholder="automatycznie" value={steamId} onChange={setSteamId} onSubmit={(v) => void patch({ steamIdOverride: v.trim() })} />
        <button className="btn" data-nav onClick={() => void patch({ steamIdOverride: steamId.trim() })}>
          Zastosuj
        </button>
      </div>
      <div className="modal__row">
        <button
          className="btn btn--primary"
          data-nav
          onClick={() =>
            void attempt(api().library.refresh(true)).then((s) => s && useStore.getState().toast(`Odświeżono: ${gameCountLabel(s.games.length)}`))
          }
        >
          Odśwież bibliotekę
        </button>
        <button className="btn" data-nav onClick={() => void attempt(api().game.openInSteam('', 'downloads'))}>
          Pobieranie w Steam
        </button>
      </div>
      <div className="modal__row">
        <span className="details__muted">
          Family Sharing: {family?.loggedIn ? `${gameCountLabel(family.count)} z biblioteki rodzinnej` : 'wymaga zalogowania do Steam (klucz Web API tu nie działa)'}
          {family?.error ? ` · ${family.error}` : ''}
        </span>
        <button className="btn" data-nav onClick={() => void attempt(family?.loggedIn ? api().library.familyLogout() : api().library.familyLogin()).then((s) => s && setFamily(s))}>
          {family?.loggedIn ? 'Wyloguj Family Sharing' : 'Zaloguj do Steam'}
        </button>
      </div>
    </Section>
  )
}

/** data sources for which "SteamGridDB first" can be switched off */
const ART_SOURCES: [ArtDataSource, string, string][] = [
  ['steam', 'SteamGridDB przed grafikami Steam', 'Gry Steam: wyłączone — najpierw oficjalne grafiki Steam'],
  ['gog', 'SteamGridDB przed grafikami GOG', 'Gry GOG: wyłączone — najpierw grafiki z serwera EmuStart (folder GOG Managera)'],
  ['launchbox', 'SteamGridDB przed grafikami LaunchBox', 'Gry EmuStart: wyłączone — najpierw grafiki z serwera i bazy LaunchBox']
]

function ArtSection() {
  const settings = useStore((s) => s.settings)!
  return (
    <Section
      title="Grafiki (SteamGridDB)"
      desc="Plakaty, tła i logotypy mogą pochodzić ze SteamGridDB (wymaga darmowego klucza API) albo z oficjalnych grafik Steam. Pobrane obrazy są zapisywane w lokalnej pamięci podręcznej."
    >
      <SecretField name="sgdbApiKey" label="Klucz SteamGridDB" has={settings.hasSgdbKey} />
      <p className="card__desc">
        Klucz znajdziesz po zalogowaniu na{' '}
        <button className="link" data-nav onClick={() => void api().app.openExternal('https://www.steamgriddb.com/profile/preferences/api')}>
          steamgriddb.com → Preferences → API
        </button>
        .
      </p>
      <Toggle
        label="Najpierw grafiki ze SteamGridDB"
        desc={
          settings.artPriority === 'sgdbFirst'
            ? 'SteamGridDB, a przy braku wyników — grafiki źródła gry (dla źródeł włączonych niżej)'
            : 'Grafiki źródła gry (Steam, GOG, LaunchBox), a przy braku — SteamGridDB'
        }
        value={settings.artPriority === 'sgdbFirst'}
        onChange={(v) => void patch({ artPriority: v ? 'sgdbFirst' : 'steamFirst' })}
      />
      {settings.artPriority === 'sgdbFirst' &&
        ART_SOURCES.map(([src, label, desc]) => (
          <Toggle
            key={src}
            label={label}
            desc={desc}
            value={!settings.sgdbFirstOff.includes(src)}
            onChange={(v) =>
              void patch({ sgdbFirstOff: v ? settings.sgdbFirstOff.filter((s) => s !== src) : [...settings.sgdbFirstOff, src] })
            }
          />
        ))}
      <h3 className="card__desc">Własne klucze innych źródeł (IGDB, TheGamesDB)</h3>
      <p className="card__desc">Klucze zostają na tym urządzeniu, a zapytania idą wprost do tych usług, nie przez serwer EmuStart. Grafiki pojawią się w oknie „Grafiki” gry.</p>
      <SecretField name="igdbClientId" label="IGDB: Client ID" has={settings.hasIgdbId} />
      <SecretField name="igdbClientSecret" label="IGDB: Client Secret" has={settings.hasIgdbSecret} />
      <SecretField name="tgdbApiKey" label="Klucz TheGamesDB" has={settings.hasTgdbKey} />
      <KeysTransfer />
    </Section>
  )
}

/** the art source keys: from PyLinks on this PC, or an encrypted file between devices */
function KeysTransfer() {
  const [password, setPassword] = useState('')
  const toast = useStore((s) => s.toast)
  const imported = (s: unknown): void => {
    if (s) {
      useStore.getState().setSettings(s as AppSettings)
      toast('Zaimportowano klucze')
      setPassword('')
    }
  }
  return (
    <>
      <p className="card__desc">Przenoszenie kluczy: plik klucze-grafik.emustart jest zaszyfrowany hasłem wpisanym poniżej.</p>
      <div className="field-row">
        <label>Hasło pliku</label>
        <TextField type="password" label="Hasło pliku" placeholder="Hasło pliku z kluczami" value={password} onChange={setPassword} />
        <button className="btn" data-nav onClick={() => void attempt(api().art.keysImport(null, '')).then(imported)}>
          Importuj z PyLinks
        </button>
        <button
          className="btn"
          data-nav
          disabled={!password}
          onClick={async () => {
            const file = await pickPath({ kind: 'file', title: 'Plik z kluczami', extensions: ['emustart'] })
            if (file) imported(await attempt(api().art.keysImport(file, password)))
          }}
        >
          Importuj z pliku
        </button>
        <button
          className="btn"
          data-nav
          disabled={!password}
          onClick={async () => {
            const folder = await pickPath({ kind: 'folder', title: 'Gdzie zapisać plik z kluczami' })
            const f = folder && (await attempt(api().art.keysExport(folder, password)))
            if (f) {
              toast(`Zapisano: ${f}`)
              setPassword('')
            }
          }}
        >
          Eksportuj do pliku
        </button>
      </div>
    </>
  )
}

function LaunchBoxSection() {
  const [st, setSt] = useState<LaunchBoxStatus | null>(null)
  useEffect(() => {
    void api().launchbox.status().then(setSt)
    return api().launchbox.onChange(setSt)
  }, [])
  const job = st?.job
  const pct = job && job.total > 0 ? Math.floor((job.done / job.total) * 100) : null
  return (
    <Section
      title="Opisy gier spoza Steama (LaunchBox)"
      desc="Gry dodane do Steama jako skróty (np. emulatory) nie mają danych w sklepie Steam. Lumen może pobrać otwartą bazę LaunchBox Games DB (~110 MB, ok. 190 tys. gier) i dopasowywać opisy, gatunki, producentów i daty premiery lokalnie, bez sieci. Z tej bazy pochodzą też grafiki gier EmuStart (tła, pudełka, logo) — same obrazki pobierają się dopiero przy wyświetleniu."
    >
      <dl className="facts facts--compact">
        <div className="facts__row">
          <dt>Baza</dt>
          <dd>
            {st?.ready
              ? `${st.games?.toLocaleString('pl-PL')} gier · ${st.images ? `${st.images.toLocaleString('pl-PL')} grafik · ` : ''}${formatBytes(st.sizeBytes) ?? ''} · zaktualizowano ${st.updated ? new Date(st.updated).toLocaleDateString('pl-PL') : '?'}${st.outdated ? ' · bez listy grafik — Lumen przebuduje bazę sam' : ''}`
              : 'nie pobrano'}
          </dd>
        </div>
      </dl>
      {job && (
        <div className="download">
          <div className="download__head">
            <strong>{job.phase === 'download' ? 'Pobieranie Metadata.zip' : 'Budowanie bazy'}</strong>
            <span>
              {job.phase === 'download'
                ? `${formatBytes(job.done) ?? '0 B'}${job.total ? ` z ${formatBytes(job.total)}` : ''}`
                : `${job.done.toLocaleString('pl-PL')} gier`}
            </span>
          </div>
          {pct !== null && (
            <div className="download__bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      {st?.error && <p className="card__desc notice__warn">Ostatnia próba nie powiodła się: {st.error}</p>}
      <div className="modal__row">
        {job ? (
          <button className="btn" data-nav onClick={() => void api().launchbox.cancel()}>
            Przerwij
          </button>
        ) : (
          <button className="btn btn--primary" data-nav onClick={() => void attempt(api().launchbox.update()).then((s) => s && setSt(s))}>
            {st?.ready ? 'Zaktualizuj bazę LaunchBox' : 'Pobierz bazę LaunchBox'}
          </button>
        )}
      </div>
    </Section>
  )
}

function CategoriesSection() {
  const prefs = useStore((s) => s.prefs)!
  const snapshot = useStore((s) => s.snapshot)!
  const nav = useNav()
  const [prompt, setPrompt] = useState<{ mode: 'new' } | { mode: 'rename'; cat: Category } | null>(null)
  const [confirm, setConfirm] = useState<Category | null>(null)
  const cols = sortedCategories(prefs).filter((c) => c.kind === 'custom' || c.kind === 'steam')
  const pins = prefs.pinnedGroups
  const kindLabel = (c: Category): string => {
    const count = collectionGames(c, snapshot.games, prefs, snapshot.collections).length
    if (c.kind !== 'steam') return `własna · ${gameCountLabel(count)}`
    const total = snapshot.collections?.find((col) => col.id === c.steamCollectionId)?.appIds.length ?? 0
    if (total === 0) return 'kolekcja Steam · pusta'
    if (count === 0) return `kolekcja Steam · ${total} pozycji, żadna nie jest w bibliotece`
    return `kolekcja Steam · ${gameCountLabel(count)}`
  }
  const dynamic = (snapshot.collections ?? []).filter((c) => c.dynamic)
  const setPin = async (id: string, on: boolean): Promise<void> => {
    const p = await attempt(api().prefs.setGroupPinned(id, on))
    if (p) useStore.getState().setPrefs(p)
  }
  const move = async (id: string, delta: number): Promise<void> => {
    const p = await attempt(api().prefs.moveGroupPin(id, delta))
    if (p) useStore.getState().setPrefs(p)
  }
  const pinName = (id: string): string => {
    const hit = findSub(nav, id)
    if (hit) return hit.group.id === 'col' ? hit.sub.label : `${hit.group.label} › ${hit.sub.id.endsWith('/all') ? 'Wszystkie' : hit.sub.label}`
    return `${id} (teraz pusta — wróci, gdy pojawią się gry)`
  }

  return (
    <Section
      title="Szybki dostęp i kolekcje"
      desc="Biblioteka jest podzielona na PC, Komputery, Konsole, Arcade (i Pozostałe) z podgrupami — w obu trybach. Przypięte podgrupy (np. PS2 albo GOG) są dodatkowymi zakładkami na górnym pasku i pierwszymi pozycjami karuzeli w trybie TV. Przypinasz je przyciskiem „Przypnij” przy podgrupach albo tutaj (kolekcje)."
    >
      <h3 className="cats__heading">Przypięte ({pins.length})</h3>
      <div className="cats" data-nav-group="pins">
        {pins.map((id, i) => (
          <div key={id} className="cats__row is-pinned">
            <span className="cats__name">{pinName(id)}</span>
            <button className="btn btn--sm" data-nav aria-label="W górę" disabled={i === 0} onClick={() => void move(id, -1)}>
              ↑
            </button>
            <button className="btn btn--sm" data-nav aria-label="W dół" disabled={i === pins.length - 1} onClick={() => void move(id, 1)}>
              ↓
            </button>
            <button className="btn btn--sm btn--on" data-nav onClick={() => void setPin(id, false)}>
              Odepnij
            </button>
          </div>
        ))}
        {!pins.length && <p className="card__desc">Nic nie jest przypięte — na pasku są Start, grupy biblioteki i Ustawienia.</p>}
      </div>
      <h3 className="cats__heading">Kolekcje ({cols.length})</h3>
      <div className="cats" data-nav-group="collections">
        {cols.map((c) => {
          const pinned = pins.includes(`col/${c.id}`)
          return (
            <div key={c.id} className={`cats__row ${pinned ? 'is-pinned' : ''}`}>
              <span className="cats__name">
                {c.name}
                <small>{kindLabel(c)}</small>
              </span>
              <button className={`btn btn--sm ${pinned ? 'btn--on' : ''}`} data-nav data-key={`pin-${c.id}`} onClick={() => void setPin(`col/${c.id}`, !pinned)}>
                {pinned ? 'Odepnij' : 'Przypnij'}
              </button>
              {c.kind === 'custom' && (
                <>
                  <button className="btn btn--sm" data-nav onClick={() => setPrompt({ mode: 'rename', cat: c })}>
                    Zmień nazwę
                  </button>
                  <button className="btn btn--sm btn--danger" data-nav onClick={() => setConfirm(c)}>
                    Usuń
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="modal__row">
        <button className="btn btn--primary" data-nav onClick={() => setPrompt({ mode: 'new' })}>
          Nowa kategoria
        </button>
      </div>
      {snapshot.collections === null && !snapshot.demo && (
        <p className="card__desc">Nie udało się odczytać kolekcji Steam (brak Steam lub konta na tym komputerze).</p>
      )}
      {dynamic.length > 0 && (
        <p className="card__desc">
          Kolekcje dynamiczne Steam nie są pokazywane, bo Steam wylicza je z własnych danych o grach, których Lumen nie ma:{' '}
          {dynamic.map((c) => c.name).join(', ')}.
        </p>
      )}
      {prompt && (
        <NamePrompt
          title={prompt.mode === 'new' ? 'Nowa kategoria' : 'Zmień nazwę kategorii'}
          initial={prompt.mode === 'rename' ? prompt.cat.name : ''}
          onClose={() => setPrompt(null)}
          onSubmit={async (name) => {
            const r = await attempt(prompt.mode === 'new' ? api().prefs.createCategory(name) : api().prefs.renameCategory(prompt.cat.id, name))
            if (r) setPrompt(null)
          }}
        />
      )}
      {confirm && (
        <Modal title={`Usunąć kategorię „${confirm.name}”?`} onClose={() => setConfirm(null)}>
          <p className="card__desc">Gry nie zostaną usunięte — zniknie tylko to przypisanie.</p>
          <div className="modal__footer">
            <button className="btn" data-nav data-autofocus onClick={() => setConfirm(null)}>
              Anuluj
            </button>
            <button
              className="btn btn--danger"
              data-nav
              onClick={async () => {
                await attempt(api().prefs.deleteCategory(confirm.id))
                if (pins.includes(`col/${confirm.id}`)) await setPin(`col/${confirm.id}`, false)
                setConfirm(null)
              }}
            >
              Usuń
            </button>
          </div>
        </Modal>
      )}
    </Section>
  )
}

function GogSection() {
  const settings = useStore((s) => s.settings)!
  const gog = useStore((s) => s.snapshot?.gog)
  const emu = useStore((s) => s.snapshot?.emustart)
  const [lang, setLang] = useState('')
  const langs = settings.gogLanguages
  const setLangs = (v: string[]): void => void patch({ gogLanguages: v })
  return (
    <Section
      title="Gry GOG z serwera EmuStart"
      desc="Gry GOG z archiwum depotów na serwerze EmuStart (folder ustawia administrator w panelu serwera). Instalacja idzie wprost z serwera do folderu gry — bez GOG Galaxy, bez internetu i bez kopii archiwum na tym komputerze. Zainstalowane gry działają bez serwera. Ustawienia są wspólne dla obu trybów."
    >
      <dl className="facts facts--compact">
        <div className="facts__row">
          <dt>Katalog GOG na serwerze</dt>
          <dd>
            {emu?.engine !== 'ready'
              ? 'silnik EmuStart nie działa'
              : gog?.fromCache
                ? `ostatnia kopia (${gog.games} gier)${gog.error ? ` — ${gog.error}` : ''}`
                : `${gog?.games ?? 0} gier`}
          </dd>
        </div>
      </dl>
      <PathRow
        label="Wspólny folder gier GOG"
        value={settings.gogInstallDir}
        fallback="domyślny"
        pick={{ kind: 'folder', title: 'Folder na gry GOG (każda gra dostaje własny podfolder)' }}
        onChange={(v) => void patch({ gogInstallDir: v })}
      />
      <p className="card__desc">
        Zmiana dotyczy przyszłych instalacji — zainstalowane gry zostają na miejscu (nic nie jest przenoszone ani usuwane).
        Folder nie może leżeć w pamięci podręcznej gier emulowanych (jest czyszczona automatycznie).
      </p>
      <div className="field-row">
        <label>Domyślne języki (kolejność = pierwszeństwo)</label>
        <span className="chips">
          {langs.map((l, i) => (
            <button key={l} className="chip is-on" data-nav title="Usuń" onClick={() => langs.length > 1 && setLangs(langs.filter((x) => x !== l))}>
              {i + 1}. {langName(l)} ✕
            </button>
          ))}
        </span>
        <TextField label="Kod języka (np. de)" placeholder="kod, np. de" value={lang} onChange={setLang} onSubmit={(v) => {
          const c = v.trim().toLowerCase()
          if (/^[a-z]{2,3}$/.test(c) && !langs.includes(c)) setLangs([...langs, c])
          setLang('')
        }} />
      </div>
      <p className="card__desc">
        Przy instalacji zaznaczone są te z domyślnych języków, które serwer ma kompletne dla danej gry. Gdy żadnego nie ma,
        okno instalacji prosi o wybór — język nie jest po cichu zmieniany na angielski.
      </p>
      <div className="modal__row">
        <button className="btn" data-nav disabled={emu?.engine !== 'ready'} onClick={async () => {
          const r = await attempt(api().gog.refresh())
          if (r) useStore.getState().toast(r.ok ? (r.message ?? 'Gotowe') : r.error, r.ok ? 'info' : 'error')
        }}>
          Odśwież katalog GOG z serwera
        </button>
      </div>
      <p className="card__desc">
        Nie obsługiwane w tej wersji: aktualizacja zainstalowanej gry do nowego buildu (Lumen pokazuje, że serwer ma nowszy;
        nowy build — usuń grę i zainstaluj ponownie) oraz synchronizacja zapisów gier PC.
      </p>
    </Section>
  )
}

function NamePrompt({ title, initial, onClose, onSubmit }: { title: string; initial: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}>
      <TextField label={title} value={v} onChange={setV} onSubmit={(x) => x.trim() && onSubmit(x)} />
      <div className="modal__footer">
        <button className="btn" data-nav onClick={onClose}>
          Anuluj
        </button>
        <button className="btn btn--primary" data-nav disabled={!v.trim()} onClick={() => onSubmit(v)}>
          Zapisz
        </button>
      </div>
    </Modal>
  )
}

function InterfaceSection() {
  const settings = useStore((s) => s.settings)!
  return (
    <Section
      title="Tryb interfejsu"
      desc="Dwa wyglądy tej samej aplikacji: pulpit (ten widok) i tryb TV w stylu EmuStart — z tą samą biblioteką, ustawieniami i listą zadań. Przełączanie nie przerywa pobierania ani gry: F10 albo View + Start na padzie."
    >
      <div className="modal__row">
        <button className="btn btn--primary" data-nav onClick={() => void api().ui.setMode('fullscreen')}>
          Przełącz na tryb TV
        </button>
      </div>
      <Toggle
        label="Uruchamiaj w trybie TV"
        desc="Przy starcie od razu tryb pełnoekranowy w stylu EmuStart."
        value={settings.startMode === 'fullscreen'}
        onChange={(v) => void patch({ startMode: v ? 'fullscreen' : 'desktop' })}
      />
    </Section>
  )
}

function EmustartSection() {
  const settings = useStore((s) => s.settings)!
  const emu = useStore((s) => s.snapshot?.emustart)
  const [es, setEs] = useState<EmuSettings | null>(null)
  const ready = emu?.engine === 'ready'
  useEffect(() => {
    if (ready) void api().emustart.settings().then(setEs).catch(() => setEs(null))
  }, [ready])

  const engineText =
    emu?.engine === 'ready'
      ? `działa (EmuStart ${emu.version ?? '?'})`
      : emu?.engine === 'starting'
        ? 'uruchamianie…'
        : emu?.engine === 'disabled'
          ? 'wyłączony'
          : `nie działa — ${emu?.message ?? 'brak szczegółów'}`
  const serverText = !emu?.server
    ? 'nie zalogowano'
    : emu.server.ok
      ? `połączono${emu.server.name ? ` (${emu.server.name})` : ''}${es?.serverVia ? ` · przez: ${es.serverVia}` : ''}`
      : emu.server.key_rejected
        ? 'serwer nie przyjmuje tego urządzenia (wylogowane w panelu serwera albo zastąpione innym logowaniem) — zaloguj się ponownie w trybie TV'
        : emu.server.checking
          ? 'łączenie…'
          : 'serwer nie odpowiada (pobrane gry działają bez niego)'

  return (
    <Section
      title="EmuStart"
      desc="Gry na emulowane platformy z serwera EmuStart. Pobieranie, emulatory i BIOS-y z serwera, uruchamianie i synchronizację zapisów wykonuje silnik EmuStart (ten sam kod co program EmuStart) — Lumen go uruchamia i pokazuje jego stan."
    >
      <div className="modal__row">
        <span className="card__desc">Gry z kilkoma wersjami (regiony) — domyślnie pokazuj:</span>
        <div className="segmented" role="group" aria-label="Preferowany region">
          {(
            [
              ['europe', 'Polska / Europa'],
              ['usa', 'USA'],
              ['japan', 'Japonia']
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={`seg ${settings.regionOrder === v ? 'is-on' : ''}`} data-nav onClick={() => void patch({ regionOrder: v })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label="Gry z serwera EmuStart"
        desc="Wyłączone: silnik EmuStart nie jest uruchamiany, w bibliotece zostają tylko gry Steam."
        value={settings.emustartEnabled}
        onChange={(v) => void patch({ emustartEnabled: v })}
      />
      <dl className="facts facts--compact">
        <div className="facts__row">
          <dt>Silnik</dt>
          <dd>{engineText}</dd>
        </div>
        <div className="facts__row">
          <dt>Serwer</dt>
          <dd>{serverText}</dd>
        </div>
        {es?.account && (
          <div className="facts__row">
            <dt>Konto</dt>
            <dd>
              {es.account}
              {emu?.profile ? ` · profil ${emu.profile}` : ''}
            </dd>
          </div>
        )}
        {emu && (
          <div className="facts__row">
            <dt>Biblioteka</dt>
            <dd>
              {emu.systems.length
                ? `${emu.systems.length} platform, ${gameCountLabel(emu.systems.reduce((n, x) => n + x.games, 0))}`
                : 'pusta'}
              {emu.fromCache ? ' (ostatnia zapisana kopia — silnik nie działa)' : ''}
            </dd>
          </div>
        )}
        {es && (
          <>
            <div className="facts__row">
              <dt>Folder emulatorów</dt>
              <dd>{es.emuRoot || 'nie wybrano'}</dd>
            </div>
            <div className="facts__row">
              <dt>Pobrane gry</dt>
              <dd>
                {es.cacheDir} · ostatnie {es.cacheRecent} + zachowane
              </dd>
            </div>
            <div className="facts__row">
              <dt>Dane EmuStart</dt>
              <dd>{es.dataDir}</dd>
            </div>
          </>
        )}
      </dl>
      {ready && (
        <div className="modal__row">
          <button className="btn" data-nav onClick={() => void chooseEmuFolder('emu_root', 'Folder emulatorów', es?.emuRoot, setEs)}>
            Folder emulatorów…
          </button>
          <button className="btn" data-nav onClick={() => void chooseEmuFolder('cache_dir', 'Folder pobranych gier', es?.cacheDir, setEs)}>
            Folder pobranych gier…
          </button>
          <button
            className="btn"
            data-nav
            onClick={async () => {
              const r = await attempt(api().emustart.refreshLibrary())
              if (r) useStore.getState().toast(r.ok ? (r.message ?? 'Odświeżanie…') : (r.error ?? 'Błąd'), r.ok ? 'info' : 'error')
            }}
          >
            Odśwież bibliotekę z serwera
          </button>
        </div>
      )}
      <div className="modal__row">
        <button className="btn btn--primary" data-nav onClick={() => void (emu?.server ? logoutFlow() : loginFlow())}>
          {emu?.server ? 'Wyloguj z serwera' : 'Zaloguj do serwera'}
        </button>
        {emu?.engine === 'ready' && (
          <button className="btn" data-nav onClick={() => useStore.getState().setProfiles('normal')}>
            Profile (kto gra, PIN, RetroAchievements)
          </button>
        )}
        {emu?.engine === 'ready' && (
          <button className="btn" data-nav onClick={() => useStore.getState().setPads(true)}>
            Kolejność padów
          </button>
        )}
        {emu?.engine === 'ready' && (
          <button className="btn" data-nav onClick={() => useStore.getState().setControllers(true)}>
            Kontrolery (nazwy, profile gier)
          </button>
        )}
      </div>
      {emu?.engine === 'ready' && (
        <div className="modal__row">
          <button className="btn" data-nav onClick={() => void detectEmulators()}>
            Wykryj emulatory
          </button>
          <button className="btn" data-nav onClick={() => void installMissing()}>
            Pobierz brakujące emulatory
          </button>
        </div>
      )}
      <div className="modal__row">
        {emu?.engine !== 'disabled' && (
          <button className="btn" data-nav onClick={() => void api().emustart.restartEngine()}>
            Uruchom silnik ponownie
          </button>
        )}
      </div>
      <p className="card__desc">
        Logowanie do serwera (kod z panelu albo adres), konta i PIN-y profili są w ustawieniach EmuStart w trybie TV —
        pozostałe ustawienia EmuStart są w działach „Biblioteka EmuStart” i „Systemy”.
      </p>
      <PathRow
        label="Folder danych EmuStart"
        value={settings.emustartHome}
        fallback={`domyślny — folder Lumen${es?.dataDir && !settings.emustartHome ? ` (${es.dataDir})` : ''}`}
        pick={{ kind: 'folder', title: 'Folder danych EmuStart (np. folder istniejącej instalacji EmuStart)' }}
        onChange={(v) => void patch({ emustartHome: v })}
      />
      <p className="card__desc">
        Folder istniejącej instalacji EmuStart (z config.json, cache, profiles) zostaje użyty na miejscu — nic nie jest kopiowane ani
        kasowane. Nie uruchamiaj w tym czasie samodzielnego EmuStart z tego samego folderu (Lumen to sprawdza).
      </p>
      <PathRow
        label="Python dla silnika (wersja ze źródeł)"
        value={settings.pythonPath}
        fallback="domyślny — dołączony silnik albo „py -3”"
        pick={{ kind: 'file', title: 'Python (python.exe) dla silnika EmuStart', extensions: ['exe'] }}
        onChange={(v) => void patch({ pythonPath: v })}
      />
    </Section>
  )
}

/**
 * A file or folder setting: chosen only with the Windows dialog (never typed), shown read-only,
 * with a way back to the default. `onChange('')` = default.
 */
function PathRow({
  label,
  value,
  fallback,
  pick,
  onChange
}: {
  label: string
  value?: string
  fallback: string
  pick: Omit<PickPathOptions, 'start'>
  onChange: (v: string) => void
}) {
  return (
    <div className="path-row">
      <div className="path-row__text">
        <span className="path-row__label">{label}</span>
        <span className={`path-row__value ${value ? '' : 'is-default'}`} title={value || fallback}>
          {value || fallback}
        </span>
      </div>
      <button
        className="btn"
        data-nav
        onClick={async () => {
          // start in the current folder (or the one holding the current file)
          const start = value ? (pick.kind === 'file' ? value.replace(/[\\/][^\\/]*$/, '') : value) : undefined
          const v = await pickPath({ ...pick, start })
          if (v) onChange(v)
        }}
      >
        Wybierz…
      </button>
      {value && (
        <button className="btn btn--ghost" data-nav onClick={() => onChange('')}>
          Przywróć domyślny
        </button>
      )}
    </div>
  )
}

async function chooseEmuFolder(
  key: 'emu_root' | 'cache_dir',
  title: string,
  current: string | undefined,
  done: (s: EmuSettings) => void
): Promise<void> {
  const folder = await pickPath({ kind: 'folder', title, start: current || undefined })
  if (!folder) return
  const s = await attempt(api().emustart.setFolder(key, folder))
  if (s) done(s)
}

function BehaviourSection() {
  const settings = useStore((s) => s.settings)!
  const [fs, setFs] = useState(false)
  useEffect(() => void api().app.isFullscreen().then(setFs), [])
  return (
    <Section title="Zachowanie">
      <Toggle
        label="Pad przez XInput (zalecane)"
        desc={
          settings.xinputAvailable === false
            ? 'XInput niedostępny na tym komputerze — używany jest Gamepad API przeglądarki.'
            : settings.gamepadBackend === 'xinput'
              ? 'Lumen tylko odczytuje stan pada, jak gry, i nie inicjalizuje urządzeń. Działa z padami Xbox i padami widzianymi jako Xbox (Steam Input, tryb X).'
              : 'Gamepad API przeglądarki: obsługuje też pady PlayStation/Switch bez Steam Input, ale może zakłócać podłączanie pada w trakcie działania Lumen.'
        }
        value={settings.gamepadBackend === 'xinput' && settings.xinputAvailable !== false}
        onChange={(v) => void patch({ gamepadBackend: v ? 'xinput' : 'chromium' })}
      />
      <Toggle
        label="Minimalizuj po uruchomieniu gry"
        desc="Lumen schodzi z drogi grze i nie reaguje na kontroler, gdy nie ma fokusu."
        value={settings.afterLaunch === 'minimize'}
        onChange={(v) => void patch({ afterLaunch: v ? 'minimize' : 'keep' })}
      />
      <Toggle
        label="Przywróć po zakończeniu gry (eksperymentalne)"
        desc="Na podstawie wartości RunningAppID, którą Steam zapisuje w rejestrze — nie dla każdej gry musi działać."
        value={settings.restoreAfterGame}
        onChange={(v) => void patch({ restoreAfterGame: v })}
      />
      <Toggle label="Uruchamiaj na pełnym ekranie" value={settings.startFullscreen} onChange={(v) => void patch({ startFullscreen: v })} />
      <Toggle
        label="Deck na pulpicie"
        desc="Belka platform nad tapetą, pod oknami programów. Zamknięcie okna Lumen go ukrywa — Lumen działa dalej (prawy klik na Decku → Zamknij Lumen)."
        value={settings.deck.enabled}
        onChange={(v) => void patch({ deck: { enabled: v } })}
      />
      <Toggle
        label="Pełny ekran teraz (F11)"
        value={fs}
        onChange={() => void api().app.toggleFullscreen().then(setFs)}
      />
      <Toggle
        label="Pokazuj narzędzia Steam"
        desc="Np. Steamworks Common Redistributables, środowiska uruchomieniowe."
        value={settings.showTools}
        onChange={(v) => void patch({ showTools: v })}
      />
    </Section>
  )
}

function DataSection() {
  const settings = useStore((s) => s.settings)!
  const [stats, setStats] = useState<CacheStats | null>(null)
  useEffect(() => void api().app.cacheStats().then(setStats), [])
  return (
    <Section title="Dane" desc="Kategorie, ulubione i wybory grafik są zapisane osobno i nie znikają po wyczyszczeniu pamięci podręcznej.">
      <div className="modal__row">
        <span className="card__desc">
          Pamięć podręczna grafik: {stats ? `${stats.files} plików, ${formatBytes(stats.bytes) ?? '0 B'}` : '…'}
        </span>
        <button
          className="btn"
          data-nav
          onClick={async () => {
            const s = await attempt(api().app.clearCache())
            if (s) {
              setStats(s)
              useStore.getState().toast('Wyczyszczono pamięć podręczną')
            }
          }}
        >
          Wyczyść pamięć podręczną
        </button>
        <button className="btn" data-nav onClick={() => void api().app.openLogs()}>
          Pokaż logi
        </button>
      </div>
      <Toggle
        label="Tryb demonstracyjny"
        desc="Zastępuje bibliotekę fikcyjnymi grami oznaczonymi „DEMO” — tylko do podglądu interfejsu."
        value={settings.demoMode}
        onChange={(v) => void patch({ demoMode: v })}
      />
      <div className="modal__row">
        <button className="btn btn--danger" data-nav onClick={() => void api().app.quit()}>
          Zamknij Lumen
        </button>
      </div>
    </Section>
  )
}

function HelpSection() {
  const rows: [string, string, string][] = [
    ['Nawigacja', 'Strzałki', 'D-pad / lewa gałka'],
    ['Wybierz', 'Enter / Spacja', 'A'],
    ['Wstecz', 'Esc / Backspace', 'B'],
    ['Ulubiona', 'F', 'X'],
    ['Szukaj', 'S, / lub Ctrl+F', 'Y'],
    ['Poprzednia / następna grupa (górny pasek)', 'Q / E', 'LB / RB'],
    ['Filtr: wszystkie / zainstalowane / niezainstalowane', 'PgUp / PgDn', 'LT / RT'],
    ['Ustawienia', 'O', 'Start (☰)'],
    ['Sortowanie w grupie', 'V', 'View (⧉)'],
    ['Pełny ekran', 'F11', '—']
  ]
  return (
    <Section title="Sterowanie">
      <table className="keys">
        <thead>
          <tr>
            <th>Akcja</th>
            <th>Klawiatura</th>
            <th>Kontroler</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, k, p]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{k}</td>
              <td>{p}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card__desc" data-nav tabIndex={0}>
        Jeśli kontroler steruje jednocześnie myszą, wyłącz w Steamie „Konfigurację pulpitu” (Steam Input) lub dodaj Lumen jako grę spoza Steam.
      </p>
    </Section>
  )
}
