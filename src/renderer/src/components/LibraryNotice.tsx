import { useStore } from '../store'
import { gameCountLabel, plural } from '../lib/format'

/**
 * Honest description of where the library comes from. Local detection is never presented
 * as the complete list of owned games.
 */
export function LibraryNotice({ compact }: { compact?: boolean }) {
  const snapshot = useStore((s) => s.snapshot)!
  const { account, demo, games, warnings } = snapshot

  if (demo) {
    return (
      <div className="notice notice--demo">
        <strong>Dane demonstracyjne.</strong> Wyświetlane gry są fikcyjne i służą tylko do podglądu interfejsu. Wyłącz tryb demo w
        Ustawieniach.
      </div>
    )
  }

  const local = games.filter((g) => g.provenance.includes('localManifest')).length
  const shortcuts = games.filter((g) => g.source === 'shortcut').length
  let accountText: string
  switch (account.state) {
    case 'ok':
      accountText = `Cała biblioteka konta: ${gameCountLabel(account.count)}${account.fromCache ? ' (z pamięci podręcznej)' : ''}.`
      break
    case 'private':
      accountText = 'Całej biblioteki konta nie widać, bo szczegóły gier w profilu Steam są prywatne.'
      break
    case 'error':
      accountText = account.message
      break
    case 'disabled':
      accountText =
        account.reason === 'noKey'
          ? 'Widać tylko gry wykryte na dysku. Dodaj klucz Steam Web API w Ustawieniach, aby zobaczyć całą bibliotekę konta.'
          : 'Nie ustalono konta Steam (SteamID), więc widać tylko gry wykryte na dysku.'
  }

  // On the home screen only problems are worth the space; the full explanation lives in the library.
  if (compact && account.state !== 'error' && !warnings.length) return null

  return (
    <div className={`notice ${compact ? 'notice--compact' : ''}`}>
      <span>
        Na dysku <strong>{gameCountLabel(local)}</strong>
        {shortcuts > 0 && (
          <>
            {' '}
            i <strong>{shortcuts}</strong> {plural(shortcuts, 'skrót', 'skróty', 'skrótów')} spoza Steam
          </>
        )}
        . {accountText}
      </span>
      {warnings.map((w) => (
        <span key={w} className="notice__warn">
          {w}
        </span>
      ))}
    </div>
  )
}
