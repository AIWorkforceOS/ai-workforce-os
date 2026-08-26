import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// Regressão (2026-08-26): a KAI passou a estudar o site da empresa
// automaticamente quando o dono cola uma URL no chat (lib/company-research.ts),
// e a incorporar isso em organizations.business_profile.company_dossier
// quando a entrevista termina — visível a todos os 6 funcionários digitais
// via buildCombinedBusinessContext. Pedido do Vinicius: "ela precisa ser
// como um funcionario de fato onde estuda os arquivos da empresa".

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/kai/onboarding', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function loadRoute(opts: {
  supabase: unknown
  service: unknown
  researchResult?: { ok: true; summary: string; url: string } | { ok: false; error: string }
  output?: Record<string, unknown>
}) {
  const researchCompanyWebsite = vi.fn(async () => opts.researchResult ?? { ok: false, error: 'não usado neste teste' })
  vi.doMock('@/lib/app-user', () => ({ getAppUser: async () => ({ orgId: 'org-1' }) }))
  vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => opts.supabase }))
  vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: () => opts.service }))
  vi.doMock('@/lib/openai', () => ({
    getOpenAIApiKey: () => 'fake-key',
    generateStructuredReply: async () =>
      opts.output ?? { message: 'Entendi, obrigada!', profile_updates: {}, asked_final_question: false, interview_complete: false },
  }))
  vi.doMock('@/lib/company-research', () => ({ researchCompanyWebsite }))
  const route = await import('../route')
  return { ...route, researchCompanyWebsite }
}

describe('POST /api/kai/onboarding — pesquisa de site', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('mensagem sem URL: não tenta estudar site nenhum', async () => {
    const { supabase } = createFakeSupabase({
      organizations: [{ id: 'org-1', name: 'Padaria Estrela', vertical_key: null, business_profile: {} }],
    })
    const { POST, researchCompanyWebsite } = await loadRoute({ supabase, service: supabase })

    await POST(makeRequest({ message: 'Somos uma padaria de bairro.' }))

    expect(researchCompanyWebsite).not.toHaveBeenCalled()
  })

  it('mensagem com URL solta no meio do texto: estuda o site e guarda o progresso', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [{ id: 'org-1', name: 'Padaria Estrela', vertical_key: null, business_profile: {} }],
    })
    const { POST, researchCompanyWebsite } = await loadRoute({
      supabase,
      service: supabase,
      researchResult: { ok: true, summary: 'Padaria com cardápio de pães e bolos.', url: 'https://padariaestrela.com.br/' },
    })

    const res = await POST(makeRequest({ message: 'Nosso site é padariaestrela.com.br, dá uma olhada' }))

    expect(res.status).toBe(200)
    expect(researchCompanyWebsite).toHaveBeenCalledWith(expect.objectContaining({ url: 'padariaestrela.com.br' }))

    const org = (db.organizations as Array<Record<string, unknown>>)[0]!
    const savedProfile = (org.business_profile as { _kai_onboarding?: { profile?: Record<string, unknown> } })._kai_onboarding?.profile
    expect(savedProfile?._website_research).toBe('Padaria com cardápio de pães e bolos.')
    expect(savedProfile?._website_research_url).toBe('padariaestrela.com.br')
  })

  it('mesma URL já estudada num turno anterior: não estuda de novo', async () => {
    const { supabase } = createFakeSupabase({
      organizations: [
        {
          id: 'org-1',
          name: 'Padaria Estrela',
          vertical_key: null,
          business_profile: {
            _kai_onboarding: {
              transcript: [{ role: 'assistant', content: 'oi' }],
              profile: { _website_research_url: 'padariaestrela.com.br', _website_research: 'já estudado antes' },
            },
          },
        },
      ],
    })
    const { POST, researchCompanyWebsite } = await loadRoute({ supabase, service: supabase })

    await POST(makeRequest({ message: 'de novo, padariaestrela.com.br' }))

    expect(researchCompanyWebsite).not.toHaveBeenCalled()
  })

  it('site inacessível: segue a entrevista normalmente, sem travar (best-effort)', async () => {
    const { supabase } = createFakeSupabase({
      organizations: [{ id: 'org-1', name: 'Padaria Estrela', vertical_key: null, business_profile: {} }],
    })
    const { POST } = await loadRoute({
      supabase,
      service: supabase,
      researchResult: { ok: false, error: 'Não consegui acessar esse site agora.' },
    })

    const res = await POST(makeRequest({ message: 'padariaestrela.com.br' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.reply).toBeTruthy()
  })

  it('entrevista concluída com dossiê do site já coletado: vira organizations.business_profile.company_dossier, visível a todos os funcionários', async () => {
    const { supabase, db } = createFakeSupabase({
      organizations: [
        {
          id: 'org-1',
          name: 'Padaria Estrela',
          vertical_key: null,
          business_profile: {
            _kai_onboarding: {
              transcript: [{ role: 'assistant', content: 'oi', asked_final: true }],
              profile: {
                _website_research_url: 'padariaestrela.com.br',
                _website_research: 'Padaria com cardápio de pães e bolos, aberta das 6h às 20h.',
                org_vertical_confirmed: true,
                org_vertical_key: 'restaurant_food_service',
                org_company_name: 'Padaria Estrela',
              },
            },
          },
        },
      ],
    })
    const { POST } = await loadRoute({
      supabase,
      service: supabase,
      output: { message: 'Perfeito, já estou pronta!', profile_updates: {}, asked_final_question: true, interview_complete: true },
    })

    const res = await POST(makeRequest({ message: 'Não, é isso mesmo.' }))
    expect(res.status).toBe(200)

    const org = (db.organizations as Array<Record<string, unknown>>)[0]!
    expect(org.vertical_key).toBe('restaurant_food_service')
    expect((org.business_profile as Record<string, unknown>).company_dossier).toBe(
      'Padaria com cardápio de pães e bolos, aberta das 6h às 20h.',
    )
    // Estado temporário da entrevista some depois de concluída
    expect((org.business_profile as Record<string, unknown>)._kai_onboarding).toBeUndefined()
  })
})
