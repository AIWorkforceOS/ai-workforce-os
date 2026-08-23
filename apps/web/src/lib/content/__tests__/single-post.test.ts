import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialAccount } from '../types'

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
  business_profile: { pilares_conteudo: ['bastidores'], plataformas: ['instagram'] },
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
let publishContentPostMock: ReturnType<typeof vi.fn>

async function loadModule() {
  const { supabase, db } = createFakeSupabase({ content_posts: [] })

  generatePostContentMock = vi.fn(async () => ({ caption: 'legenda', imagePrompt: 'a scene', reasoning: 'porque sim' }))
  generatePostImageMock = vi.fn(async () => ({ base64Image: 'aW1n' }))
  uploadGeneratedImageMock = vi.fn(async () => 'https://cdn.example.com/img.png')
  publishContentPostMock = vi.fn(async () => ({ ok: true, externalPostId: 'ext-1' }))

  vi.doMock('../generator', () => ({
    generatePostContent: generatePostContentMock,
    generatePostImage: generatePostImageMock,
    uploadGeneratedImage: uploadGeneratedImageMock,
  }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile: async () => null }))
  vi.doMock('../publisher', () => ({ publishContentPost: publishContentPostMock }))

  const mod = await import('../single-post')
  return { mod, supabase, db }
}

describe('generateSinglePostForAccount', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('sem scheduledFor (botão "criar agora"), conta autônoma publica na hora', async () => {
    const { mod, supabase } = await loadModule()
    const autonomousAccount = { ...account, publishing_mode: 'autonomous' as const }

    const result = await mod.generateSinglePostForAccount({ supabase, apiKey: 'k', config, unit, account: autonomousAccount, recentPosts: [] })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(true)
      expect(result.post.status).toBe('approved')
    }
    expect(publishContentPostMock).toHaveBeenCalledTimes(1)
  })

  it('sem scheduledFor, conta em fila de aprovação não publica na hora', async () => {
    const { mod, supabase } = await loadModule()

    const result = await mod.generateSinglePostForAccount({ supabase, apiKey: 'k', config, unit, account, recentPosts: [] })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(false)
      expect(result.post.status).toBe('pending_approval')
    }
    expect(publishContentPostMock).not.toHaveBeenCalled()
  })

  it('com scheduledFor no futuro, mesmo conta autônoma NÃO publica agora (planejamento semanal)', async () => {
    const { mod, supabase } = await loadModule()
    const autonomousAccount = { ...account, publishing_mode: 'autonomous' as const }
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

    const result = await mod.generateSinglePostForAccount({
      supabase,
      apiKey: 'k',
      config,
      unit,
      account: autonomousAccount,
      recentPosts: [],
      scheduledFor: future,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(false)
      expect(result.post.status).toBe('approved')
    }
    expect(publishContentPostMock).not.toHaveBeenCalled()
  })

  it('sem plataforma suportada, devolve erro sem chamar geração', async () => {
    const { mod, supabase } = await loadModule()
    const accountWithoutIg = { ...account, instagram_business_account_id: null }

    const result = await mod.generateSinglePostForAccount({ supabase, apiKey: 'k', config, unit, account: accountWithoutIg, recentPosts: [] })

    expect(result.ok).toBe(false)
    expect(generatePostContentMock).not.toHaveBeenCalled()
  })

  it('falha na geração devolve ok:false com a mensagem de erro', async () => {
    const { mod, supabase } = await loadModule()
    generatePostContentMock.mockRejectedValueOnce(new Error('OpenAI indisponível'))

    const result = await mod.generateSinglePostForAccount({ supabase, apiKey: 'k', config, unit, account, recentPosts: [] })

    expect(result).toEqual({ ok: false, error: 'OpenAI indisponível' })
  })

  it('falha ao publicar (conta autônoma) devolve ok:true com published:false e publishError', async () => {
    const { mod, supabase } = await loadModule()
    publishContentPostMock.mockResolvedValueOnce({ ok: false, error: 'Meta API falhou' })
    const autonomousAccount = { ...account, publishing_mode: 'autonomous' as const }

    const result = await mod.generateSinglePostForAccount({ supabase, apiKey: 'k', config, unit, account: autonomousAccount, recentPosts: [] })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.published).toBe(false)
      expect(result.publishError).toBe('Meta API falhou')
    }
  })
})
