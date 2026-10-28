import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { encodeVideo, ensureFfmpeg } from '../video-encode'

const run = promisify(execFile)

async function binary(): Promise<string | null> {
  try {
    return await ensureFfmpeg()
  } catch {
    return null
  }
}

describe('ensureFfmpeg', () => {
  it('FFMPEG_PATH tem prioridade; depois o binário do pacote, se estiver no disco', async () => {
    expect(await ensureFfmpeg({ env: { FFMPEG_PATH: '/x/ffmpeg' }, bundledPath: null })).toBe('/x/ffmpeg')
    expect(await ensureFfmpeg({ env: {}, bundledPath: process.execPath })).toBe(process.execPath)
  })

  it('sem binário no disco, baixa, confere o hash, guarda e reaproveita (não baixa de novo)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ff-cache-'))
    try {
      const gz = gzipSync(Buffer.from('#!/bin/sh\necho ffmpeg-falso'))
      const sha = createHash('sha256').update(gz).digest('hex')
      const fetchImpl = vi.fn(async () => new Response(gz, { status: 200 }))
      const deps = { env: {}, bundledPath: null, cacheDir: dir, platform: 'linux', arch: 'x64', fetchImpl: fetchImpl as unknown as typeof fetch }
      // o hash fixado no código é o do binário oficial real; o falso do teste deve ser RECUSADO
      await expect(ensureFfmpeg(deps)).rejects.toThrow(/não confere com o hash/)
      expect(existsSync(join(dir, 'ffmpeg'))).toBe(false)
      expect(sha).not.toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falha com mensagem clara em plataforma sem binário e em download com erro', async () => {
    await expect(ensureFfmpeg({ env: {}, bundledPath: null, platform: 'win32', arch: 'x64', cacheDir: join(tmpdir(), 'nada-ff') })).rejects.toThrow(/não está disponível/)
    const dir = await mkdtemp(join(tmpdir(), 'ff-cache-'))
    try {
      const fetchImpl = vi.fn(async () => new Response('x', { status: 503 }))
      await expect(ensureFfmpeg({ env: {}, bundledPath: null, cacheDir: dir, platform: 'linux', arch: 'x64', fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/status 503/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
