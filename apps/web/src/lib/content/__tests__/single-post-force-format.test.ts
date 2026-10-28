import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialAccount } from '../types'

const unit = { id: 'unit-1', org_id: 'org-1', name: 'Mawi' } as Unit
const config = { id: 'c', unit_id: 'unit-1', persona_name: 'Bia', business_profile: { pilares_conteudo: ['dicas'], plataformas: ['instagram'] } } as unknown as AgentConfig
const account = (mode: string) => ({ id: 'acc-1', org_id: 'org-1', unit_id: 'unit-1', page_name: 'Mawi', instagram_business_account_id: 'ig', publishing_mode: mode }) as SocialAccount

async function run(forceFormat: 'image' | 'carousel' | 'video' | undefined, mode = 'suggestion') {
  const { supabase, db } = createFakeSupabase({ content_posts: [], content_instructions: [] })
  const publish = vi.fn(async () => ({ ok: true as const, externalPostId: 'x' }))
  const video = vi.fn(async () => ({ caption: 'v', reasoning: 'r', imageUrl: 'https://cdn/p.png', fields: { format: 'video', video: { mp4_url: 'https://cdn/v.mp4' } } }))
  const carousel = vi.fn(async () => ({ caption: 'c', reasoning: 'r', imageUrl: 'https://cdn/c.png', fields: { format: 'carousel', carousel: { slide_urls: ['https://cdn/c.png'] } } }))
  vi.doMock('../generator', () => ({ generatePostContent: vi.fn(async () => ({ caption: 'img', imagePrompt: 'cena', reasoning: 'r' })), generatePostImage: vi.fn(async () => ({ base64Image: 'aQ==' })), uploadGeneratedImage: vi.fn(async () => 'https://cdn/i.png') }))
  vi.doMock('../video-post', () => ({ createVideoPostDraft: video }))
  vi.doMock('../carousel-post', () => ({ createCarouselPostDraft: carousel }))
  vi.doMock('../publisher', () => ({ publishContentPost: publish }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile: async () => null }))
  const mod = await import('../single-post')
  const out = await mod.generateSinglePostForAccount({ supabase, apiKey: 'k', config, unit, account: account(mode), recentPosts: [], forceFormat })
  return { out, posts: db.content_posts as Record<string, unknown>[], publish, video, carousel }
}

describe('post avulso com formato forçado (botões "Criar vídeo/carrossel agora")', () => {
  beforeEach(() => vi.resetModules())

  it('vídeo forçado: cria o vídeo, status pending_approval, sem publicar', async () => {
    const { out, posts, video, publish } = await run('video')
    expect(out.ok).toBe(true)
    expect(video).toHaveBeenCalledTimes(1)
    expect(posts[0]).toMatchObject({ format: 'video', status: 'pending_approval', image_url: 'https://cdn/p.png' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('mesmo em conta AUTÔNOMA, conteúdo forçado vai para a aprovação e não publica na hora', async () => {
    const { posts, publish } = await run('carousel', 'autonomous')
    expect(posts[0]).toMatchObject({ format: 'carousel', status: 'pending_approval' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('sem formato forçado: conta autônoma continua publicando como antes', async () => {
    const { posts, publish } = await run(undefined, 'autonomous')
    expect(posts[0]).toMatchObject({ status: 'approved' })
    expect(publish).toHaveBeenCalledTimes(1)
  })
})
