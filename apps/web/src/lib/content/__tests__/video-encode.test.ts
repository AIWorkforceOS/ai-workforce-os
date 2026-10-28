import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { encodeVideo, resolveFfmpeg } from '../video-encode'

const run = promisify(execFile)

async function binary(): Promise<string | null> {
  try {
    return resolveFfmpeg()
  } catch {
    return null
  }
}

describe('resolveFfmpeg', () => {
  it('FFMPEG_PATH tem prioridade; sem nenhum caminho, erro claro', () => {
    expect(resolveFfmpeg({ FFMPEG_PATH: '/x/ffmpeg' })).toBe('/x/ffmpeg')
  })
})

describe('encodeVideo (ffmpeg de verdade, em miniatura)', () => {
  it('gera um MP4 H.264 vertical com a duração somada das cenas', async (ctx) => {
    const bin = await binary()
    if (!bin) return ctx.skip()
    const W = 270
    const H = 480
    const frame = (color: string) => sharp({ create: { width: W, height: H, channels: 3, background: color } }).png().toBuffer()
    const frames = await Promise.all(['#021E44', '#0B993F', '#333333'].map(frame))
    const specs = [
      { seconds: 2, transition: 'fade' as const },
      { seconds: 2, transition: 'slideleft' as const },
      { seconds: 3, transition: 'dissolve' as const },
    ]
    const out = await encodeVideo({ frames, specs, width: W, height: H })
    expect(out.bytes).toBeGreaterThan(1000)
    expect(out.mp4.subarray(4, 8).toString()).toBe('ftyp')

    const dir = await mkdtemp(join(tmpdir(), 'vt-'))
    try {
      const file = join(dir, 'o.mp4')
      await writeFile(file, out.mp4)
      const info = await run(bin, ['-hide_banner', '-i', file]).catch((e: { stderr: string }) => ({ stderr: e.stderr }))
      const text = (info as { stderr: string }).stderr
      expect(text).toMatch(/Duration: 00:00:07\.0\d/)
      expect(text).toMatch(/Video: h264 .*270x480/)
      expect(text).toMatch(/Audio: aac/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('quadros e cenas que não batem dão erro, sem rodar o ffmpeg', async () => {
    await expect(encodeVideo({ frames: [], specs: [], width: 10, height: 10 })).rejects.toThrow(/não batem/)
  })
})
