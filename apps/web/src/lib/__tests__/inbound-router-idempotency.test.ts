import { describe, expect, it } from 'vitest'
import { routeInboundMessage } from '@/lib/inbound-router'
import { createFakeSupabase } from './fake-supabase'
import type { Unit } from '@/lib/types'

// Regressão: a Evolution API reentrega o mesmo webhook (retryWebhookRequest,
// até ~10 tentativas) quando nosso handler não responde 200 a tempo. Sem
// checagem de idempotência por external_message_id, a reentrega reprocessava
// a mensagem inteira — inserindo linha duplicada e (no fluxo real, com canal
// configurado) mandando resposta duplicada pro mesmo número, um padrão de
// rajada que a Meta pode interpretar como abuso.

const unit = { id: 'unit-1', org_id: 'org-1', name: 'Unidade Teste' } as Unit

describe('routeInboundMessage — idempotência de webhook duplicado', () => {
  it('mesmo external_message_id 2x não duplica linha nem reprocessa', async () => {
    const { supabase, db } = createFakeSupabase({
      leads: [
        {
          id: 'lead-1',
          unit_id: unit.id,
          phone: '5511999998888',
          email: null,
          source: 'ads',
          status: 'new',
          last_contacted_at: null,
          updated_at: new Date().toISOString(),
        },
      ],
      job_openings: [
        {
          id: 'job-1',
          lead_id: 'lead-1',
          unit_id: unit.id,
          status: 'sourcing',
          title: 'Vaga Teste',
          profile: {},
          updated_at: new Date().toISOString(),
        },
      ],
    })

    const params = {
      supabase,
      unit,
      channel: 'whatsapp' as const,
      incomingPhone: '5511999998888',
      incomingEmail: null,
      text: 'oi, alguma novidade?',
      externalMessageId: 'MSG-DUPLICADO-1',
      sentAt: new Date().toISOString(),
    }

    const first = await routeInboundMessage(params)
    expect(first).toMatchObject({ ok: true, routed: 'recruiter_company' })

    const conversationsAfterFirst = db.conversations!.filter(
      (row) => row.external_message_id === 'MSG-DUPLICADO-1',
    )
    expect(conversationsAfterFirst).toHaveLength(1)

    // Evolution API reentrega o mesmo webhook (mesmo external_message_id)
    const second = await routeInboundMessage(params)
    expect(second).toEqual({ ok: true, duplicate: true })

    const conversationsAfterSecond = db.conversations!.filter(
      (row) => row.external_message_id === 'MSG-DUPLICADO-1',
    )
    expect(conversationsAfterSecond).toHaveLength(1)
  })
})
