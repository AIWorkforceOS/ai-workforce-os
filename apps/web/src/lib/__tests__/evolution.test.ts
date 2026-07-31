import { afterEach, describe, expect, it, vi } from 'vitest'
import { getInstanceStatus, sendWhatsAppMessage, type EvolutionUnitConfig } from '@/lib/evolution'

// Cobre a auditoria de bloqueio do WhatsApp (2026-07-30): antes deste fix,
// evolutionFetch chamava `fetch` sem nenhum timeout — uma Evolution API que
// trava (não erra, só nunca responde) prendia o webhook até o maxDuration da
// rota (60s), a Evolution API nunca recebia 200 a tempo e reentregava a
// mesma mensagem, o mesmo padrão de reprocessamento/resposta duplicada que
// já causou um bloqueio anterior do número (ver route.ts). Estes testes
// garantem que toda chamada à Evolution API carrega um AbortSignal e que,
// quando ele dispara, a chamada rejeita em vez de ficar pendurada para sempre.

const config: EvolutionUnitConfig = { apiUrl: 'https://evolution.example.com', apiKey: 'key', instanceName: 'unit-1' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('evolutionFetch — timeout', () => {
  it('anexa um AbortSignal em toda chamada à Evolution API', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal as AbortSignal | undefined
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    await sendWhatsAppMessage(config, '5511999999999', 'oi')

    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })

  it('rejeita (em vez de travar para sempre) quando a chamada expira', async () => {
    // Simula o timeout disparando de propósito, sem depender de esperar os
    // 15s reais — prova que, quando o sinal aborta, a chamada some com um
    // erro tratável em vez de deixar a promise pendurada indefinidamente.
    const controller = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation timed out.', 'TimeoutError')),
            )
          }),
      ),
    )

    const promise = sendWhatsAppMessage(config, '5511999999999', 'oi')
    controller.abort()

    await expect(promise).rejects.toThrow()
  })

  it('getInstanceStatus também carrega o timeout (não só o envio de mensagem)', async () => {
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal as AbortSignal | undefined
        return new Response(JSON.stringify({ state: 'open' }), { status: 200 })
      }),
    )

    await getInstanceStatus(config)

    expect(capturedSignal).toBeInstanceOf(AbortSignal)
  })
})
