import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialAccount } from '../types'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const unit = { id: 'unit-1', org_id: 'org-1', name: 'Mawi' } as Unit
const config = { id: 'c', unit_id: 'unit-1', persona_name: 'Bia', business_profile: { pilares_conteudo: ['dicas'], plataformas: ['instagram'] } } as unknown as AgentConfig
const account = { id: 'acc-1', org_id: 'org-1', unit_id: 'unit-1', page_name: 'Mawi', instagram_business_account_id: 'ig', publishing_mode: 'suggestion' } as SocialAccount
const instruction = (formats: string[]) => ({
  id: 'ins-1', unit_id: 'unit-1', org_id: 'org-1', original_text: 'campanha', objective: 'Captar clientes comerciais', priority: 'normal',
  interpretation: { objective: 'Captar clientes comerciais', formats, avoid_formats: [], audience: null, cta: null, restrictions: [], summary: '' },
  starts_on: '2026-11-01', ends_on: '2026-11-30', paused: false, superseded_by: null, created_at: '2026-10-27T00:00:00Z',
})

async function run(formats: string[] | null, dates: Date[]) {
  const { supabase, db } = createFakeSupabase({ content_posts: [], content_instructions: formats ? [instruction(formats)] : [] })
  const generatePostContent = vi.fn(async () => ({ caption: 'img', imagePrompt: 'cena', reasoning: 'r' }))
  const generatePostImage = vi.fn(async () => ({ base64Image: 'aW1n' }))
  const createCarouselPostDraft = vi.fn(async () => ({
    caption: 'legenda do carrossel',
    reasoning: 'porque sim',
    imageUrl: 'https://cdn/cover.png',
    fields: { format: 'carousel', carousel: { slide_urls: ['https://cdn/cover.png', 'https://cdn/2.png'] } },
  }))
  vi.doMock('../generator', () => ({ generatePostContent, generatePostImage, uploadGeneratedImage: vi.fn(async () => 'https://cdn/img.png') }))
  vi.doMock('../carousel-post', () => ({ createCarouselPostDraft }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile: async () => null }))
  const mod = await import('../weekly-planner')
  await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })
  return { posts: db.content_posts as Record<string, unknown>[], generatePostImage, createCarouselPostDraft, generatePostContent }
}

describe('planejamento semanal com carrossel', () => {
  beforeEach(() => vi.resetModules())

  it('instrução pedindo só carrossel: gera carrossel, não chama o gerador de imagem e grava formato e slides', async () => {
    const { posts, generatePostImage, createCarouselPostDraft } = await run(['carrossel'], [utc(2026, 11, 3), utc(2026, 11, 4)])
    expect(createCarouselPostDraft).toHaveBeenCalledTimes(2)
    expect(generatePostImage).not.toHaveBeenCalled()
    expect(posts).toHaveLength(2)
    expect(posts[0]).toMatchObject({ format: 'carousel', status: 'pending_approval', image_url: 'https://cdn/cover.png', image_prompt: null, instruction_id: 'ins-1' })
    expect((posts[0]!.carousel as { slide_urls: string[] }).slide_urls).toHaveLength(2)
  })

  it('carrossel + imagem: alterna dentro do lote', async () => {
    const { posts } = await run(['carrossel', 'imagem única'], [utc(2026, 11, 3), utc(2026, 11, 4), utc(2026, 11, 5)])
    expect(posts.map((p) => p.format ?? 'image')).toEqual(['carousel', 'image', 'carousel'])
  })

  it('sem instrução ou sem carrossel: tudo como antes (imagem única, sem coluna format)', async () => {
    for (const formats of [null, ['stories', 'enquete']]) {
      vi.resetModules()
      const { posts, createCarouselPostDraft } = await run(formats, [utc(2026, 11, 3)])
      expect(createCarouselPostDraft).not.toHaveBeenCalled()
      expect(posts[0]).not.toHaveProperty('format')
      expect(posts[0]!.image_url).toBe('https://cdn/img.png')
    }
  })
})
