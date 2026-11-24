// Codificação do MP4 com o ffmpeg empacotado (ffmpeg-static): nenhum serviço externo, nenhum custo além de CPU do servidor. Saída pronta para Reels:
// H.264 high, yuv420p, 30 fps, 720×1280, moov no início (faststart) e uma faixa de áudio AAC silenciosa (o vídeo é só texto na tela).

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import sharp from 'sharp'
import ffmpegPath from 'ffmpeg-static'
import { musicSource } from './video-audio'
import { removeSolidBackground } from './logo-processing'
import { lightenDarkPixels } from './logo-light'
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
  /** Só para testes: origem/hash alternativos. Em produção vale sempre o hash fixado em FFMPEG_DOWNLOADS. */
  source?: { url: string; sha256: string }
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
  const source = deps.source ?? FFMPEG_DOWNLOADS[`${platform}-${arch}`]
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

/** Baixa em streaming (sem segurar o arquivo inteiro na memória: o binário tem 80 MB descompactado), conferindo o hash do arquivo compactado. Só renomeia para o caminho final depois que o hash bate. */
async function download(source: { url: string; sha256: string }, dir: string, target: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) throw new Error(`Não foi possível baixar o ffmpeg (status ${response.status}).`)
  await mkdir(dir, { recursive: true })
  const partial = `${target}.${process.pid}.${Date.now()}.part`
  const hash = createHash('sha256')
  let received = 0
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      received += chunk.length
      callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body as never), tap, createGunzip(), createWriteStream(partial, { mode: 0o755 }))
    if (hash.digest('hex') !== source.sha256) throw new Error('O ffmpeg baixado não confere com o hash esperado — não vou executar. O vídeo não foi renderizado.')
    await chmod(partial, 0o755)
    await rename(partial, target)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
  console.info(`[content/video] ffmpeg ${FFMPEG_RELEASE} baixado e verificado (${received} bytes compactados)`)
  return target
}

export type EncodeResult = { mp4: Buffer; durationMs: number; bytes: number }

/** Normaliza a logo antes de qualquer geração paga e exige transparência real. */
export async function prepareTransparentVideoLogo(input: Buffer): Promise<Buffer> {
  const png = await removeSolidBackground(input)
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let transparent = 0
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i]! < 16) transparent += 1
  }
  const total = Math.max(1, info.width * info.height)
  if (transparent / total < 0.02) {
    throw new Error('A logo precisa estar sem fundo. Envie um PNG ou WebP transparente antes de gerar o vídeo. Nenhum crédito foi utilizado.')
  }
  return sharp(png)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
}

/**
 * Aplica a identidade exata depois da geração. Modelos generativos não devem
 * redesenhar logos: o arquivo original é sobreposto ao MP4 para garantir
 * fidelidade em todos os quadros.
 */
export async function applyVideoBranding(params: {
  mp4: Buffer
  logo: Buffer
  primary: string
  secondary: string
}): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'alizo-video-brand-'))
  try {
    const input = join(dir, 'input.mp4')
    const overlay = join(dir, 'brand.png')
    const output = join(dir, 'output.mp4')
    // A logo pode ter vindo de um cadastro antigo, anterior ao tratamento do
    // upload. Remova o fundo sólido novamente aqui: nenhum vídeo recebe placa
    // branca, mesmo quando o arquivo original ainda a contém.
    const transparentLogo = await prepareTransparentVideoLogo(params.logo)
    // Versão clara é uma variação oficial sem fundo: preserva cores vivas e
    // clareia apenas pixels escuros para não sumirem sobre vídeo/fundo azul.
    const visibleLogo = await lightenDarkPixels(transparentLogo)
    const logo = await sharp(visibleLogo).resize({ width: 144, height: 100, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    const logoMeta = await sharp(logo).metadata()
    const logoWidth = logoMeta.width ?? 144
    const canvas = await sharp({ create: { width: 720, height: 1280, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: Buffer.from(`<svg width="720" height="1280"><rect width="720" height="8" fill="${params.primary}"/><rect y="1272" width="720" height="8" fill="${params.secondary}"/></svg>`), left: 0, top: 0 },
        { input: logo, left: 720 - logoWidth - 28, top: 28 },
      ])
      .png()
      .toBuffer()
    // Encerramento determinístico: os últimos 2,5 s são sempre uma tela de
    // marca completa. Isso impede o Veo/Gemini de cortar uma ação ou terminar
    // no meio de uma logo deformada.
    const endCard = join(dir, 'end-card.png')
    const endLogo = await sharp(visibleLogo).resize({ width: 390, height: 250, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    const endMeta = await sharp(endLogo).metadata()
    const end = await sharp({ create: { width: 720, height: 1280, channels: 4, background: params.primary } })
      .composite([
        { input: Buffer.from(`<svg width="720" height="1280"><rect width="720" height="1280" fill="${params.primary}"/><circle cx="650" cy="120" r="260" fill="${params.secondary}" opacity=".22"/><circle cx="50" cy="1180" r="320" fill="${params.secondary}" opacity=".14"/><rect y="1268" width="720" height="12" fill="${params.secondary}"/></svg>`), left: 0, top: 0 },
        { input: endLogo, left: Math.round((720 - (endMeta.width ?? 390)) / 2), top: Math.round((1280 - (endMeta.height ?? 250)) / 2) },
      ])
      .png()
      .toBuffer()
    await Promise.all([writeFile(input, params.mp4), writeFile(overlay, canvas), writeFile(endCard, end)])
    const ffmpeg = await ensureFfmpeg()
    await run(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', input, '-i', overlay, '-loop', '1', '-i', endCard,
      '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto[branded];[2:v]format=yuva420p,fade=t=in:st=0:d=0.35:alpha=1[end];[branded][end]overlay=0:0:enable=\'gte(t,12.5)\':shortest=1[v]',
      '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', '-c:a', 'copy', '-movflags', '+faststart', output,
    ])
    return readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Mixagem: narração (se houver) por cima da trilha ambiente, ambas com entrada/saída suaves. Rótulo de saída: [aout]. */
export function buildAudioGraph(params: { total: number; voiceInput: number | null; voiceTempo?: number }): string {
  const { total, voiceInput } = params
  const tempo = params.voiceTempo && params.voiceTempo > 1.001 ? `,atempo=${params.voiceTempo.toFixed(3)}` : ''
  const fadeOut = Math.max(0, total - 2).toFixed(2)
  const music = (volume: number) => `${musicSource(total)},lowpass=f=1400,volume=${volume},afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2`
  if (voiceInput === null) return `${music(0.22)}[aout]`
  return [
    `[${voiceInput}:a]aresample=44100,aformat=channel_layouts=stereo${tempo},adelay=600|600,apad=whole_dur=${total.toFixed(2)}[voice]`,
    `${music(0.14)}[mus]`,
    '[voice][mus]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]',
  ].join(';')
}

/** Duração (s) de um arquivo de áudio lida da saída do ffmpeg; null se não conseguir. */
async function probeSeconds(bin: string, file: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(bin, ['-hide_banner', '-i', file], { timeout: 20000 }, (_error, _stdout, stderr) => {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(String(stderr))
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null)
    })
  })
}

/** Quanto acelerar a narração para caber (com 0,6 s de entrada e 1 s de folga no fim): no máximo 1,15x — acima disso fica apressada, melhor cortar o fim. */
export function narrationTempo(narrationSeconds: number | null, total: number): number {
  if (!narrationSeconds) return 1
  const room = total - 1.6
  return room > 0 && narrationSeconds > room ? Math.min(1.15, narrationSeconds / room) : 1
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`ffmpeg falhou: ${String(stderr || error.message).split('\n').slice(-4).join(' ').slice(0, 400)}`))
      else resolve()
    })
  })
}

