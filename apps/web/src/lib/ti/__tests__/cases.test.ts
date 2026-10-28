import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { openSupportCase } from '@/lib/ti/cases'

describe('openSupportCase', () => {
  it('cria protocolo e histórico auditável do relato e diagnóstico', async () => {
    const { supabase, db } = createFakeSupabase({})
    const result = await openSupportCase(supabase, {
      orgId: 'org-1',
      unitId: 'unit-1',
      channel: 'dashboard',
      category: 'bug',
      title: 'QR não atualiza',
      description: 'O celular conectou, mas o painel não atualizou.',
      diagnosis: 'A leitura encontrou atraso na sincronização de status.',
    })

    expect(result.created).toBe(true)
    expect(result.protocol).toMatch(/^TI-[A-F0-9]{8}$/)
    expect(db.support_cases).toHaveLength(1)
    expect(db.support_case_messages).toHaveLength(2)
  })

  it('é idempotente para a referência enviada por um parceiro', async () => {
    const { supabase, db } = createFakeSupabase({})
    const input = {
      orgId: 'org-1',
      channel: 'partner_api' as const,
      category: 'bug' as const,
      title: 'Erro externo',
      description: 'Falha relatada no sistema parceiro.',
      sourceSystem: 'partner' as const,
      externalReference: 'ticket-123',
    }
    const first = await openSupportCase(supabase, input)
    const second = await openSupportCase(supabase, { ...input, description: 'Texto atualizado que não deve duplicar.' })

    expect(first.created).toBe(true)
    expect(second).toEqual({ id: first.id, protocol: first.protocol, created: false })
    expect(db.support_cases).toHaveLength(1)
  })
})
