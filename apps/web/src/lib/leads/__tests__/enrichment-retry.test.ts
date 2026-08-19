import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { ensureLeadEnrichment, isEnrichmentDue } from '@/lib/leads/enrichment'
import type { Lead } from '@/lib/types'

// Achado P1.1 da auditoria de 18-19/08/2026: antes, um lead sem e-mail
// encontrado na primeira (e única) tentativa de enrichment ficava travado
// pra sempre — enriched_at != null fazia o gate antigo desistir de vez.
// Estes testes cobrem a máquina de estados nova (enrichment_status,
// enrichment_attempts, next_enrichment_retry_at, migration 067) que
// substitui esse comportamento por retry automático com limite.

const { getGoogleMapsApiKey, textSearch, placeDetails } = vi.hoisted(() => ({
  getGoogleMapsApiKey: vi.fn((): string | null => null),
  textSearch: vi.fn(async () => [] as { place_id: string; name: string }[]),
  placeDetails: vi.fn(async () => ({}) as { website?: string }),
}))

vi.mock('@/lib/google-places', () => ({ getGoogleMapsApiKey, textSearch, placeDetails }))

const { getOpenAIApiKey } = vi.hoisted(() => ({
  getOpenAIApiKey: vi.fn((): string | null => null),
}))

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey,
  generateStructuredReply: vi.fn(async () => ({ summary: null })),
}))

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    unit_id: 'unit-1',
    company_name: 'Padaria da Esquina',
    contact_name: null,
    phone: '5511988888888',
    email: null,
    sector: null,
    city: null,
    state: null,
    source: 'google_maps',
    status: 'new',
    google_place_id: null,
    external_lead_id: null,
    enrichment_data: null,
    enriched_at: null,
    enrichment_status: 'enrichment_pending',
    enrichment_attempts: 0,
    next_enrichment_retry_at: null,
    enrichment_source: null,
    enrichment_error: null,
    notes: null,
    last_contacted_at: null,
    deal_profile: {},
    created_at: '',
    updated_at: '',
    ...overrides,
  } as Lead
}

beforeEach(() => {
  getGoogleMapsApiKey.mockReset().mockReturnValue(null)
  textSearch.mockReset().mockResolvedValue([])
  placeDetails.mockReset().mockResolvedValue({})
  getOpenAIApiKey.mockReset().mockReturnValue(null)
  vi.unstubAllEnvs()
})

describe('isEnrichmentDue', () => {
  it('é true pra um lead nunca pesquisado (enrichment_pending)', () => {
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'enrichment_pending' }))).toBe(true)
  })

  it('trata enrichment_status ausente (undefined) como pendente', () => {
    const lead = makeLead()
    delete (lead as { enrichment_status?: unknown }).enrichment_status
    expect(isEnrichmentDue(lead)).toBe(true)
  })

  it('é false pros estados terminais', () => {
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'email_found' }))).toBe(false)
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'email_not_found' }))).toBe(false)
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'enrichment_failed' }))).toBe(false)
  })

  it('retry_scheduled com data futura ainda não está due', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'retry_scheduled', next_enrichment_retry_at: future }))).toBe(false)
  })

  it('retry_scheduled com data passada já está due', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'retry_scheduled', next_enrichment_retry_at: past }))).toBe(true)
  })

  it('retry_scheduled sem next_enrichment_retry_at é tratado como due (dado defensivo)', () => {
    expect(isEnrichmentDue(makeLead({ enrichment_status: 'retry_scheduled', next_enrichment_retry_at: null }))).toBe(true)
  })
})

