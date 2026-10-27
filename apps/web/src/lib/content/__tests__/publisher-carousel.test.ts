import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const resolveSocialConfig = vi.fn(async () => ({ pageId: 'page-1', pageAccessToken: 'tok' }))
const publishFacebookPhoto = vi.fn(async () => ({ externalPostId: 'fb-photo' }))
const publishInstagramPost = vi.fn(async () => ({ externalPostId: 'ig-photo' }))
const publishInstagramCarousel = vi.fn(async () => ({ externalPostId: 'ig-carousel' }))
const publishFacebookCarousel = vi.fn(async () => ({ externalPostId: 'fb-carousel' }))

async function load() {
  vi.doMock('../meta-content', () => ({ resolveSocialConfig, publishFacebookPhoto, publishInstagramPost, publishInstagramCarousel, publishFacebookCarousel }))
  return import('../publisher')
}

const account = { id: 'acc', page_id: 'page-1', instagram_business_account_id: 'ig-1', platform: 'meta' }
const carouselPost = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  social_account_id: 'acc',
  platform: 'instagram',
  status: 'approved',
  caption: 'legenda',
  image_url: 'https://cdn/1.png',
  scheduled_for: '2026-11-03T12:00:00.000Z',
  format: 'carousel',
  carousel: { slide_urls: ['https://cdn/1.png', 'https://cdn/2.png', 'https://cdn/3.png'] },
  ...over,
})

describe('publicação de carrossel', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.CONTENT_CAROUSEL_PUBLISH
  })

  it('com a trava desligada (padrão): não chama a Meta e NÃO marca o post como falho', async () => {
    const { supabase, db } = createFakeSupabase({ content_posts: [carouselPost()], social_accounts: [account] })
    const { publishContentPost } = await load()
    const out = await publishContentPost(supabase, { post: carouselPost() as never, account: account as never })
    expect(out.ok).toBe(false)
    expect(publishInstagramCarousel).not.toHaveBeenCalled()
    expect((db.content_posts as { status: string }[])[0]!.status).toBe('approved')
  })

  it('com a trava ligada: publica o carrossel no Instagram com todos os slides', async () => {
    process.env.CONTENT_CAROUSEL_PUBLISH = 'on'
    const { supabase, db } = createFakeSupabase({ content_posts: [carouselPost()], social_accounts: [account] })
    const { publishContentPost } = await load()
    const out = await publishContentPost(supabase, { post: carouselPost() as never, account: account as never })
    expect(out).toEqual({ ok: true, externalPostId: 'ig-carousel' })
    expect(publishInstagramCarousel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ imageUrls: expect.arrayContaining(['https://cdn/2.png']), caption: 'legenda' }))
    expect((db.content_posts as { status: string }[])[0]!.status).toBe('published')
  })

  it('no Facebook usa o post com várias fotos; imagem única continua igual', async () => {
    process.env.CONTENT_CAROUSEL_PUBLISH = 'on'
    const { supabase } = createFakeSupabase({ content_posts: [], social_accounts: [account] })
    const { publishContentPost } = await load()
    await publishContentPost(supabase, { post: carouselPost({ platform: 'facebook' }) as never, account: account as never })
    expect(publishFacebookCarousel).toHaveBeenCalledTimes(1)
    await publishContentPost(supabase, { post: { ...carouselPost({ platform: 'facebook' }), format: 'image', carousel: null } as never, account: account as never })
    expect(publishFacebookPhoto).toHaveBeenCalledTimes(1)
  })

  it('o cron (publishDueScheduledPosts) pula carrossel com a trava desligada e publica o resto', async () => {
    const image = { ...carouselPost({ id: 'p2' }), format: 'image', carousel: null }
    const { supabase, db } = createFakeSupabase({ content_posts: [carouselPost(), image], social_accounts: [account] })
    const { publishDueScheduledPosts } = await load()
    const out = await publishDueScheduledPosts(supabase, { today: new Date('2026-11-03T15:00:00Z') })
    expect(out).toEqual({ published: 1, errors: 0 })
    const byId = Object.fromEntries((db.content_posts as { id: string; status: string }[]).map((p) => [p.id, p.status]))
    expect(byId).toEqual({ p1: 'approved', p2: 'published' })
  })
})
