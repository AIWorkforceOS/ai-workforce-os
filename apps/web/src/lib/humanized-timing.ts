// Timing humanizado do envio de mensagens: os funcionários digitais não
// respondem instantaneamente — um humano levaria alguns segundos para
// digitar. O delay é proporcional ao tamanho da mensagem, com piso e teto
// para nunca parecer nem instantâneo demais (denuncia automação) nem lento
// demais (frustra o lead). Usado pelos 3 canais em lib/channels/messaging-channel.ts.

const MIN_DELAY_MS = 1500
const MAX_DELAY_MS = 9000
const MS_PER_CHARACTER = 35

export function computeHumanTypingDelayMs(text: string): number {
  const estimated = MIN_DELAY_MS + text.length * MS_PER_CHARACTER
  return Math.min(Math.max(estimated, MIN_DELAY_MS), MAX_DELAY_MS)
}

/** Pulado sob Vitest: não há nada observável para simular ali, só deixaria a suíte lenta. */
export async function sleep(ms: number): Promise<void> {
  if (process.env.VITEST) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}
