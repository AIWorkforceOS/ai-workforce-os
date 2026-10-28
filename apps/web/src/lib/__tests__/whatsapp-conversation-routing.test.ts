import { describe, expect, it } from 'vitest'
import {
  assignWhatsappConversation,
  getWhatsappConversationRoute,
  whatsappContactKey,
} from '@/lib/whatsapp-conversation-routing'
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
})
