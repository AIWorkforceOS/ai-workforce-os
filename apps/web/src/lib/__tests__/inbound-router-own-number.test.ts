import { describe, expect, it } from 'vitest'
import { isOwnConnectedNumber, routeInboundMessage, routeReceptionistChannelMessage } from '@/lib/inbound-router'
import { createFakeSupabase } from './fake-supabase'
import type { Unit } from '@/lib/types'

// Regressão de produção (2026-08-01, unidade Matriz): dois agentes com
// números dedicados (Sales Rep e Recepcionista, migration 051) acabaram
// "conversando" um com o outro depois de um teste manual usar o número
// de um agente como se fosse cliente do outro. A resposta automática de
// um agente chegava no outro como mensagem inbound de verdade (remetente
// real, external_message_id real da Evolution) e virava uma nova
// resposta automática — um loop de bot-para-bot, exatamente o padrão de
// tráfego automatizado que a Meta detecta e usa para banir (este número
// já tinha sido banido antes por um padrão parecido). Nem o guard de
// self-echo (route.ts, compara só com o número do PRÓPRIO canal) nem o
// isRecentOutboundEcho (depende do texto ainda ser idêntico e de uma
// janela de 60s) cobrem sozinhos este caso — isOwnConnectedNumber é a
// trava estrutural: nunca trata outro número NOSSO como cliente.

const unit = { id: 'unit-1', org_id: 'org-1', name: 'Unidade Teste', whatsapp_phone: null } as Unit

describe('isOwnConnectedNumber', () => {
  it('true quando o telefone recebido é o número dedicado de outro agente na mesma organização', async () => {
    const { supabase } = createFakeSupabase({
      unit_whatsapp_channels: [
        { id: 'ch-1', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'sdr', whatsapp_phone: '5521976087544' },
        { id: 'ch-2', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'receptionist', whatsapp_phone: '5521977188527' },
      ],
    })

    // Mensagem "recebida" na Recepcionista, mas o remetente é literalmente
    // o número conectado do Sales Rep (mesma org).
    expect(await isOwnConnectedNumber(supabase, unit, '5521976087544')).toBe(true)
  })

  it('true quando o telefone bate com o número compartilhado legado (units.whatsapp_phone) de outra unidade da org', async () => {
    const { supabase } = createFakeSupabase({
      units: [{ id: 'unit-2', org_id: 'org-1', whatsapp_phone: '5511988887777' }],
    })

    expect(await isOwnConnectedNumber(supabase, unit, '5511988887777')).toBe(true)
  })

  it('false para um telefone de cliente real, sem relação com nenhum canal conectado', async () => {
    const { supabase } = createFakeSupabase({
      unit_whatsapp_channels: [
        { id: 'ch-1', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'sdr', whatsapp_phone: '5521976087544' },
      ],
    })

    expect(await isOwnConnectedNumber(supabase, unit, '5521999990000')).toBe(false)
  })

  it('false sem telefone recebido', async () => {
    const { supabase } = createFakeSupabase({})
    expect(await isOwnConnectedNumber(supabase, unit, null)).toBe(false)
  })
})

describe('routeInboundMessage / routeReceptionistChannelMessage — bloqueio de loop bot-a-bot', () => {
  it('routeInboundMessage ignora mensagem cujo remetente é o número dedicado da Recepcionista na mesma org, sem criar lead nem responder', async () => {
    const { supabase, db } = createFakeSupabase({
      unit_whatsapp_channels: [
        { id: 'ch-1', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'sdr', whatsapp_phone: '5521976087544' },
        { id: 'ch-2', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'receptionist', whatsapp_phone: '5521977188527' },
      ],
    })

    const result = await routeInboundMessage({
      supabase,
      unit,
      channel: 'whatsapp',
      incomingPhone: '5521977188527', // número da Recepcionista, "recebido" no lado do Sales Rep
      incomingEmail: null,
      text: 'Bom dia! Como posso te ajudar hoje?',
      externalMessageId: 'REAL-EVOLUTION-ID-1',
      sentAt: new Date().toISOString(),
    })

    expect(result).toEqual({ ok: true, skipped: 'own_number' })
    expect(db.leads ?? []).toHaveLength(0)
    expect(db.conversations ?? []).toHaveLength(0)
  })

  it('routeReceptionistChannelMessage ignora mensagem cujo remetente é o número dedicado do Sales Rep na mesma org', async () => {
    const { supabase, db } = createFakeSupabase({
      unit_whatsapp_channels: [
        { id: 'ch-1', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'sdr', whatsapp_phone: '5521976087544' },
        { id: 'ch-2', org_id: 'org-1', unit_id: 'unit-1', agent_type: 'receptionist', whatsapp_phone: '5521977188527' },
      ],
      customers: [],
    })

    const result = await routeReceptionistChannelMessage({
      supabase,
      unit,
      channel: 'whatsapp',
      incomingPhone: '5521976087544', // número do Sales Rep, "recebido" no lado da Recepcionista
      incomingEmail: null,
      text: 'Parece que você precisa de ajuda com algo relacionado a finanças ou contratos. Pode me dizer qual é sua dúvida ou problema?',
      externalMessageId: 'REAL-EVOLUTION-ID-2',
      sentAt: new Date().toISOString(),
    })

    expect(result).toEqual({ ok: true, skipped: 'own_number' })
    expect(db.leads ?? []).toHaveLength(0)
    expect(db.conversations ?? []).toHaveLength(0)
    expect(db.customer_messages ?? []).toHaveLength(0)
  })
})
