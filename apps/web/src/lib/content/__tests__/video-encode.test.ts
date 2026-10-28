import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
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

  it('sem binário no disco, baixa em streaming, confere o hash, guarda executável e reaproveita (não baixa de novo)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ff-cache-'))
    try {
      const conteudo = Buffer.from('#!/bin/sh\necho ffmpeg-falso\n')
      const gz = gzipSync(conteudo)
      const sha256 = createHash('sha256').update(gz).digest('hex')
      const fetchImpl = vi.fn(async () => new Response(gz, { status: 200 }))
      const deps = { env: {}, bundledPath: null, cacheDir: dir, platform: 'linux', arch: 'x64', source: { url: 'https://x/ffmpeg.gz', sha256 }, fetchImpl: fetchImpl as unknown as typeof fetch }
      const path = await ensureFfmpeg(deps)
      expect(path).toBe(join(dir, 'ffmpeg'))
      expect((await readFile(path)).equals(conteudo)).toBe(true)
      expect((await stat(path)).mode & 0o111).not.toBe(0) // executável
      expect(await ensureFfmpeg(deps)).toBe(path)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hash diferente do esperado: recusa, não deixa arquivo nenhum (nem parcial) e nunca executa', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ff-cache-'))
    try {
      const gz = gzipSync(Buffer.from('conteudo qualquer'))
      const fetchImpl = vi.fn(async () => new Response(gz, { status: 200 }))
      const deps = { env: {}, bundledPath: null, cacheDir: dir, platform: 'linux', arch: 'x64', source: { url: 'https://x/ffmpeg.gz', sha256: 'f'.repeat(64) }, fetchImpl: fetchImpl as unknown as typeof fetch }
      await expect(ensureFfmpeg(deps)).rejects.toThrow(/não confere com o hash/)
      expect(await readdir(dir)).toEqual([])
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

  it('quadros maiores que a saída são reduzidos antes do ffmpeg (a saída tem o tamanho pedido)', async (ctx) => {
    const bin = await binary()
    if (!bin) return ctx.skip()
    const big = await sharp({ create: { width: 540, height: 960, channels: 3, background: '#021E44' } }).png().toBuffer()
    const out = await encodeVideo({ frames: [big, big], specs: [{ seconds: 2, transition: 'fade' }, { seconds: 2, transition: 'fade' }], width: 270, height: 480 })
    const dir = await mkdtemp(join(tmpdir(), 'vt-'))
    try {
      const file = join(dir, 'o.mp4')
      await writeFile(file, out.mp4)
      const info = await run(bin, ['-hide_banner', '-i', file]).catch((e: { stderr: string }) => ({ stderr: e.stderr }))
      expect((info as { stderr: string }).stderr).toMatch(/Video: h264 .*270x480/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('quadros e cenas que não batem dão erro, sem rodar o ffmpeg', async () => {
    await expect(encodeVideo({ frames: [], specs: [], width: 10, height: 10 })).rejects.toThrow(/não batem/)
  })
})
