import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Lumen starts with a PATH without System32 (Explorer, Task Scheduler, the updater): a Windows tool called by its
// bare name fails silently there (Steam looked closed, updates broke in 1.0.17–1.0.22). Every call site in the main
// process must use a full path (src/main/systemTools.ts) — this scan covers all of them, not only the files that bit.
const TOOLS = ['reg', 'powershell', 'cmd', 'schtasks', 'robocopy', 'tasklist', 'where', 'taskkill', 'wmic', 'net']
const CALL = new RegExp(`\\b(execFile|execFileSync|spawn|spawnSync|exec|execSync)\\(\\s*['"\`](${TOOLS.join('|')})(\\.exe)?['"\`]`, 'i')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) ? [p] : []
  })
}

describe('Windows tools by full path', () => {
  it('no main-process call runs a system tool by its bare name', () => {
    const hits: string[] = []
    for (const f of sources(path.join(__dirname, '..', 'src', 'main'))) {
      // a call split over lines: the tool name on the line after `execFile(`
      const text = readFileSync(f, 'utf8').replace(/\(\s*\r?\n\s*/g, '(')
      for (const line of text.split(/\r?\n/)) if (CALL.test(line)) hits.push(`${path.relative(process.cwd(), f)}: ${line.trim()}`)
    }
    expect(hits).toEqual([])
  })

  it('the scan sees a bare call (positive control)', () => {
    expect(CALL.test("execFile('powershell.exe', ['-NoProfile'])")).toBe(true)
    expect(CALL.test('execFile(POWERSHELL, [])')).toBe(false)
  })
})
