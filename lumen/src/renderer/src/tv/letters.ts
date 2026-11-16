import type { Game } from '@shared/types'

// Skok po literach (RT / LT) na liście gier trybu TV. Litera pochodzi z klucza sortowania (`sortName` — bez „The”,
// „A”, „An”), nie z tytułu: lista jest ułożona po kluczu, więc „The Witcher” stoi wśród gier na W. Litera z tytułu
// (T) przerywała skok — z A do B trzeba było nacisnąć kilka razy (zgłoszenie 2026-11-16).

export const letterOf = (g: Game): string => {
  const c = (g.sortName || g.name).trim().charAt(0).toUpperCase()
  return /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(c) ? c : '#'
}

/** Indeks gry po skoku: do pierwszej gry następnej litery (`dir` 1) albo do pierwszej gry poprzedniej (-1). */
export function letterJump(games: Game[], idx: number, dir: 1 | -1): number {
  if (!games.length) return 0
  const at = Math.max(0, Math.min(games.length - 1, idx))
  const cur = letterOf(games[at])
  for (let i = at + dir; i >= 0 && i < games.length; i += dir) {
    if (letterOf(games[i]) !== cur) {
      if (dir < 0) {
        const l = letterOf(games[i])
        while (i > 0 && letterOf(games[i - 1]) === l) i--
      }
      return i
    }
  }
  return dir > 0 ? games.length - 1 : 0
}
