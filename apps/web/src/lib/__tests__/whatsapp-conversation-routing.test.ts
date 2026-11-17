import { describe, expect, it } from 'vitest'
import {
  assignWhatsappConversation,
  getWhatsappConversationRoute,
  whatsappContactKey,
  retainReceptionistOwnership,
} from '@/lib/whatsapp-conversation-routing'
import { routeInboundMessage } from '@/lib/inbound-router'
import { createFakeSupabase } from './fake-supabase'
import type { Unit } from '@/lib/types'

const unit = { id: 'unit-1', org_id: 'org-1' } as Unit

describe('WhatsApp compartilhado — propriedade da conversa', () => {
  it('normaliza telefone/e-mail para uma chave estável', () => {
    expect(whatsappContactKey('+55 (11) 99999-8888', null)).toBe('phone:5511999998888')
    expect(whatsappContactKey(null, ' Cliente@Empresa.COM ')).toBe('email:cliente@empresa.com')
  })

  it('mantém um único responsável por contato e registra o anterior no handoff', async () => {
    const { supabase, db } = createFakeSupabase()

    await assignWhatsappConversation({
      supabase,
      unit,
      phone: '5511999998888',
      email: null,
      agentType: 'triage',
    })
    await assignWhatsappConversation({
      supabase,
      unit,
      phone: '+55 11 99999-8888',
      email: null,
      agentType: 'sdr',
      reason: 'Contato quer conhecer a proposta comercial',
      summary: 'Triagem confirmou que representa uma empresa.',
    })

    expect(db.whatsapp_conversation_routes).toHaveLength(1)
    const route = await getWhatsappConversationRoute(supabase, unit.id, '5511999998888', null)
    expect(route).toMatchObject({
      agent_type: 'sdr',
      previous_agent_type: 'triage',
      handoff_reason: 'Contato quer conhecer a proposta comercial',
      handoff_summary: 'Triagem confirmou que representa uma empresa.',
      status: 'active',
    })
  })

  it('isola a propriedade por unidade mesmo quando o telefone é igual', async () => {
    const { supabase, db } = createFakeSupabase()
    await assignWhatsappConversation({ supabase, unit, phone: '5511999998888', email: null, agentType: 'sdr' })
    await assignWhatsappConversation({
      supabase,
      unit: { id: 'unit-2', org_id: 'org-1' },
      phone: '5511999998888',
      email: null,
      agentType: 'receptionist',
    })

    expect(db.whatsapp_conversation_routes).toHaveLength(2)
    await expect(getWhatsappConversationRoute(supabase, 'unit-1', '5511999998888', null)).resolves.toMatchObject({
      agent_type: 'sdr',
    })
    await expect(getWhatsappConversationRoute(supabase, 'unit-2', '5511999998888', null)).resolves.toMatchObject({
      agent_type: 'receptionist',
    })
  })

  it('não desfaz um handoff da Recepcionista para o Sales', async () => {
    const { supabase } = createFakeSupabase()
    await assignWhatsappConversation({ supabase, unit, phone: '5511999998888', email: null, agentType: 'receptionist' })
    await assignWhatsappConversation({
      supabase,
      unit,
      phone: '5511999998888',
      email: null,
      agentType: 'sdr',
      reason: 'Cliente pediu proposta',
      summary: 'Recepção coletou o contexto comercial.',
    })

    await retainReceptionistOwnership({ supabase, unit, phone: '5511999998888', email: null })

    const route = await getWhatsappConversationRoute(supabase, unit.id, '5511999998888', null)
    expect(route).toMatchObject({
      agent_type: 'sdr',
      previous_agent_type: 'receptionist',
      handoff_reason: 'Cliente pediu proposta',
    })
  })

  it('uma nova mensagem volta obrigatoriamente ao Receptionist mesmo quando a conversa estava com Sales', async () => {
    const { supabase } = createFakeSupabase({
      agent_configs: [
        { id: 'rec-1', unit_id: unit.id, agent_type: 'receptionist', persona_name: 'Ana', is_active: true },
      ],
      leads: [
        { id: 'lead-1', unit_id: unit.id, phone: '5511999998888', email: null, company_name: 'Lead Franquia' },
      ],
    })
    await assignWhatsappConversation({
      supabase,
      unit,
      phone: '5511999998888',
      email: null,
      agentType: 'sdr',
      reason: 'Victor estava atendendo venda de franquia',
      summary: 'Contato pediu informações comerciais.',
    })

    const result = await routeInboundMessage({
      supabase,
      unit: { ...unit, name: 'Smarter Matriz' },
      channel: 'whatsapp',
      incomingPhone: '5511999998888',
      incomingEmail: null,
      text: 'Tenho mais uma dúvida sobre a franquia',
      externalMessageId: 'msg-ana-first-1',
      sentAt: '2026-11-17T12:00:00.000Z',
    })

    expect(result).toMatchObject({ ok: true, routed: 'receptionist_prospect' })
    await expect(getWhatsappConversationRoute(supabase, unit.id, '5511999998888', null)).resolves.toMatchObject({
      agent_type: 'receptionist',
      previous_agent_type: 'sdr',
    })
  })
})
