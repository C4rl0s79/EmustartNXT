import { describe, expect, it, vi } from 'vitest'
import { DesktopLayerGuard, desktopLayer, handleOf, isBelowDesktop, pinPlan, type WinInfo } from '../src/main/desktopLayer'

const w = (hwnd: number, cls: string, visible = true): WinInfo => ({ hwnd: BigInt(hwnd), cls, visible })
const OWN = 99n

describe('desktopLayer', () => {
  it('takes the highest visible Progman or WorkerW', () => {
    const order = [w(1, 'Chrome_WidgetWin_1'), w(2, 'WorkerW', false), w(3, 'WorkerW'), w(4, 'Progman')]
    expect(desktopLayer(order)).toBe(3n)
  })

  it('falls back to Progman when no layer window is visible', () => {
    expect(desktopLayer([w(1, 'Notepad'), w(2, 'Progman', false)])).toBe(2n)
  })

  it('finds nothing without a desktop window', () => {
    expect(desktopLayer([w(1, 'Notepad')])).toBeUndefined()
  })
})

describe('isBelowDesktop', () => {
  it('is false when our window comes first', () => {
    expect(isBelowDesktop([w(1, 'Notepad'), w(99, 'Deck'), w(3, 'Progman')], OWN)).toBe(false)
  })

  it('is true when the desktop layer comes first (Explorer raised it)', () => {
    expect(isBelowDesktop([w(3, 'WorkerW'), w(99, 'Deck')], OWN)).toBe(true)
  })

  it('ignores an invisible WorkerW above us', () => {
    expect(isBelowDesktop([w(3, 'WorkerW', false), w(99, 'Deck'), w(4, 'Progman')], OWN)).toBe(false)
  })

  it('is true when our window is missing but the desktop layer is there (as winshell.py)', () => {
    expect(isBelowDesktop([w(3, 'Progman')], OWN)).toBe(true)
  })

  it('is false with neither our window nor a desktop layer', () => {
    expect(isBelowDesktop([w(1, 'Notepad')], OWN)).toBe(false)
  })
})

describe('pinPlan', () => {
  it('inserts right below the window lying just above the desktop layer', () => {
    const order = [w(1, 'Notepad'), w(99, 'Deck'), w(2, 'Explorer'), w(3, 'Progman')]
    expect(pinPlan(order, OWN)).toEqual({ kind: 'insertAfter', after: 2n })
  })

  it('does nothing when we already lie just above the layer', () => {
    expect(pinPlan([w(1, 'Notepad'), w(99, 'Deck'), w(3, 'WorkerW')], OWN)).toEqual({ kind: 'ok' })
  })

  it('works when our window was sent below the desktop', () => {
    const order = [w(1, 'Notepad'), w(3, 'WorkerW'), w(4, 'Progman'), w(99, 'Deck')]
    expect(pinPlan(order, OWN)).toEqual({ kind: 'insertAfter', after: 1n })
  })

  it('goes to the top when nothing lies above the layer', () => {
    expect(pinPlan([w(3, 'Progman'), w(99, 'Deck')], OWN)).toEqual({ kind: 'top' })
  })

  it('reports a missing desktop layer', () => {
    expect(pinPlan([w(1, 'Notepad'), w(99, 'Deck')], OWN)).toEqual({ kind: 'none' })
  })
})

describe('DesktopLayerGuard', () => {
  it('reports a failure inside the timer once instead of throwing every interval, and goes on checking', () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const errors: string[] = []
      const guard = new DesktopLayerGuard(() => {
        calls++
        throw new Error('WinAPI niedostępne')
      }, undefined, 3000, (e) => errors.push(e.message))
      guard.start()
      vi.advanceTimersByTime(9000)
      guard.stop()
      vi.advanceTimersByTime(9000)
      expect(calls).toBe(3)
      expect(errors).toEqual(['WinAPI niedostępne'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does nothing without visible windows', () => {
    expect(new DesktopLayerGuard(() => []).check()).toBe(0)
  })
})

describe('handleOf', () => {
  it('reads the HWND signed, as koffi returns it from GetWindow (a sign-extended handle matches)', () => {
    const b = Buffer.alloc(8)
    b.writeBigInt64LE(-2147483632n) // 0xFFFFFFFF80000010
    expect(handleOf(b)).toBe(-2147483632n)
    b.writeBigInt64LE(0x2024en)
    expect(handleOf(b)).toBe(0x2024en)
  })
})
