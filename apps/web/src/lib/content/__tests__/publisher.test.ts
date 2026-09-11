import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'

// publishDueScheduledPosts — regressão real (2026-09-08, conta AlizoAi):
// o Vinicius aprovou posts do Instagram esperando que "uma vez aprovado,
// o funcionário posta sozinho, sem ação humana nenhuma" — mas a versão
// antiga só pegava post agendado EXATAMENTE pra hoje, então um post
// aprovado depois da data agendada (ou num dia em que o cron não rodou)
// ficava 'approved' preso pra sempre, nunca mais era publicado.

const resolveSocialConfig = vi.fn(async (): Promise<{ pageId: string; pageAccessToken: string } | null> => ({
  pageId: 'page-1',
  pageAccessToken: 'tok',
}))
const publishFacebookPhoto = vi.fn(async () => ({ externalPostId: 'fb-post-1' }))
const publishInstagramPost = vi.fn(async () => ({ externalPostId: 'ig-post-1' }))

async function loadModule() {
  vi.doMock('../meta-content', () => ({ resolveSocialConfig, publishFacebookPhoto, publishInstagramPost }))
  return import('../publisher')
}

function makeAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-1',
    unit_id: 'unit-1',
    org_id: 'org-1',
    platform: 'meta',
    page_id: 'page-1',
    page_name: 'Mawi Cleaning',
    page_access_token: 'tok',
    instagram_business_account_id: 'ig-1',
    instagram_username: 'mawicleaning',
    connection_status: 'connected',
    publishing_mode: 'suggestion',
    is_active: true,
    ...overrides,
  }
}

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 'post-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    social_account_id: 'account-1',
    platform: 'facebook',
    status: 'approved',
    content_pillar: null,
    caption: 'legenda',
    image_prompt: 'a scene',
    image_url: 'https://cdn.example.com/img.png',
    reasoning: '',
    mode: 'suggestion',
    scheduled_for: null,
    published_at: null,
    external_post_id: null,
    error_message: null,
    decided_by: null,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

const TODAY = new Date('2026-09-08T12:00:00Z')

describe('publishDueScheduledPosts', () => {
  beforeEach(() => {
    vi.resetModules()
    resolveSocialConfig.mockClear()
    publishFacebookPhoto.mockClear()
    publishInstagramPost.mockClear()
  })

  it('publica um post agendado pra hoje', async () => {
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: '2026-09-08T12:00:00Z' })],
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 1, errors: 0 })
    expect(db.content_posts?.[0]).toMatchObject({ status: 'published', external_post_id: 'fb-post-1' })
  })

  it('regressão: publica um post "approved" cujo scheduled_for já passou (atrasado) — antes ficava preso pra sempre', async () => {
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: '2026-09-04T12:00:00Z' })], // 4 dias atrás
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 1, errors: 0 })
    expect(db.content_posts?.[0]?.status).toBe('published')
  })

  it('não publica post agendado pro futuro', async () => {
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: '2026-09-10T12:00:00Z' })],
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 0, errors: 0 })
    expect(db.content_posts?.[0]?.status).toBe('approved')
    expect(publishFacebookPhoto).not.toHaveBeenCalled()
  })

  it('não mexe em post sem scheduled_for (fluxo avulso — publica na hora da aprovação, não aqui)', async () => {
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: null })],
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 0, errors: 0 })
    expect(db.content_posts?.[0]?.status).toBe('approved')
  })

  it('não mexe em post que não está approved (pending_approval, published etc.)', async () => {
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ status: 'pending_approval', scheduled_for: '2026-09-04T12:00:00Z' })],
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 0, errors: 0 })
    expect(db.content_posts?.[0]?.status).toBe('pending_approval')
  })

  it('marca failed e conta como erro quando a publicação falha (nunca fica preso em approved)', async () => {
    resolveSocialConfig.mockResolvedValueOnce(null)
    const { supabase, db } = createFakeSupabase({
      content_posts: [makePost({ scheduled_for: '2026-09-04T12:00:00Z' })],
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 0, errors: 1 })
    expect(db.content_posts?.[0]).toMatchObject({ status: 'failed' })
  })

  it('publica vários posts atrasados de dias diferentes numa única execução', async () => {
    const { supabase, db } = createFakeSupabase({
      content_posts: [
        makePost({ id: 'post-1', scheduled_for: '2026-09-02T12:00:00Z' }),
        makePost({ id: 'post-2', scheduled_for: '2026-09-05T12:00:00Z' }),
        makePost({ id: 'post-3', scheduled_for: '2026-09-08T12:00:00Z' }),
      ],
      social_accounts: [makeAccount()],
    })
    const { publishDueScheduledPosts } = await loadModule()

    const result = await publishDueScheduledPosts(supabase, { today: TODAY })

    expect(result).toEqual({ published: 3, errors: 0 })
    expect(db.content_posts?.every((p) => p.status === 'published')).toBe(true)
  })
})
