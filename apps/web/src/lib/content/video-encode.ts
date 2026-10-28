// Codificação do MP4 com o ffmpeg empacotado (ffmpeg-static): nenhum serviço externo, nenhum custo além de CPU do servidor. Saída pronta para Reels:
// H.264 high, yuv420p, 30 fps, 1080×1920, moov no início (faststart) e uma faixa de áudio AAC silenciosa (o vídeo é só texto na tela).

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import ffmpegPath from 'ffmpeg-static'
import { TRANSITION_SECONDS, VIDEO_FPS, buildFilterGraph, planTimeline, type FrameSpec } from './video'

const FFMPEG_TIMEOUT_MS = 240_000

// O binário do ffmpeg (80 MB descompactado) NÃO vai dentro das funções: a Vercel recusa o deploy com ele empacotado (testado em prévia, 2026-10-27).
// Em produção o servidor baixa uma vez o MESMO binário oficial do ffmpeg-static, confere o hash fixado aqui e o guarda em /tmp (reaproveitado
// enquanto a instância estiver quente). Em desenvolvimento/CI o binário do pacote já está no disco e é usado direto.
const FFMPEG_RELEASE = 'b6.1.1'
const FFMPEG_DOWNLOADS: Record<string, { url: string; sha256: string }> = {
  'linux-x64': {
    url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-linux-x64.gz`,
    sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
  },
}

export type FfmpegDeps = {
  env?: Record<string, string | undefined>
  bundledPath?: string | null
  fetchImpl?: typeof fetch
  cacheDir?: string
  platform?: string
  arch?: string
}

let pending: Promise<string> | null = null

/** Caminho de um ffmpeg executável: FFMPEG_PATH → binário do pacote (se estiver no disco) → cópia baixada em /tmp (baixa e confere o hash se faltar). */
export async function ensureFfmpeg(deps: FfmpegDeps = {}): Promise<string> {
  const env = deps.env ?? process.env
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH
  const bundled = deps.bundledPath === undefined ? ffmpegPath : deps.bundledPath
  if (bundled && existsSync(bundled)) return bundled

  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  const source = FFMPEG_DOWNLOADS[`${platform}-${arch}`]
  if (!source) throw new Error(`ffmpeg não está disponível neste servidor (${platform}-${arch}) — não foi possível renderizar o vídeo.`)

  const dir = deps.cacheDir ?? join(tmpdir(), `alizo-ffmpeg-${FFMPEG_RELEASE}`)
  const target = join(dir, 'ffmpeg')
  if (existsSync(target)) return target
  if (!pending) {
    pending = download(source, dir, target, deps.fetchImpl ?? fetch).finally(() => {
      pending = null
    })
  }
  return pending
}

async function download(source: { url: string; sha256: string }, dir: string, target: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`Não foi possível baixar o ffmpeg (status ${response.status}).`)
  const gz = Buffer.from(await response.arrayBuffer())
  const hash = createHash('sha256').update(gz).digest('hex')
  if (hash !== source.sha256) throw new Error('O ffmpeg baixado não confere com o hash esperado — não vou executar. O vídeo não foi renderizado.')
  await mkdir(dir, { recursive: true })
  const partial = `${target}.${process.pid}.${Date.now()}.part`
  await writeFile(partial, gunzipSync(gz))
  await chmod(partial, 0o755)
  await rename(partial, target)
  console.info(`[content/video] ffmpeg ${FFMPEG_RELEASE} baixado e verificado (${gz.byteLength} bytes compactados)`)
  return target
}

export type EncodeResult = { mp4: Buffer; durationMs: number; bytes: number }

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`ffmpeg falhou: ${String(stderr || error.message).split('\n').slice(-4).join(' ').slice(0, 400)}`))
      else resolve()
    })
  })
}

/** Junta os quadros (PNG, mesma ordem de `specs`) num MP4 com movimento e transições. */
export async function encodeVideo(params: { frames: Buffer[]; specs: Pick<FrameSpec, 'seconds' | 'transition'>[]; width: number; height: number }): Promise<EncodeResult> {
  const { frames, specs, width, height } = params
  if (frames.length !== specs.length || frames.length === 0) throw new Error('Quadros e cenas não batem.')
  const started = Date.now()
  const dir = await mkdtemp(join(tmpdir(), 'alizo-video-'))
  try {
    const plan = planTimeline(specs, TRANSITION_SECONDS)
    const total = specs.reduce((sum, s) => sum + s.seconds, 0)
    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
    for (let i = 0; i < frames.length; i += 1) {
      const file = join(dir, `f${i}.png`)
      await writeFile(file, frames[i]!)
      args.push('-loop', '1', '-framerate', String(VIDEO_FPS), '-t', String(plan[i]!.inputSeconds), '-i', file)
    }
    args.push('-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=44100:cl=stereo')
    const { filter, outLabel } = buildFilterGraph(specs, { width, height })
    const out = join(dir, 'out.mp4')
    args.push(
      '-filter_complex', filter,
      '-map', `[${outLabel}]`, '-map', `${frames.length}:a`,
      '-t', String(total),
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', String(VIDEO_FPS),
      '-c:a', 'aac', '-b:a', '48k', '-shortest',
      '-movflags', '+faststart',
      out,
    )
    await run(await ensureFfmpeg(), args)
    const mp4 = await readFile(out)
    return { mp4, durationMs: Date.now() - started, bytes: mp4.byteLength }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
