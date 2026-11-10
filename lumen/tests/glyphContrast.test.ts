import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrast } from '../src/renderer/src/tv/themes'

// The pad buttons in the hints (desktop .glyph--*, TV .tv-btn--*) take their colours from the --glyph-*
// tokens in styles.css. Their label is read at a glance from the couch: ≥ 4.5:1 against its ink.
const css = readFileSync(path.join(__dirname, '../src/renderer/src/styles.css'), 'utf8')
const token = (name: string): string => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`--${name} not found in styles.css`)
  return m[1]
}

describe('pad button colours', () => {
  it.each([
    ['glyph-a', '#ffffff'],
    ['glyph-b', '#ffffff'],
    ['glyph-x', '#ffffff'],
    ['glyph-y', token('glyph-y-ink')]
  ])('%s keeps 4.5:1 with its label', (name, ink) => {
    expect(contrast(token(name), ink)).toBeGreaterThanOrEqual(4.5)
  })

  it('no hint button keeps a hard-coded colour of its own', () => {
    const tv = readFileSync(path.join(__dirname, '../src/renderer/src/tv/tv.css'), 'utf8')
    for (const b of ['a', 'b', 'x', 'y']) {
      expect(tv).toMatch(new RegExp(`\\.tv-btn--${b} \\{\\s*background: var\\(--glyph-${b}\\)`))
    }
  })
})
