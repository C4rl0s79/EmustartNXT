import { describe, expect, it, vi, beforeEach } from 'vitest'

// Lumen jako administrator: adresy (Steam, przeglądarka) przez powłokę bez uprawnień, autostart przez Harmonogram zadań
const spawned: { cmd: string; args: string[] }[] = []
const opened: string[] = []
vi.mock('electron', () => ({ shell: { openExternal: async (u: string) => void opened.push(u) } }))
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  spawn: (cmd: string, args: string[]) => {
    spawned.push({ cmd, args })
    return { unref: () => undefined }
  }
}))

const el = await import('../src/main/elevation')
const { EXPLORER } = await import('../src/main/systemTools')

describe('openUnelevated', () => {
  beforeEach(() => {
    spawned.length = 0
    opened.length = 0
  })

  it('z uprawnieniami: adres przez explorer.exe (Steam startuje bez uprawnień administratora)', async () => {
    el.setElevatedForTests(true)
    await el.openUnelevated('steam://rungameid/400')
    expect(spawned).toEqual([{ cmd: EXPLORER, args: ['steam://rungameid/400'] }])
    expect(opened).toEqual([])
  })

  it('bez uprawnień: jak dotąd shell.openExternal', async () => {
    el.setElevatedForTests(false)
    await el.openUnelevated('https://www.gog.com/')
    expect(opened).toEqual(['https://www.gog.com/'])
    expect(spawned).toEqual([])
  })
})

describe('autostartTaskXml', () => {
  const xml = el.autostartTaskXml('D:\\Lumen & Co\\Lumen.exe', ['--deck'], 'PC\\jan', 45)

  it('przy logowaniu tego użytkownika, z opóźnieniem, najwyższe uprawnienia', () => {
    expect(xml).toContain('<LogonTrigger><Enabled>true</Enabled><UserId>PC\\jan</UserId><Delay>PT45S</Delay></LogonTrigger>')
    expect(xml).toContain('<RunLevel>HighestAvailable</RunLevel>')
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>')
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>')
  })

  it('ścieżka i argumenty — znaki XML zakodowane', () => {
    expect(xml).toContain('<Command>D:\\Lumen &amp; Co\\Lumen.exe</Command>')
    expect(xml).toContain('<Arguments>--deck</Arguments>')
    expect(xml).toContain('<WorkingDirectory>D:\\Lumen &amp; Co</WorkingDirectory>')
  })

  it('domyślne opóźnienie — 30 s (np. Tailscale zdąży się połączyć)', () => {
    expect(el.AUTOSTART_DELAY_S).toBe(30)
    expect(el.autostartTaskXml('C:\\L\\Lumen.exe', [], 'PC\\a')).toContain('<Delay>PT30S</Delay>')
  })
})
