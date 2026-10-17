import { MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS } from './media'

/** ~2 Mbps de vídeo + 64 kbps de áudio: 15s ≈ 4MB, muito abaixo dos 50MB. */
export const VIDEO_BITS_PER_SECOND = 2_000_000
export const AUDIO_BITS_PER_SECOND = 64_000

/** Primeiro formato que o aparelho grava: Chrome/Android = webm, Safari/iPhone = mp4. */
export function pickRecorderMimeType(isSupported: (type: string) => boolean): string | null {
  const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((type) => isSupported(type)) ?? null
}

export function videoExtension(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : mimeType.startsWith('video/quicktime') ? 'mov' : 'webm'
}

/** Vídeo escolhido da galeria/câmera nativa não é comprimido por nós: só passa se já couber nos limites. */
export function validateVideoFile(file: { size: number; type: string }, durationSeconds: number | null): { ok: true } | { ok: false; error: string } {
  if (!file.type.startsWith('video/')) return { ok: false, error: 'Escolha um arquivo de vídeo.' }
  if (file.size <= 0) return { ok: false, error: 'O vídeo está vazio.' }
  if (file.size > MAX_VIDEO_BYTES) {
    return { ok: false, error: 'Vídeo grande demais (máximo 50MB). Use o botão "Gravar vídeo" do app, que já comprime.' }
  }
  if (durationSeconds != null && durationSeconds > MAX_VIDEO_SECONDS + 0.5) {
    return { ok: false, error: `Vídeo longo demais (máximo ${MAX_VIDEO_SECONDS} segundos).` }
  }
  return { ok: true }
}
