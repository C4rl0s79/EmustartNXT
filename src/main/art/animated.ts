import { open } from 'node:fs/promises'

// Is a picture an animation? Read from its structure only, without decoding it:
// - APNG: an 'acTL' chunk before the first 'IDAT' (a plain PNG has none) — the chunks are walked one by one,
//   so large metadata before it (an ICC profile, XMP) does not hide it;
// - WebP: the extended header 'VP8X' with the animation flag;
// - GIF is not checked — a GIF is never made into a list copy anyway.
// The Deck's tiles ask for the original of an animated poster instead of its list copy (first frame).

/** reads `len` bytes at `offset` (fewer at the end of the file) */
type Read = (offset: number, len: number) => Promise<Buffer>

const PNG_SIG = '\x89PNG\r\n\x1a\n'
/** chunks walked at most — acTL is among the first ones in every APNG writer */
const MAX_CHUNKS = 64

export async function isAnimatedFrom(read: Read): Promise<boolean> {
  const head = await read(0, 21)
  if (head.length >= 21 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP')
    return head.toString('latin1', 12, 16) === 'VP8X' && (head[20] & 0x02) !== 0
  if (head.length < 8 || head.toString('latin1', 0, 8) !== PNG_SIG) return false
  let at = 8
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const c = await read(at, 8)
    if (c.length < 8) return false
    const type = c.toString('latin1', 4, 8)
    if (type === 'acTL') return true
    if (type === 'IDAT' || type === 'IEND') return false
    at += 12 + c.readUInt32BE(0)
  }
  return false
}

/** the same for a picture already in memory */
export function isAnimatedHead(b: Buffer): Promise<boolean> {
  return isAnimatedFrom(async (offset, len) => b.subarray(offset, offset + len))
}

export async function isAnimated(file: string): Promise<boolean> {
  let fh
  try {
    fh = await open(file, 'r')
    const h = fh
    return await isAnimatedFrom(async (offset, len) => {
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await h.read(buf, 0, len, offset)
      return buf.subarray(0, bytesRead)
    })
  } catch {
    return false
  } finally {
    await fh?.close().catch(() => {})
  }
}
