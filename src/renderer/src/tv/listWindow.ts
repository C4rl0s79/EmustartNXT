/**
 * First visible row of the TV game list: keeps the selection on screen and never scrolls past the
 * end — a list shorter than the screen starts at its top, a longer one ends with a full screen.
 * (Regression: a selection index taken from the unfiltered list left only the last game visible.)
 */
export function listTop(top: number, idx: number, visible: number, length: number): number {
  let t = top
  if (idx < t) t = idx
  else if (idx >= t + visible) t = idx - visible + 1
  return Math.max(0, Math.min(t, length - visible))
}
