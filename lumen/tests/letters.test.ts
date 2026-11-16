import { describe, expect, it } from 'vitest'
import type { Game } from '@shared/types'
import { letterJump, letterOf } from '../src/renderer/src/tv/letters'

// lista jak w Lumenie: po kluczu sortowania bez przedimka („The Witcher” → „witcher”)
const g = (name: string): Game =>
  ({ id: name, name, sortName: name.toLowerCase().replace(/^(the|a|an)\s+/, '') }) as unknown as Game
const list = ['Alan Wake', 'The Adventures of Lomax', 'Amnesia', 'A Plague Tale', 'Arx Fatalis', 'Baldur’s Gate', 'The Banner Saga', 'Braid', 'Cyberpunk 2077']
  .map(g)
  .sort((a, b) => a.sortName.localeCompare(b.sortName, 'pl'))

describe('skok po literach (tryb TV)', () => {
  it('litera z klucza sortowania, nie z tytułu', () => {
    expect(letterOf(g('The Witcher 3'))).toBe('W')
    expect(letterOf(g('A Plague Tale'))).toBe('P')
    expect(letterOf(g('2064: Read Only Memories'))).toBe('#')
  })

  it('jedno naciśnięcie: z A na pierwszą grę na B, potem na C', () => {
    const i = list.findIndex((x) => x.name === 'Alan Wake')
    const b = letterJump(list, i, 1)
    expect(list[b].sortName.charAt(0)).toBe('b')
    expect(list[b - 1].sortName.charAt(0)).not.toBe('b')
    expect(list[letterJump(list, b, 1)].name).toBe('Cyberpunk 2077')
  })

  it('wstecz: na pierwszą grę poprzedniej litery', () => {
    const c = list.findIndex((x) => x.name === 'Cyberpunk 2077')
    const b = letterJump(list, c, -1)
    expect(list[b].sortName.charAt(0)).toBe('b')
    expect(b === 0 || list[b - 1].sortName.charAt(0) !== 'b').toBe(true)
  })

  it('krańce listy', () => {
    expect(letterJump(list, list.length - 1, 1)).toBe(list.length - 1)
    expect(letterJump(list, 0, -1)).toBe(0)
    expect(letterJump([], 0, 1)).toBe(0)
  })
})
