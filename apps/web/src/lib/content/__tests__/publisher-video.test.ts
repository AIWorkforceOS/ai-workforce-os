import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

const resolveSocialConfig = vi.fn(async () => ({ pageId: 'page-1', pageAccessToken: 'tok' }))
const publishInstagramReel = vi.fn(async () => ({ externalPostId: 'ig-reel' }))
const publishFacebookVideo = vi.fn(async () => ({ externalPostId: 'fb-video' }))
const noop = vi.fn(async () => ({ externalPostId: 'x' }))

async function load() {
  vi.doMock('../meta-content', () => ({
    resolveSocialConfig, publishInstagramReel, publishFacebookVideo,
    publishFacebookPhoto: noop, publishInstagramPost: noop, publishInstagramCarousel: noop, publishFacebookCarousel: noop,
  }))
  return import('../publisher')
}

const account = { id: 'acc', page_id: 'page-1', instagram_business_account_id: 'ig-1', platform: 'meta' }
const videoPost = (over: Record<string, unknown> = {}) => ({
  id: 'v1', social_account_id: 'acc', platform: 'instagram', status: 'approved', caption: 'legenda',
  image_url: 'https://cdn/poster.png', scheduled_for: '2026-11-03T12:00:00.000Z', format: 'video',
  video: { mp4_url: 'https://cdn/v.mp4' }, ...over,
})

describe('publicação de vídeo', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.CONTENT_VIDEO_PUBLISH
  })

  it('trava desligada (padrão): não chama a Meta e NÃO marca como falho', async () => {
    const { supabase, db } = createFakeSupabase({ content_posts: [videoPost()], social_accounts: [account] })
    const { publishContentPost } = await load()
    const out = await publishContentPost(supabase, { post: videoPost() as never, account: account as never })
    expect(out.ok).toBe(false)
    expect(publishInstagramReel).not.toHaveBeenCalled()
    expect((db.content_posts as { status: string }[])[0]!.status).toBe('approved')
  })

  it('trava ligada: Instagram vira Reel e Facebook vira vídeo da Página, com o MP4 renderizado', async () => {
    process.env.CONTENT_VIDEO_PUBLISH = 'on'
    const { supabase, db } = createFakeSupabase({ content_posts: [videoPost()], social_accounts: [account] })
    const { publishContentPost } = await load()
    expect(await publishContentPost(supabase, { post: videoPost() as never, account: account as never })).toEqual({ ok: true, externalPostId: 'ig-reel' })
    expect(publishInstagramReel).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ videoUrl: 'https://cdn/v.mp4', caption: 'legenda' }))
    expect((db.content_posts as { status: string }[])[0]!.status).toBe('published')
    await publishContentPost(supabase, { post: videoPost({ platform: 'facebook' }) as never, account: account as never })
    expect(publishFacebookVideo).toHaveBeenCalledTimes(1)
  })

  it('vídeo sem arquivo renderizado falha com mensagem clara', async () => {
    process.env.CONTENT_VIDEO_PUBLISH = 'on'
    const { supabase } = createFakeSupabase({ content_posts: [videoPost({ video: null })], social_accounts: [account] })
    const { publishContentPost } = await load()
    const out = await publishContentPost(supabase, { post: videoPost({ video: null }) as never, account: account as never })
    expect(out).toEqual({ ok: false, error: 'Vídeo sem arquivo renderizado.' })
  })

  it('o cron pula vídeo com a trava desligada e publica o resto', async () => {
    const image = { ...videoPost({ id: 'p2' }), format: 'image', video: null }
    const { supabase, db } = createFakeSupabase({ content_posts: [videoPost(), image], social_accounts: [account] })
    const { publishDueScheduledPosts } = await load()
    const out = await publishDueScheduledPosts(supabase, { today: new Date('2026-11-03T15:00:00Z') })
    expect(out.errors).toBe(0)
    const byId = Object.fromEntries((db.content_posts as { id: string; status: string }[]).map((p) => [p.id, p.status]))
    expect(byId.v1).toBe('approved')
  })
})
