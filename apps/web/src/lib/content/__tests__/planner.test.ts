import { describe, expect, it } from 'vitest'
import {
  contentPillarsFrom,
  contentPlatformsFrom,
  decidePublishAction,
  pickNextPillar,
  pickNextPlatform,
  shouldGenerateToday,
  weeklyFrequencyFrom,
} from '../planner'
import type { ContentPost } from '../types'

function post(overrides: Partial<ContentPost>): Pick<ContentPost, 'created_at' | 'status' | 'platform' | 'content_pillar'> {
  return {
    created_at: new Date().toISOString(),
    status: 'published',
    platform: 'instagram',
    content_pillar: null,
    ...overrides,
  }
}

describe('decidePublishAction', () => {
  it('modo autônomo publica direto', () => {
    expect(decidePublishAction('autonomous')).toBe('publish')
  })
  it('modo sugestão enfileira para aprovação', () => {
    expect(decidePublishAction('suggestion')).toBe('queue')
  })
})

describe('extratores de business_profile', () => {
  it('lê pilares, plataformas e frequência quando presentes', () => {
    const profile = { pilares_conteudo: ['bastidores', 'dicas'], plataformas: ['instagram'], frequencia_semanal: 5 }
    expect(contentPillarsFrom(profile)).toEqual(['bastidores', 'dicas'])
    expect(contentPlatformsFrom(profile)).toEqual(['instagram'])
    expect(weeklyFrequencyFrom(profile)).toBe(5)
  })

  it('usa defaults seguros quando o perfil está vazio ou ainda não foi entrevistado', () => {
    expect(contentPillarsFrom(null)).toEqual([])
    expect(contentPlatformsFrom(undefined)).toEqual(['instagram', 'facebook'])
    expect(weeklyFrequencyFrom({})).toBe(3)
    expect(weeklyFrequencyFrom({ frequencia_semanal: -2 })).toBe(3)
  })

  it('ignora valores de plataforma inválidos vindos do perfil', () => {
    expect(contentPlatformsFrom({ plataformas: ['instagram', 'tiktok', 123] })).toEqual(['instagram'])
  })
})

describe('shouldGenerateToday', () => {
  const now = new Date('2026-07-24T12:00:00Z')

  it('gera quando ainda não bateu a frequência semanal', () => {
    const recentPosts = [post({ created_at: '2026-07-22T12:00:00Z', status: 'published' })]
    expect(shouldGenerateToday({ weeklyFrequency: 3, recentPosts, now })).toBe(true)
  })

  it('não gera quando a cota da semana já foi preenchida', () => {
    const recentPosts = [
      post({ created_at: '2026-07-20T12:00:00Z', status: 'published' }),
      post({ created_at: '2026-07-22T12:00:00Z', status: 'pending_approval' }),
      post({ created_at: '2026-07-23T12:00:00Z', status: 'approved' }),
    ]
    expect(shouldGenerateToday({ weeklyFrequency: 3, recentPosts, now })).toBe(false)
  })

  it('posts rejeitados ou com falha não ocupam a cota', () => {
    const recentPosts = [
      post({ created_at: '2026-07-23T12:00:00Z', status: 'rejected' }),
      post({ created_at: '2026-07-23T13:00:00Z', status: 'failed' }),
    ]
    expect(shouldGenerateToday({ weeklyFrequency: 1, recentPosts, now })).toBe(true)
  })

  it('ignora posts fora da janela de 7 dias', () => {
    const recentPosts = [post({ created_at: '2026-07-01T12:00:00Z', status: 'published' })]
    expect(shouldGenerateToday({ weeklyFrequency: 1, recentPosts, now })).toBe(true)
  })
})

describe('pickNextPlatform', () => {
  it('devolve a única plataforma quando só há uma disponível', () => {
    expect(pickNextPlatform(['facebook'], [])).toBe('facebook')
  })

  it('escolhe a plataforma sem nenhum post ainda', () => {
    const recentPosts = [post({ platform: 'instagram', created_at: '2026-07-23T12:00:00Z' })]
    expect(pickNextPlatform(['instagram', 'facebook'], recentPosts)).toBe('facebook')
  })

  it('alterna para a plataforma há mais tempo sem post (round robin por recência)', () => {
    const recentPosts = [
      post({ platform: 'instagram', created_at: '2026-07-23T12:00:00Z' }),
      post({ platform: 'facebook', created_at: '2026-07-20T12:00:00Z' }),
    ]
    expect(pickNextPlatform(['instagram', 'facebook'], recentPosts)).toBe('facebook')
  })

  it('lança erro se nenhuma plataforma estiver disponível', () => {
    expect(() => pickNextPlatform([], [])).toThrow()
  })
})

describe('pickNextPillar', () => {
  it('devolve null quando não há pilares configurados', () => {
    expect(pickNextPillar([], [])).toBeNull()
  })

  it('devolve o único pilar quando só há um', () => {
    expect(pickNextPillar(['dicas'], [])).toBe('dicas')
  })

  it('evita repetir o pilar do post mais recente quando há alternativa', () => {
    const recentPosts = [post({ content_pillar: 'bastidores', created_at: '2026-07-23T12:00:00Z' })]
    const next = pickNextPillar(['bastidores', 'dicas', 'depoimentos'], recentPosts)
    expect(next).not.toBe('bastidores')
  })
})
