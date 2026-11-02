import { describe, expect, it } from 'vitest'
import { listTop } from '../src/renderer/src/tv/listWindow'

describe('TV game list window', () => {
  it('keeps the selection visible while moving', () => {
    expect(listTop(0, 5, 10, 75)).toBe(0)
    expect(listTop(0, 12, 10, 75)).toBe(3)
    expect(listTop(20, 15, 10, 75)).toBe(15)
  })

  it('never scrolls past the end of the list', () => {
    // the last game selected: a full screen of rows ending with it, not the game alone
    expect(listTop(74, 74, 10, 75)).toBe(65)
    // an index from the unfiltered list (200) clamped to a filtered list of 75
    expect(listTop(0, 200, 10, 75)).toBe(65)
    // a list shorter than the screen starts at its top
    expect(listTop(3, 4, 10, 5)).toBe(0)
    expect(listTop(0, 0, 10, 0)).toBe(0)
  })
})
