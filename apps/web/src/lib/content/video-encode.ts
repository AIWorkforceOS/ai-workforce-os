// Codificação do MP4 com o ffmpeg empacotado (ffmpeg-static): nenhum serviço externo, nenhum custo além de CPU do servidor. Saída pronta para Reels:
// H.264 high, yuv420p, 30 fps, 1080×1920, moov no início (faststart) e uma faixa de áudio AAC silenciosa (o vídeo é só texto na tela).

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import { TRANSITION_SECONDS, VIDEO_FPS, buildFilterGraph, planTimeline, type FrameSpec } from './video'

const FFMPEG_TIMEOUT_MS = 240_000

/** Caminho do ffmpeg: o do pacote, ou FFMPEG_PATH (para quem quiser usar um próprio). Sem nenhum dos dois, erro claro (o post não é criado). */
export function resolveFfmpeg(env: Record<string, string | undefined> = process.env): string {
  const path = env.FFMPEG_PATH || ffmpegPath
  if (!path) throw new Error('ffmpeg não está disponível neste servidor — não foi possível renderizar o vídeo.')
  return path
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
    await run(resolveFfmpeg(), args)
    const mp4 = await readFile(out)
    return { mp4, durationMs: Date.now() - started, bytes: mp4.byteLength }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