/**
 * Junta as camadas num MP4: para cada cena um FUNDO (foto/cor, com zoom lento) e um TEXTO (PNG transparente que entra animado), ligadas por transições.
 * Tudo entra no ffmpeg JÁ no tamanho de saída: cada entrada grande custa centenas de MB de memória (medido, ver video.ts).
 */
export async function encodeVideo(params: {
  backgrounds: Buffer[]
  overlays: Buffer[]
  specs: Pick<FrameSpec, 'seconds' | 'transition'>[]
  width: number
  height: number
  /** Narração (áudio já pronto). Sem ela o vídeo leva só a trilha de fundo. */
  narration?: Buffer | null
}): Promise<EncodeResult> {
  const { backgrounds, overlays, specs, width, height, narration } = params
  const n = specs.length
  if (n === 0 || backgrounds.length !== n || overlays.length !== n) throw new Error('Quadros e cenas não batem.')
  const started = Date.now()
  const dir = await mkdtemp(join(tmpdir(), 'alizo-video-'))
  try {
    const plan = planTimeline(specs, TRANSITION_SECONDS)
    const total = specs.reduce((sum, s) => sum + s.seconds, 0)
    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
    const addInput = (file: string, seconds: number) => args.push('-loop', '1', '-framerate', String(VIDEO_FPS), '-t', String(seconds), '-i', file)
    for (let i = 0; i < n; i += 1) {
      const file = join(dir, `b${i}.jpg`)
      await writeFile(file, await sharp(backgrounds[i]!).resize(width, height, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer())
      addInput(file, plan[i]!.inputSeconds)
    }
    for (let i = 0; i < n; i += 1) {
      const file = join(dir, `o${i}.png`)
      await writeFile(file, await sharp(overlays[i]!).resize(width, height, { fit: 'fill' }).png({ compressionLevel: 3 }).toBuffer())
      addInput(file, plan[i]!.inputSeconds)
    }
    const ffmpeg = await ensureFfmpeg()
    let voiceTempo = 1
    if (narration) {
      const file = join(dir, 'voice.opus')
      await writeFile(file, narration)
      args.push('-i', file)
      const seconds = await probeSeconds(ffmpeg, file)
      voiceTempo = narrationTempo(seconds, total)
      console.info(`[content/video] narração: ${seconds ?? '?'} s para ${total} s de vídeo (velocidade ${voiceTempo.toFixed(2)}x)`)
    }
    const { filter: videoFilter, outLabel } = buildFilterGraph(specs, { width, height })
    const filter = `${videoFilter};${buildAudioGraph({ total, voiceInput: narration ? 2 * n : null, voiceTempo })}`
    const out = join(dir, 'out.mp4')
    args.push(
      '-filter_complex', filter,
      '-map', `[${outLabel}]`, '-map', '[aout]',
      '-t', String(total),
      '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', String(VIDEO_FPS),
      // memória limitada (função serverless): poucos threads e lookahead curto
      '-threads', '2', '-filter_threads', '1', '-filter_complex_threads', '1', '-x264-params', 'rc-lookahead=8:sync-lookahead=0:frame-threads=2',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+faststart',
      out,
    )
    await run(ffmpeg, args)
    const mp4 = await readFile(out)
    return { mp4, durationMs: Date.now() - started, bytes: mp4.byteLength }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
