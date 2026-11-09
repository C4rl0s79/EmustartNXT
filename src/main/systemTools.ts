import path from 'node:path'

// Windows tools by full path: Lumen may start with a PATH without System32 (Explorer, Task Scheduler, the updater),
// and a bare "powershell.exe" then fails silently. tests/systemTools.test.ts refuses a bare name in src/main.

export const SYSTEM32 = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32')
export const POWERSHELL = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
