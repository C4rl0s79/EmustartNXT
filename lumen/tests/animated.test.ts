import { describe, expect, it } from 'vitest'
import { isAnimatedHead } from '../src/main/art/animated'

const chunk = (type: string, data = Buffer.alloc(0)): Buffer => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
}
const PNG = Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')
const webp = (vp8x: boolean, anim: boolean): Buffer => {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.write('WEBP', 8, 'latin1')
  b.write(vp8x ? 'VP8X' : 'VP8 ', 12, 'latin1')
  if (anim) b[20] = 0x02
  return b
}

describe('isAnimatedHead', async () => {
  it('APNG: acTL before the first IDAT', async () => {
    await expect(isAnimatedHead(Buffer.concat([PNG, chunk('IHDR', Buffer.alloc(13)), chunk('acTL', Buffer.alloc(8)), chunk('IDAT')]))).resolves.toBe(true)
  })
  it('a plain PNG, or acTL only after IDAT, is not animated', async () => {
    await expect(isAnimatedHead(Buffer.concat([PNG, chunk('IHDR', Buffer.alloc(13)), chunk('IDAT')]))).resolves.toBe(false)
    await expect(isAnimatedHead(Buffer.concat([PNG, chunk('IHDR', Buffer.alloc(13)), chunk('IDAT'), chunk('acTL')]))).resolves.toBe(false)
  })
  it('WebP: the VP8X animation flag', async () => {
    await expect(isAnimatedHead(webp(true, true))).resolves.toBe(true)
    await expect(isAnimatedHead(webp(true, false))).resolves.toBe(false)
    await expect(isAnimatedHead(webp(false, false))).resolves.toBe(false)
  })
  it('anything else (JPEG, short or broken data) is not', async () => {
    await expect(isAnimatedHead(Buffer.from([0xff, 0xd8, 0xff]))).resolves.toBe(false)
    await expect(isAnimatedHead(Buffer.alloc(0))).resolves.toBe(false)
    await expect(isAnimatedHead(Buffer.concat([PNG, Buffer.from([0, 0, 0xff, 0xff])]))).resolves.toBe(false)
  })
})

describe('isAnimatedHead: chunks walked one by one', () => {
  it('finds acTL after a large metadata chunk (an ICC profile beyond the first 64 KB)', async () => {
    const big = Buffer.concat([PNG, chunk('IHDR', Buffer.alloc(13)), chunk('iCCP', Buffer.alloc(100_000)), chunk('acTL', Buffer.alloc(8)), chunk('IDAT')])
    await expect(isAnimatedHead(big)).resolves.toBe(true)
  })
})
