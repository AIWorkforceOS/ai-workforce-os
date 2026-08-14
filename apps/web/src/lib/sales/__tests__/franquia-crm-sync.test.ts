import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { FRANQUIA_CRM_SOURCE, syncFranquiaCrmLeads } from '@/lib/sales/franquia-crm-sync'
import type { FranquiaCrmLead } from '@/lib/sales/smarter-crm'

// Ingestão dos leads do CRM de Franquias da Smarter (2026-08-14): cobrimos
// dedupe (não duplica o mesmo external_lead_id), o status deliberadamente
// diferente de 'new' (não pode ser pego por triggerFirstContact/follow-up),
// não sobrescrever o status de um lead que um humano já mudou, e o
// comportamento "no-op silencioso" quando não está configurado.

const { listFranquiaCrmLeads, getSmarterFranquiaCrmToken, getSmarterFranquiaCrmUnitId } = vi.hoisted(() => ({
  listFranquiaCrmLeads: vi.fn(),
  getSmarterFranquiaCrmToken: vi.fn((): string | null => 'token-fake'),
  getSmarterFranquiaCrmUnitId: vi.fn(() => 'unit-matriz'),
}))
const { logSystemEvent } = vi.hoisted(() => ({ logSystemEvent: vi.fn(async () => {}) }))

vi.mock('@/lib/sales/smarter-crm', () => ({
  listFranquiaCrmLeads,
  getSmarterFranquiaCrmToken,
  getSmarterFranquiaCrmUnitId,
}))
vi.mock('@/lib/system-events', () => ({ logSystemEvent }))

function franquiaLead(overrides: Partial<FranquiaCrmLead> = {}): FranquiaCrmLead {
  return {
    id: 'fl-1',
    nomeCompleto: 'Fulano de Tal',
    email: 'fulano@example.com',
    telefone: '+5511999990000',
    cidade: 'Curitiba',
    estado: 'PR',
    etapa: 'novo_lead',
    situacao: 'ativo',
    origem: 'meta_ads',
    leadFrio: true,
    optIn: true,
    ultimoContato: null,
    proximaAcao: null,
    createdAt: '2026-06-24T00:00:00Z',
    ultimaNota: null,
    ...overrides,
  }
}

function onePage(leads: FranquiaCrmLead[]) {
  return { leads, pagination: { hasMore: false, nextCursor: null } }
}

describe('syncFranquiaCrmLeads', () => {
  beforeEach(() => {
    listFranquiaCrmLeads.mockReset()
    getSmarterFranquiaCrmToken.mockReset().mockReturnValue('token-fake')
    getSmarterFranquiaCrmUnitId.mockReset().mockReturnValue('unit-matriz')
    logSystemEvent.mockReset().mockResolvedValue(undefined)
  })

  it('sem token ou sem unit id configurado: no-op silencioso, não chama a API', async () => {
    getSmarterFranquiaCrmToken.mockReturnValue(null)
    const { supabase } = createFakeSupabase()

    const result = await syncFranquiaCrmLeads(supabase)

    expect(result.ok).toBe(true)
    expect(result.imported).toBe(0)
    expect(listFranquiaCrmLeads).not.toHaveBeenCalled()
  })

  it('importa lead novo com status imported_pending_review, nunca "new"', async () => {
    const { supabase, db } = createFakeSupabase()
    listFranquiaCrmLeads.mockResolvedValueOnce(onePage([franquiaLead()]))

    const result = await syncFranquiaCrmLeads(supabase)

    expect(result.imported).toBe(1)
    const [row] = db.leads!
    expect(row!.status).toBe('imported_pending_review')
    expect(row!.status).not.toBe('new')
    expect(row!.source).toBe(FRANQUIA_CRM_SOURCE)
    expect(row!.external_lead_id).toBe('fl-1')
    expect(row!.unit_id).toBe('unit-matriz')
  })

  it('lead já importado antes (mesmo external_lead_id): atualiza dados, não duplica', async () => {
    const { supabase, db } = createFakeSupabase({
      leads: [
        {
          id: 'lead-existing',
          unit_id: 'unit-matriz',
          source: FRANQUIA_CRM_SOURCE,
          external_lead_id: 'fl-1',
          status: 'imported_pending_review',
          company_name: 'Nome Antigo',
        },
      ],
    })
    listFranquiaCrmLeads.mockResolvedValueOnce(onePage([franquiaLead({ nomeCompleto: 'Nome Novo' })]))

    const result = await syncFranquiaCrmLeads(supabase)

    expect(result.imported).toBe(0)
    expect(result.updated).toBe(1)
    expect(db.leads).toHaveLength(1)
    expect(db.leads![0]!.company_name).toBe('Nome Novo')
  })

  it('nunca sobrescreve o status de um lead que já foi movido por um humano', async () => {
    const { supabase, db } = createFakeSupabase({
      leads: [
        {
          id: 'lead-existing',
          unit_id: 'unit-matriz',
          source: FRANQUIA_CRM_SOURCE,
          external_lead_id: 'fl-1',
          status: 'contacted', // um humano já assumiu esse lead manualmente
          company_name: 'Fulano de Tal',
        },
      ],
    })
    listFranquiaCrmLeads.mockResolvedValueOnce(onePage([franquiaLead()]))

    await syncFranquiaCrmLeads(supabase)

    expect(db.leads![0]!.status).toBe('contacted')
  })

  it('pagina até esgotar hasMore, agregando os totais', async () => {
    const { supabase, db } = createFakeSupabase()
    listFranquiaCrmLeads
      .mockResolvedValueOnce({ leads: [franquiaLead({ id: 'fl-1' })], pagination: { hasMore: true, nextCursor: 'fl-1' } })
      .mockResolvedValueOnce(onePage([franquiaLead({ id: 'fl-2' })]))

    const result = await syncFranquiaCrmLeads(supabase)

    expect(result.imported).toBe(2)
    expect(db.leads).toHaveLength(2)
    expect(listFranquiaCrmLeads).toHaveBeenCalledTimes(2)
    expect(listFranquiaCrmLeads).toHaveBeenNthCalledWith(2, 'token-fake', expect.objectContaining({ cursor: 'fl-1' }))
  })

  it('API da Smarter falhando não lança — devolve ok:false e loga o erro', async () => {
    const { supabase } = createFakeSupabase()
    listFranquiaCrmLeads.mockRejectedValueOnce(new Error('Smarter fora do ar (simulado)'))

    const result = await syncFranquiaCrmLeads(supabase)

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/fora do ar/)
    expect(logSystemEvent).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ eventType: 'smarter_franquia_crm_sync_failed' }),
    )
  })
})
