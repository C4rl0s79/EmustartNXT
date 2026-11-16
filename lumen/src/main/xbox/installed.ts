import { execFile } from 'node:child_process'
import { POWERSHELL } from '../systemTools'
import { log } from '../logger'

/**
 * Gry Xbox / Microsoft Store zainstalowane na tym komputerze (etap 19a, zgłoszenie 2026-11-16): pakiety Sklepu z
 * plikiem MicrosoftGame.config, który ma plik wykonywalny (DLC go nie ma — nie są grą do uruchomienia), i aplikacją
 * w manifeście — jej identyfikator uruchamia grę przez Windows (shell:AppsFolder\<rodzina>!<aplikacja>).
 */
export interface XboxInstalled {
  /** nazwa rodziny pakietu, np. 39EA002F.FF6DF_n746a19ndrrjg */
  pfn: string
  /** identyfikator uruchomienia: <rodzina>!<aplikacja> */
  aumid: string
  storeId: string
  titleId: string
  name: string
  location: string
}

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$out = @()
foreach ($p in Get-AppxPackage) {
  if ($p.IsFramework -or $p.IsResourcePackage -or -not $p.InstallLocation) { continue }
  $cfg = Join-Path $p.InstallLocation 'MicrosoftGame.config'
  if (-not (Test-Path -LiteralPath $cfg)) { continue }
  try { [xml]$c = Get-Content -LiteralPath $cfg -Raw; [xml]$m = Get-Content -LiteralPath (Join-Path $p.InstallLocation 'AppxManifest.xml') -Raw } catch { continue }
  $exe = @($c.Game.ExecutableList.Executable | Where-Object { $_.Name })
  $apps = @($m.Package.Applications.Application | Where-Object { $_.Id })
  if (-not $exe.Count -or -not $apps.Count) { continue }
  $app = ($apps | Where-Object { $_.Id -eq $exe[0].Id } | Select-Object -First 1)
  if (-not $app) { $app = $apps[0] }
  $out += [pscustomobject]@{ pfn = $p.PackageFamilyName; aumid = "$($p.PackageFamilyName)!$($app.Id)"; storeId = [string]$c.Game.StoreId; titleId = [string]$c.Game.TitleId; name = [string]$c.Game.ShellVisuals.DefaultDisplayName; location = $p.InstallLocation }
}
ConvertTo-Json -InputObject @($out) -Compress
`

/** Z wyniku PowerShell — tylko poprawne wpisy (nazwa rodziny i identyfikator uruchomienia bez znaków spoza zakresu). */
export function parseInstalled(text: string): XboxInstalled[] {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, '').trim() || '[]')
  } catch {
    return []
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  const out: XboxInstalled[] = []
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  for (const r of list as Record<string, unknown>[]) {
    const pfn = str(r?.pfn)
    const aumid = str(r?.aumid)
    if (!/^[\w.-]+_[a-z0-9]{13}$/i.test(pfn) || !/^[\w.-]+_[a-z0-9]{13}![\w.-]+$/i.test(aumid)) continue
    out.push({ pfn, aumid, storeId: str(r.storeId).toUpperCase(), titleId: str(r.titleId).toLowerCase(), name: str(r.name), location: str(r.location) })
  }
  return out
}

/** null — odczyt nieudany (błąd PowerShell, limit czasu): wywołujący zostawia poprzednią listę */
export function scanInstalled(timeoutMs = 60_000): Promise<XboxInstalled[] | null> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) {
          log.warn('xbox', `gry zainstalowane: ${err.message}`)
          return resolve(null)
        }
        resolve(parseInstalled(String(stdout ?? '')))
      }
    )
  })
}
