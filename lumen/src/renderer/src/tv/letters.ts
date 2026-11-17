import type { Game } from '@shared/types'

// Skok po literach (RT / LT) na liście gier trybu TV. Litera pochodzi z klucza sortowania (`sortName` — bez „The”,
// „A”, „An”), nie z tytułu: lista jest ułożona po kluczu, więc „The Witcher” stoi wśród gier na W. Litera z tytułu
// (T) przerywała skok — z A do B trzeba było nacisnąć kilka razy (zgłoszenie 2026-11-16).
// Gry jednej serii stoją razem pod nazwą serii (shared/series.ts arrangeSeries): ich litera to litera serii
// (`keyOf` — seriesSortKeys), inaczej skok zatrzymywał się w środku bloku serii (Amiga WHDLoad, 2026-11-17).

const POLISH = /[ĄĆĘŁŃÓŚŹŻ]/
/** pierwsza litera klucza; akcent spoza polskiego alfabetu (É, Ü) — jak bez niego, bo tak sortuje lista */
function firstLetter(key: string): string {
  const raw = key.trim().charAt(0).toUpperCase()
  const c = POLISH.test(raw) ? raw : raw.normalize('NFKD').charAt(0)
  return /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(c) ? c : '#'
}

export const letterOf = (g: Game, keyOf?: (g: Game) => string | undefined): string =>
  firstLetter(keyOf?.(g) ?? (g.sortName || g.name))

/** Indeks gry po skoku: do pierwszej gry następnej litery (`dir` 1) albo do pierwszej gry poprzedniej (-1). */
export function letterJump(games: Game[], idx: number, dir: 1 | -1, keyOf?: (g: Game) => string | undefined): number {
  if (!games.length) return 0
  const at = Math.max(0, Math.min(games.length - 1, idx))
  const letter = (i: number): string => letterOf(games[i], keyOf)
  const cur = letter(at)
  for (let i = at + dir; i >= 0 && i < games.length; i += dir) {
    if (letter(i) !== cur) {
      if (dir < 0) {
        const l = letter(i)
        while (i > 0 && letter(i - 1) === l) i--
      }
      return i
    }
  }
  return dir > 0 ? games.length - 1 : 0
}