describe('ensureLeadEnrichment', () => {
  it('pula a pesquisa e não escreve no banco quando o lead não está due', async () => {
    const { supabase, db } = createFakeSupabase({ leads: [] })
    const lead = makeLead({ enrichment_status: 'email_not_found' })
    const result = await ensureLeadEnrichment(supabase, lead)
    expect(result).toBe(lead)
    expect(getGoogleMapsApiKey).not.toHaveBeenCalled()
    expect(db.leads).toHaveLength(0)
  })

  it('força a pesquisa mesmo fora da janela quando force:true', async () => {
    const { supabase } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ enrichment_status: 'email_not_found', enrichment_attempts: 3 })
    const result = await ensureLeadEnrichment(supabase, lead, { force: true })
    expect(getGoogleMapsApiKey).toHaveBeenCalled()
    // já esgotou tentativas (>= MAX_ENRICHMENT_ATTEMPTS padrão 3) e não achou nada -> continua email_not_found
    expect(result.enrichment_status).toBe('email_not_found')
  })

  it('lead que já tem e-mail cadastrado sempre resolve email_found, mesmo sem pesquisa nova', async () => {
    const { supabase } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ email: 'contato@padaria.com', enrichment_status: 'enrichment_pending' })
    const result = await ensureLeadEnrichment(supabase, lead)
    expect(result.enrichment_status).toBe('email_found')
    expect(result.enrichment_attempts).toBe(1)
  })

  it('primeira tentativa sem achar nada agenda retry (retry_scheduled), não desiste', async () => {
    const { supabase, db } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ enrichment_status: 'enrichment_pending', enrichment_attempts: 0 })
    const result = await ensureLeadEnrichment(supabase, lead)
    expect(result.enrichment_status).toBe('retry_scheduled')
    expect(result.enrichment_attempts).toBe(1)
    expect(result.next_enrichment_retry_at).not.toBeNull()
    expect(result.email).toBeNull()
    // persistiu no banco (não é só best-effort em memória)
    expect(db.leads?.[0]?.enrichment_status).toBe('retry_scheduled')
  })

  it('esgota as tentativas (padrão 3) e desiste com email_not_found, sem erro', async () => {
    const { supabase } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ enrichment_status: 'retry_scheduled', enrichment_attempts: 2, next_enrichment_retry_at: null })
    const result = await ensureLeadEnrichment(supabase, lead)
    expect(result.enrichment_attempts).toBe(3)
    expect(result.enrichment_status).toBe('email_not_found')
    expect(result.next_enrichment_retry_at).toBeNull()
    expect(result.enrichment_error).toBeNull()
  })

  it('acha e-mail no site e preenche lead.email quando o lead não tinha nenhum', async () => {
    getGoogleMapsApiKey.mockReturnValue('fake-key')
    placeDetails.mockResolvedValue({ website: 'https://padaria.com' })
    const { supabase } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ google_place_id: 'place-123', enrichment_status: 'enrichment_pending' })

    const originalFetch = global.fetch
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => 'text/html' },
        text: async () => '<html>Contato: vendas@padaria.com</html>',
      })),
    )
    try {
      const result = await ensureLeadEnrichment(supabase, lead)
      expect(result.enrichment_status).toBe('email_found')
      expect(result.email).toBe('vendas@padaria.com')
      expect(result.enrichment_source).toBe('website')
    } finally {
      vi.stubGlobal('fetch', originalFetch)
    }
  })

  it('falha inesperada na pesquisa (erro, não "não achou") agenda retry e guarda enrichment_error', async () => {
    getGoogleMapsApiKey.mockImplementation(() => {
      throw new Error('boom')
    })
    const { supabase } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ enrichment_status: 'enrichment_pending', enrichment_attempts: 0 })
    const result = await ensureLeadEnrichment(supabase, lead)
    expect(result.enrichment_status).toBe('retry_scheduled')
    expect(result.enrichment_error).toBe('boom')
  })

  it('falha inesperada repetida até esgotar tentativas vira enrichment_failed (distinto de email_not_found)', async () => {
    getGoogleMapsApiKey.mockImplementation(() => {
      throw new Error('boom')
    })
    const { supabase } = createFakeSupabase({ leads: [{ id: 'lead-1' }] })
    const lead = makeLead({ enrichment_status: 'retry_scheduled', enrichment_attempts: 2 })
    const result = await ensureLeadEnrichment(supabase, lead)
    expect(result.enrichment_attempts).toBe(3)
    expect(result.enrichment_status).toBe('enrichment_failed')
    expect(result.enrichment_error).toBe('boom')
  })
})
