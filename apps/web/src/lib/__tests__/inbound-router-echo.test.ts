import { describe, expect, it } from 'vitest'
import { isRecentOutboundEcho } from '@/lib/inbound-router'
import { createFakeSupabase } from './fake-supabase'

// Regressão: Evolution API (Baileys, protocolo multi-device não-oficial)
// reentrega uma mensagem que NÓS enviamos como se fosse um inbound novo, às
// vezes atribuída a um lead diferente do que recebeu a resposta original
// (falta de ORDER BY na busca de lead por telefone). O guard por número no
// webhook (route.ts) cobre o caso comum; isRecentOutboundEcho é a segunda
// camada — detecta o eco pelo conteúdo idêntico a uma resposta outbound
// recente, independente de qual lead o payload aponta.

describe('isRecentOutboundEcho', () => {
  it('detecta eco: texto idêntico a uma resposta outbound enviada há poucos segundos', async () => {
    const { supabase } = createFakeSupabase({
      conversations: [
        {
          id: 'conv-1',
          unit_id: 'unit-1',
          lead_id: 'lead-A',
          direction: 'outbound',
          content: 'Parece que você precisa de ajuda com algo relacionado a finanças ou contratos...',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const echo = await isRecentOutboundEcho(
      supabase,
      'unit-1',
      'Parece que você precisa de ajuda com algo relacionado a finanças ou contratos...',
    )

    expect(echo).toBe(true)
  })

  it('não sinaliza eco quando o texto é diferente de qualquer outbound recente', async () => {
    const { supabase } = createFakeSupabase({
      conversations: [
        {
          id: 'conv-1',
          unit_id: 'unit-1',
          lead_id: 'lead-A',
          direction: 'outbound',
          content: 'Resposta original.',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const echo = await isRecentOutboundEcho(supabase, 'unit-1', 'Mensagem nova do cliente, sem relação.')

    expect(echo).toBe(false)
  })

  it('não sinaliza eco quando o texto idêntico é de outra unidade', async () => {
    const { supabase } = createFakeSupabase({
      conversations: [
        {
          id: 'conv-1',
          unit_id: 'unit-OUTRA',
          lead_id: 'lead-A',
          direction: 'outbound',
          content: 'Resposta original.',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const echo = await isRecentOutboundEcho(supabase, 'unit-1', 'Resposta original.')

    expect(echo).toBe(false)
  })

  it('não sinaliza eco para uma mensagem inbound com o mesmo texto (não é outbound)', async () => {
    const { supabase } = createFakeSupabase({
      conversations: [
        {
          id: 'conv-1',
          unit_id: 'unit-1',
          lead_id: 'lead-A',
          direction: 'inbound',
          content: 'Mesmo texto, mas é inbound de verdade.',
          sent_at: new Date().toISOString(),
        },
      ],
    })

    const echo = await isRecentOutboundEcho(supabase, 'unit-1', 'Mesmo texto, mas é inbound de verdade.')

    expect(echo).toBe(false)
  })
})
