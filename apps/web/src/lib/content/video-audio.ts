// Áudio do vídeo: narração (TTS da OpenAI, a mesma chave do resto) e trilha de fundo sintetizada no próprio ffmpeg (sem arquivo, sem serviço, sem direito autoral).

import { synthesizeSpeech } from '@/lib/openai'

/** Velocidade média de fala (palavras por segundo) usada para pedir à IA uma narração que caiba na duração do vídeo. */
export const WORDS_PER_SECOND = 2.2
export const NARRATION_VOICE = 'ash'

export function narrationWordTarget(seconds: number): number {
  return Math.max(25, Math.round(seconds * WORDS_PER_SECOND * 0.85))
}

const DIRECTION =
  'Narração de um vídeo institucional curto para empresas: voz masculina grave, confiante e calorosa, ritmo firme e natural, pausas curtas entre as frases, sem soar como locutor de rádio nem robótico.'

/** Narração em áudio (Ogg/Opus). Falhou = null: o vídeo sai só com a trilha, sem quebrar. */
export async function synthesizeNarration(params: { apiKey: string; text: string }): Promise<Buffer | null> {
  const text = params.text.replace(/\s+/g, ' ').trim()
  if (text.length < 20) return null
  try {
    const { base64Audio } = await synthesizeSpeech({ apiKey: params.apiKey, text, voice: NARRATION_VOICE, instructions: DIRECTION })
    return Buffer.from(base64Audio, 'base64')
  } catch (error) {
    console.error('[content/video] falha ao gerar a narração:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Trilha ambiente: acorde suspenso (Dm9) com cada nota respirando em ritmo lento, mais um graveiro, filtrada para ficar macia. Fórmula sem vírgula (o ffmpeg usa vírgula
 * para separar filtros). Sai estéreo; o volume final é decidido na mixagem.
 */
export function musicSource(seconds: number): string {
  const note = (f: number, rate: number, phase: number) => `(0.55+0.45*sin(2*PI*${rate}*t+${phase}))*sin(2*PI*${f}*t)`
  const expr = [
    `0.50*sin(2*PI*73.42*t)`,
    `0.30*${note(146.83, 0.07, 0)}`,
    `0.24*${note(220.0, 0.09, 1.3)}`,
    `0.22*${note(261.63, 0.06, 2.1)}`,
    `0.18*${note(329.63, 0.11, 0.7)}`,
    `0.12*${note(440.0, 0.08, 3.2)}`,
  ].join('+')
  return `aevalsrc='${expr}|${expr}':s=44100:d=${seconds.toFixed(2)}`
}
