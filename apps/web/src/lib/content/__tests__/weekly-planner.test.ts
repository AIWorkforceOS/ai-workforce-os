import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialAccount } from '../types'

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

const unit = { id: 'unit-1', org_id: 'org-1', name: 'Mawi Cleaning' } as Unit
const config = {
  id: 'cfg-1',
  unit_id: 'unit-1',
  agent_type: 'content_specialist',
  persona_name: 'Bia',
  persona_tone: 'friendly',
  daily_limit: 15,
  active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  escalation_rules: { after_messages: 5, keywords: [] },
  sectors: [],
  is_active: true,
  business_profile: { pilares_conteudo: ['bastidores', 'dicas'], plataformas: ['instagram'] },
  created_at: '',
  updated_at: '',
} as AgentConfig
const account = {
  id: 'acc-1',
  org_id: 'org-1',
  unit_id: 'unit-1',
  page_id: 'page-1',
  page_name: 'Mawi Cleaning',
  page_access_token: 'tok',
  instagram_business_account_id: 'ig-1',
  instagram_username: 'mawicleaning',
  connection_status: 'connected',
  publishing_mode: 'suggestion',
  is_active: true,
} as SocialAccount

let generatePostContentMock: ReturnType<typeof vi.fn>
let generatePostImageMock: ReturnType<typeof vi.fn>
let uploadGeneratedImageMock: ReturnType<typeof vi.fn>

async function loadModule(dbSeed: Record<string, Record<string, unknown>[]> = {}) {
  const { supabase, db } = createFakeSupabase(dbSeed)

  generatePostContentMock = vi.fn(async () => ({ caption: 'legenda gerada', imagePrompt: 'a scene', reasoning: 'porque sim' }))
  generatePostImageMock = vi.fn(async () => ({ base64Image: 'aW1n' }))
  uploadGeneratedImageMock = vi.fn(async () => 'https://cdn.example.com/img.png')

  vi.doMock('../generator', () => ({
    generatePostContent: generatePostContentMock,
    generatePostImage: generatePostImageMock,
    uploadGeneratedImage: uploadGeneratedImageMock,
  }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile: async () => null }))

  const mod = await import('../weekly-planner')
  return { mod, supabase, db }
}

describe('generateWeekPostsForAccount', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sem datas, não gera nada e não toca no banco', async () => {
    const { mod } = await loadModule()
    const result = await mod.generateWeekPostsForAccount({ supabase: undefined as never, apiKey: 'k', config, unit, account, dates: [] })
    expect(result).toEqual({ created: 0, skipped: 0, errors: [] })
    expect(generatePostContentMock).not.toHaveBeenCalled()
  })

  it('gera um post por data, cada um com o scheduled_for certo', async () => {
    const { mod, supabase, db } = await loadModule({ content_posts: [] })
    const dates = [utc(2026, 9, 7), utc(2026, 9, 9), utc(2026, 9, 11)] // seg/qua/sex

    const result = await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })

    expect(result).toEqual({ created: 3, skipped: 0, errors: [] })
    expect(generatePostContentMock).toHaveBeenCalledTimes(3)
    expect(generatePostImageMock).toHaveBeenCalledTimes(3)

    const posts = db.content_posts as Record<string, unknown>[]
    expect(posts).toHaveLength(3)
    const scheduledDates = posts.map((p) => String(p.scheduled_for).slice(0, 10)).sort()
    expect(scheduledDates).toEqual(['2026-09-07', '2026-09-09', '2026-09-11'])
    for (const p of posts) expect(p.status).toBe('pending_approval') // conta em modo 'suggestion'
  })

  it('modo autônomo marca approved (mas não publica — quem publica é o cron, na data)', async () => {
    const { mod, supabase, db } = await loadModule({ content_posts: [] })
    const autonomousAccount = { ...account, publishing_mode: 'autonomous' as const }

    await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account: autonomousAccount, dates: [utc(2026, 9, 7)] })

    const posts = db.content_posts as Record<string, unknown>[]
    expect(posts[0]?.status).toBe('approved')
  })

  it('pula uma data que já tem post agendado (não gera duplicado)', async () => {
    const { mod, supabase, db } = await loadModule({
      content_posts: [
        {
          id: 'existing-1',
          social_account_id: 'acc-1',
          platform: 'instagram',
          content_pillar: 'dicas',
          scheduled_for: utc(2026, 9, 7).toISOString(),
          status: 'pending_approval',
          created_at: utc(2026, 9, 5).toISOString(),
        },
      ],
    })
    const dates = [utc(2026, 9, 7), utc(2026, 9, 9)]

    const result = await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })

    expect(result).toEqual({ created: 1, skipped: 1, errors: [] })
    expect(db.content_posts).toHaveLength(2) // 1 pré-existente + 1 novo
  })

  it('regressão (2026-08-28, conta AlizoAi): post rejeitado não bloqueia gerar de novo na mesma data ("já existe")', async () => {
    const { mod, supabase, db } = await loadModule({
      content_posts: [
        {
          id: 'rejected-1',
          social_account_id: 'acc-1',
          platform: 'instagram',
          content_pillar: 'dicas',
          scheduled_for: utc(2026, 9, 7).toISOString(),
          status: 'rejected',
          created_at: utc(2026, 9, 5).toISOString(),
        },
      ],
    })
    const dates = [utc(2026, 9, 7)]

    const result = await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })

    expect(result).toEqual({ created: 1, skipped: 0, errors: [] })
    expect(db.content_posts).toHaveLength(2) // 1 rejeitado (mantido) + 1 novo
  })

  it('sem nenhuma plataforma suportada pela conta, devolve erro e não gera nada', async () => {
    const { mod, supabase } = await loadModule({ content_posts: [] })
    const igOnlyConfig = { ...config, business_profile: { plataformas: ['instagram'] } } as AgentConfig
    const accountWithoutIg = { ...account, instagram_business_account_id: null }

    const result = await mod.generateWeekPostsForAccount({
      supabase,
      apiKey: 'k',
      config: igOnlyConfig,
      unit,
      account: accountWithoutIg,
      dates: [utc(2026, 9, 7)],
    })

    expect(result.created).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(generatePostContentMock).not.toHaveBeenCalled()
  })

  it('erro num dia não derruba os outros dias do lote', async () => {
    const { mod, supabase, db } = await loadModule({ content_posts: [] })
    generatePostContentMock.mockRejectedValueOnce(new Error('OpenAI falhou'))

    const dates = [utc(2026, 9, 7), utc(2026, 9, 9)]
    const result = await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })

    expect(result.created).toBe(1)
    expect(result.errors).toEqual([{ date: '2026-09-07', error: 'OpenAI falhou' }])
    expect(db.content_posts).toHaveLength(1)
  })

  it('data comemorativa (Natal) é passada pro gerador e aparece no reasoning salvo', async () => {
    const { mod, supabase, db } = await loadModule({ content_posts: [] })
    await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates: [utc(2026, 12, 25)] })

    expect(generatePostContentMock).toHaveBeenCalledWith(expect.objectContaining({ holiday: 'Natal' }))
    const posts = db.content_posts as Record<string, unknown>[]
    expect(posts[0]?.reasoning).toContain('Natal')
  })
})
