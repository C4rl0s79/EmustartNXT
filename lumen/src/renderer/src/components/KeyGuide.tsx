import { useState } from 'react'
import { api, attempt } from '../store'

// "Jak zdobyć klucz?" — short guides next to every key and identifier in Ustawienia → Zaawansowane: the steps on
// the service's own site, a button to the full guide on the project's wiki and one to the service's page (in the
// browser, without Lumen's administrator rights).
// Collapsed by default, so the page stays short; the pad opens it with A like any other button.

export type GuideId = 'steam' | 'sgdb' | 'igdb' | 'tgdb' | 'azure'

/** the full guides: the project's wiki on GitHub (sources in lumen/docs/wiki, published by scripts/publish_wiki.py) */
const WIKI = 'https://github.com/C4rl0s79/EmustartNXT/wiki/'

interface Guide {
  title: string
  /** the wiki page with the full guide */
  wiki: string
  steps: string[]
  links: [string, string][]
  note?: string
}

export const GUIDES: Record<GuideId, Guide> = {
  steam: {
    wiki: 'Klucz-Steam-Web-API',
    title: 'Jak zdobyć klucz Steam Web API?',
    steps: [
      'Zaloguj się na steamcommunity.com tym kontem Steam, którego biblioteki używasz (Steam wydaje klucz kontom z co najmniej jednym zakupem).',
      'Otwórz stronę „Register Steam Web API Key” (przycisk niżej).',
      'W polu „Domain Name” wpisz dowolną nazwę, np. localhost, zaakceptuj warunki i naciśnij „Register”.',
      'Skopiuj klucz (32 znaki) i wklej go w pole „Klucz Steam Web API” wyżej, potem „Zapisz”.'
    ],
    links: [['Otwórz stronę klucza Steam', 'https://steamcommunity.com/dev/apikey']],
    note: 'Gdy lista gier konta zostaje pusta: w profilu Steam ustaw „Szczegóły gier” jako publiczne. Klucza nie podawaj nikomu — Lumen trzyma go tylko na tym komputerze.'
  },
  sgdb: {
    wiki: 'Klucz-SteamGridDB',
    title: 'Jak zdobyć klucz SteamGridDB?',
    steps: [
      'Zaloguj się na steamgriddb.com (np. kontem Steam — przycisk „Login” w prawym górnym rogu).',
      'Otwórz Preferences → API (przycisk niżej).',
      'Naciśnij „Generate API Key” i skopiuj klucz.',
      'Wklej go w pole „Klucz SteamGridDB” wyżej i naciśnij „Zapisz”.'
    ],
    links: [['Otwórz ustawienia API SteamGridDB', 'https://www.steamgriddb.com/profile/preferences/api']]
  },
  igdb: {
    wiki: 'Klucze-IGDB',
    title: 'Jak zdobyć klucze IGDB (Twitch)?',
    steps: [
      'IGDB należy do Twitcha: potrzebne jest konto Twitch z włączonym uwierzytelnianiem dwuskładnikowym (Twitch → Ustawienia → Bezpieczeństwo).',
      'Otwórz konsolę deweloperów Twitch (przycisk niżej) i zaloguj się.',
      'Applications → „Register Your Application”: nazwa dowolna (np. Lumen), OAuth Redirect URL: http://localhost, kategoria: Application Integration, typ klienta: Confidential → „Create”.',
      'Przy aplikacji „Manage”: skopiuj „Client ID”, potem „New Secret” i skopiuj „Client Secret”.',
      'Wklej oba w pola „IGDB: Client ID” i „IGDB: Client Secret” wyżej.'
    ],
    links: [
      ['Otwórz konsolę Twitch', 'https://dev.twitch.tv/console/apps'],
      ['Dokumentacja IGDB', 'https://api-docs.igdb.com/#account-creation']
    ],
    note: 'Te same klucze wpisuje się w panelu serwera EmuStart, gdy serie gier ma sprawdzać serwer.'
  },
  tgdb: {
    wiki: 'Klucz-TheGamesDB',
    title: 'Jak zdobyć klucz TheGamesDB?',
    steps: [
      'Załóż konto na forum TheGamesDB i zaloguj się.',
      'Poproś o klucz API w dziale próśb o dostęp do API (przycisk niżej) — klucz przydzielają administratorzy serwisu, zwykle w ciągu kilku dni.',
      'Gdy dostaniesz klucz („public” wystarczy), wklej go w pole „Klucz TheGamesDB” wyżej.'
    ],
    links: [
      ['Otwórz forum TheGamesDB', 'https://forums.thegamesdb.net/'],
      ['Strona API TheGamesDB', 'https://api.thegamesdb.net/']
    ],
    note: 'Klucz jest opcjonalny — to tylko dodatkowe źródło grafik w oknie „Grafiki” gry.'
  },
  azure: {
    wiki: 'Xbox-aplikacja-Azure',
    title: 'Jak zarejestrować własną aplikację Azure (tylko gdy domyślna nie działa)?',
    steps: [
      'Zwykle nic nie trzeba robić: Lumen loguje do Xbox przez swoją aplikację „Lumen Launcher”.',
      'Własna aplikacja: portal.azure.com → Microsoft Entra ID → Rejestracje aplikacji → „Nowa rejestracja”; nazwa dowolna, typ kont: „Tylko osobiste konta Microsoft”.',
      'W aplikacji: Uwierzytelnianie → „Dodaj platformę” → „Aplikacje mobilne i klasyczne” → wpisz adres przekierowania podany wyżej (przycisk „Kopiuj adres”) → „Konfiguruj”.',
      'Na stronie „Przegląd” skopiuj „Identyfikator aplikacji (klienta)” i wklej go w pole wyżej, potem „Zapisz identyfikator” i zaloguj się ponownie.'
    ],
    links: [['Otwórz rejestracje aplikacji Azure', 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade']],
    note: 'Bez adresu przekierowania „nativeclient” logowanie kończy się błędem dopiero po wpisaniu hasła na stronie Microsoft.'
  }
}

export function KeyGuide({ id }: { id: GuideId }) {
  const [open, setOpen] = useState(false)
  const g = GUIDES[id]
  return (
    <div className={`keyguide ${open ? 'is-open' : ''}`}>
      <button className="btn btn--ghost keyguide__toggle" data-nav aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {g.title}
      </button>
      {open && (
        <div className="keyguide__body selectable">
          <ol>
            {g.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {g.note && <p className="card__desc">{g.note}</p>}
          <div className="modal__row">
            <button className="btn" data-nav title={WIKI + g.wiki} onClick={() => void attempt(api().app.openExternal(WIKI + g.wiki))}>
              Pełny poradnik (wiki) ↗
            </button>
            {g.links.map(([label, url]) => (
              <button key={url} className="btn" data-nav title={url} onClick={() => void attempt(api().app.openExternal(url))}>
                {label} ↗
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
