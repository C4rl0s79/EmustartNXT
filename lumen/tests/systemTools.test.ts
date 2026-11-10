import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Lumen starts with a PATH without System32 (Explorer, Task Scheduler, the updater): a Windows tool called by its
// bare name fails silently there (Steam looked closed, updates broke in 1.0.17–1.0.22). Every call site in the main
// process must use a full path (src/main/systemTools.ts) — this scan covers all of them, not only the files that bit.
// py: the python.org launcher lives in the Windows folder, not on a guaranteed PATH (systemTools.ts PY_LAUNCHER)
const TOOLS = ['reg', 'powershell', 'cmd', 'schtasks', 'robocopy', 'tasklist', 'where', 'taskkill', 'wmic', 'net', 'py']
// a bare name as the program ('powershell.exe') or at the start of a command string ('powershell -Command …');
// `.exec(` is RegExp.prototype.exec, never child_process
const CALL = new RegExp(
  `(?:\\b(?:execFile|execFileSync|spawn|spawnSync)|(?<![.\\w])(?:exec|execSync))\\(\\s*['"\`](?:${TOOLS.join('|')})(?:\\.exe)?(?:['"\`]|\\s)`,
  'i'
)

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
    expect(CALL.test("exec('powershell -NoProfile -Command x')")).toBe(true)
    expect(CALL.test("execSync('reg query HKCU')")).toBe(true)
    expect(CALL.test("spawn('py', ['-3', main])")).toBe(true)
    expect(CALL.test('execFile(POWERSHELL, [])')).toBe(false)
    expect(CALL.test("/^where$/.exec('where')")).toBe(false)
    expect(CALL.test("execFile('python3', [])")).toBe(false)
  })
})
