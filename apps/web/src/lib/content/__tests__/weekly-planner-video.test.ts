import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialAccount } from '../types'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const unit = { id: 'unit-1', org_id: 'org-1', name: 'Mawi' } as Unit
const config = { id: 'c', unit_id: 'unit-1', persona_name: 'Bia', business_profile: { pilares_conteudo: ['dicas'], plataformas: ['instagram'] } } as unknown as AgentConfig
const account = { id: 'acc-1', org_id: 'org-1', unit_id: 'unit-1', page_name: 'Mawi', instagram_business_account_id: 'ig', publishing_mode: 'suggestion' } as SocialAccount
const instruction = (formats: string[]) => ({
  id: 'ins-1', unit_id: 'unit-1', org_id: 'org-1', original_text: 'campanha', objective: 'Captar clientes', priority: 'normal',
  interpretation: { objective: 'Captar clientes', formats, avoid_formats: [], audience: null, cta: null, restrictions: [], summary: '' },
  starts_on: '2026-11-01', ends_on: '2026-11-30', paused: false, superseded_by: null, created_at: '2026-10-27T00:00:00Z',
})

async function run(formats: string[], dates: Date[], videoFails = false) {
  const { supabase, db } = createFakeSupabase({ content_posts: [], content_instructions: [instruction(formats)] })
  const generatePostImage = vi.fn(async () => ({ base64Image: 'aW1n' }))
  const createVideoPostDraft = vi.fn(async () => {
    if (videoFails) throw new Error('ffmpeg falhou: teste')
    return { caption: 'legenda do vídeo', reasoning: 'r', imageUrl: 'https://cdn/poster.png', fields: { format: 'video', video: { mp4_url: 'https://cdn/v.mp4', duration: 23 } } }
  })
  vi.doMock('../generator', () => ({ generatePostContent: vi.fn(async () => ({ caption: 'img', imagePrompt: 'cena', reasoning: 'r' })), generatePostImage, uploadGeneratedImage: vi.fn(async () => 'https://cdn/img.png') }))
  vi.doMock('../video-post', () => ({ createVideoPostDraft }))
  vi.doMock('../carousel-post', () => ({ createCarouselPostDraft: vi.fn() }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile: async () => null }))
  const mod = await import('../weekly-planner')
  const result = await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })
  return { result, posts: db.content_posts as Record<string, unknown>[], createVideoPostDraft, generatePostImage }
}

describe('planejamento semanal com vídeo', () => {
  beforeEach(() => vi.resetModules())

  it('instrução pedindo vídeo: grava format video, capa em image_url e o MP4; não usa o gerador de imagem', async () => {
    const { posts, generatePostImage } = await run(['vídeo curto'], [utc(2026, 11, 3)])
    expect(generatePostImage).not.toHaveBeenCalled()
    expect(posts[0]).toMatchObject({ format: 'video', status: 'pending_approval', image_url: 'https://cdn/poster.png', image_prompt: null, instruction_id: 'ins-1' })
    expect((posts[0]!.video as { mp4_url: string }).mp4_url).toBe('https://cdn/v.mp4')
  })

  it('no máximo 1 vídeo por rodada (1 por semana); os demais dias seguem o que sobrar (imagem)', async () => {
    const { posts, createVideoPostDraft } = await run(['vídeo curto'], [utc(2026, 11, 3), utc(2026, 11, 4), utc(2026, 11, 5), utc(2026, 11, 6)])
    expect(createVideoPostDraft).toHaveBeenCalledTimes(1)
    expect(posts.map((p) => p.format ?? 'image')).toEqual(['video', 'image', 'image', 'image'])
  })

  it('erro de renderização aparece no resultado e NENHUM post quebrado é criado', async () => {
    const { result, posts } = await run(['vídeo curto'], [utc(2026, 11, 3)], true)
    expect(posts).toHaveLength(0)
    expect(result.errors).toEqual([{ date: '2026-11-03', error: 'ffmpeg falhou: teste' }])
  })
})
