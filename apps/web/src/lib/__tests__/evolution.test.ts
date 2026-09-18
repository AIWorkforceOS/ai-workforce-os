import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureWebhookConfigured, forceReconnectInstance, getInstanceStatus, sendWhatsAppMessage, type EvolutionUnitConfig } from '@/lib/evolution'
import { createFakeSupabase } from './fake-supabase'

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

// forceReconnectInstance (2026-09-17, pedido do Vinicius): "Conectar" normal
// (connectInstance) só recria a instância em 404 de propósito, pra nunca
// destruir uma sessão válida sem querer — mas isso deixa uma sessão
// genuinamente corrompida (QR aparece, escanear nunca completa, mesmo com o
// número funcionando normalmente no WhatsApp) sem nenhum jeito de recuperar
// pela tela. forceReconnectInstance é o botão de último recurso: apaga e
// recria do zero, sempre, ação explícita do usuário.
describe('forceReconnectInstance', () => {
  it('apaga, recria e reconecta a instância, nessa ordem', async () => {
    const calls: { url: string; method?: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method })
        if (url.includes('/instance/connect/')) {
          return new Response(JSON.stringify({ base64: 'data:image/png;base64,abc' }), { status: 200 })
        }
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )

    await forceReconnectInstance(config)

    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.url}`)).toEqual([
      `DELETE https://evolution.example.com/instance/delete/${config.instanceName}`,
      `POST https://evolution.example.com/instance/create`,
      `GET https://evolution.example.com/instance/connect/${config.instanceName}`,
    ])
  })

  it('instância que já não existia (404 no delete) não impede recriar — segue pra criar normalmente', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url)
        if ((init?.method ?? 'GET') === 'DELETE') return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )

    await expect(forceReconnectInstance(config)).resolves.not.toThrow()
    expect(calls.some((u) => u.includes('/instance/create'))).toBe(true)
  })

  it('qualquer outra falha ao apagar (não 404) propaga o erro — nunca segue pra recriar às cegas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'DELETE') return new Response(JSON.stringify({ message: 'erro interno' }), { status: 500 })
        return new Response(JSON.stringify({}), { status: 200 })
      }),
    )

    await expect(forceReconnectInstance(config)).rejects.toThrow('erro interno')
  })
})

// ensureWebhookConfigured (achado real, 2026-09-18): "Ana conectou, mas
// não respondeu nenhuma mensagem" — esta função sempre foi best-effort e
// engolia qualquer falha só em console.error (ninguém via). Agora loga em
// system_events quando um logContext é passado, pra parar de ser invisível
// — especialmente importante porque forceReconnectInstance (2026-09-17)
// apaga o webhook já configurado de uma instância e depende 100% desta
// função pra recriar.
describe('ensureWebhookConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sucesso: devolve true, não loga nada em system_events', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))
    const { supabase, db } = createFakeSupabase()

    const ok = await ensureWebhookConfigured(config, { supabase, orgId: 'org-1', unitId: 'unit-1' })

    expect(ok).toBe(true)
    expect(db.system_events ?? []).toHaveLength(0)
  })

  it('falha do servidor: devolve false E grava o erro em system_events (antes ficava só no console, invisível)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'endpoint não existe' }), { status: 404 })))
    const { supabase, db } = createFakeSupabase()

    const ok = await ensureWebhookConfigured(config, { supabase, orgId: 'org-1', unitId: 'unit-1' })

    expect(ok).toBe(false)
    expect(db.system_events).toHaveLength(1)
    const event = db.system_events![0]!
    expect(event.level).toBe('error')
    expect(event.event_type).toBe('whatsapp_webhook_configure_failed')
    expect(event.unit_id).toBe('unit-1')
    expect(String(event.message)).toContain(config.instanceName)
  })

  it('sem logContext (chamadas antigas continuam funcionando): falha não lança, só devolve false', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })))

    await expect(ensureWebhookConfigured(config)).resolves.toBe(false)
  })

  it('sem NEXT_PUBLIC_APP_URL configurada, nem tenta — devolve false sem chamar a Evolution API', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const ok = await ensureWebhookConfigured(config)

    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
