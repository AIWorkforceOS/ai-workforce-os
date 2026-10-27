import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import type { AgentConfig, Unit } from '@/lib/types'
import type { SocialAccount } from '../types'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const unit = { id: 'unit-1', org_id: 'org-1', name: 'Mawi', timezone: 'America/Phoenix' } as Unit
const config = { id: 'c', unit_id: 'unit-1', persona_name: 'Bia', business_profile: { pilares_conteudo: ['dicas'], plataformas: ['instagram'] } } as unknown as AgentConfig
const account = { id: 'acc-1', org_id: 'org-1', unit_id: 'unit-1', page_name: 'Mawi', instagram_business_account_id: 'ig', publishing_mode: 'suggestion' } as SocialAccount

const instruction = (over: Record<string, unknown> = {}) => ({
  id: 'ins-1',
  unit_id: 'unit-1',
  org_id: 'org-1',
  original_text: 'captar clientes comerciais',
  interpretation: { objective: 'Captar clientes comerciais', formats: [], avoid_formats: [], audience: null, cta: null, restrictions: [], summary: '' },
  objective: 'Captar clientes comerciais',
  priority: 'normal',
  starts_on: '2026-11-02',
  ends_on: '2026-11-04',
  paused: false,
  superseded_by: null,
  created_at: '2026-10-27T00:00:00Z',
  ...over,
})

async function run(seed: Record<string, Record<string, unknown>[]>, dates: Date[]) {
  const { supabase, db } = createFakeSupabase({ content_posts: [], ...seed })
  const generate = vi.fn(async () => ({ caption: 'legenda', imagePrompt: 'cena', reasoning: 'ok', instructionFormatReason: 'carrossel mostra o serviço', instructionCta: 'Peça proposta' }))
  vi.doMock('../generator', () => ({
    generatePostContent: generate,
    generatePostImage: vi.fn(async () => ({ base64Image: 'aW1n' })),
    uploadGeneratedImage: vi.fn(async () => 'https://cdn/img.png'),
  }))
  vi.doMock('@/lib/organizations', () => ({ fetchOrganizationBusinessProfile: async () => null }))
  const mod = await import('../weekly-planner')
  const result = await mod.generateWeekPostsForAccount({ supabase, apiKey: 'k', config, unit, account, dates })
  return { result, generate, posts: db.content_posts as Record<string, unknown>[] }
}

describe('planejamento semanal com instruções', () => {
  beforeEach(() => vi.resetModules())

  it('aplica a instrução só nos dias dentro do período e grava a prova no post', async () => {
    const { generate, posts } = await run({ content_instructions: [instruction()] }, [utc(2026, 11, 1), utc(2026, 11, 3), utc(2026, 11, 6)])
    const calls = generate.mock.calls as unknown as [{ instruction: { id: string } | null }][]
    expect(calls.map((c) => c[0].instruction?.id ?? null)).toEqual([null, 'ins-1', null])
    const applied = posts.filter((p) => p.instruction_id)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ instruction_objective: 'Captar clientes comerciais', instruction_format_reason: 'carrossel mostra o serviço', instruction_cta: 'Peça proposta' })
  })

  it('sem nenhuma instrução: gera como antes, sem campos extras', async () => {
    const { generate, posts, result } = await run({ content_instructions: [] }, [utc(2026, 11, 3)])
    expect(result.created).toBe(1)
    expect((generate.mock.calls[0] as unknown as [{ instruction: unknown }])[0].instruction).toBeNull()
    expect(posts[0]).not.toHaveProperty('instruction_id')
  })

  it('instrução expirada, pausada ou substituída não é aplicada', async () => {
    const { generate } = await run(
      { content_instructions: [instruction({ id: 'e', ends_on: '2026-11-02' }), instruction({ id: 'p', paused: true }), instruction({ id: 's', superseded_by: 'x' })] },
      [utc(2026, 11, 3)],
    )
    expect((generate.mock.calls[0] as unknown as [{ instruction: unknown }])[0].instruction).toBeNull()
  })

  it('post já agendado no dia continua intocado: não duplica nem reescreve', async () => {
    const existing = { id: 'old', social_account_id: 'acc-1', platform: 'instagram', status: 'pending_approval', scheduled_for: utc(2026, 11, 3).toISOString(), created_at: utc(2026, 10, 30).toISOString(), caption: 'antigo' }
    const { result, posts, generate } = await run({ content_instructions: [instruction()], content_posts: [existing] }, [utc(2026, 11, 3)])
    expect(result).toMatchObject({ created: 0, skipped: 1 })
    expect(generate).not.toHaveBeenCalled()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ id: 'old', caption: 'antigo' })
  })
})
