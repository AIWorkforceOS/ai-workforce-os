import { describe, expect, it } from 'vitest'
import {
  VISUAL_ANGLES,
  contentPillarsFrom,
  contentPlatformsFrom,
  currentWeekDates,
  decidePublishAction,
  fullWeekDates,
  nextWeekDates,
  pickNextPillar,
  pickNextPlatform,
  pickNextVisualAngle,
  postingDaysFrom,
  resolveWeekPlanDates,
  shouldGenerateToday,
  weeklyFrequencyFrom,
} from '../planner'
import type { ContentPost } from '../types'

// 1º de janeiro de 2024 é uma segunda-feira (fato verificável, ISO 8601) —
// usado como âncora nos testes de planejamento semanal pra não depender de
// nenhuma suposição sobre o dia da semana de uma data arbitrária.
function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

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

  it('regressão (2026-08-28, conta AlizoAi): com 3+ pilares, roda de verdade em vez de ficar num ping-pong eterno entre só os 2 primeiros', () => {
    const pillars = ['dor', 'solucao', 'custo']
    let recentPosts: { content_pillar: string | null; created_at: string }[] = []
    const picks: string[] = []
    for (let i = 0; i < 6; i++) {
      const next = pickNextPillar(pillars, recentPosts)!
      picks.push(next)
      recentPosts = [{ content_pillar: next, created_at: new Date(2026, 7, 28 + i).toISOString() }, ...recentPosts]
    }
    // acha o "custo" (3º pilar) pelo menos uma vez logo nas primeiras rodadas — a versão antiga NUNCA o alcançava
    expect(picks.slice(0, 3)).toContain('custo')
    // nunca repete o pilar imediatamente anterior
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
  })
})

describe('pickNextVisualAngle', () => {
  it('sem histórico, devolve um dos ângulos válidos', () => {
    const angle = pickNextVisualAngle([])
    expect(VISUAL_ANGLES).toContain(angle)
  })

  it('regressão (2026-08-28, conta AlizoAi): rotaciona de verdade por todos os ângulos, nunca repete o imediatamente anterior — achado real: instrução em texto livre não impediu o modelo de repetir sempre o mesmo clichê visual', () => {
    let recentPosts: { visual_angle: string | null; created_at: string }[] = []
    const picks: string[] = []
    for (let i = 0; i < VISUAL_ANGLES.length * 2; i++) {
      const next = pickNextVisualAngle(recentPosts)
      picks.push(next)
      recentPosts = [{ visual_angle: next, created_at: new Date(2026, 7, 28 + i).toISOString() }, ...recentPosts]
    }
    // percorre todos os ângulos disponíveis dentro da primeira volta completa
    expect(new Set(picks.slice(0, VISUAL_ANGLES.length))).toEqual(new Set(VISUAL_ANGLES))
    // nunca repete o ângulo imediatamente anterior
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1])
  })
})

describe('postingDaysFrom', () => {
  it('usa os dias escolhidos explicitamente, ordenados e sem duplicata', () => {
    expect(postingDaysFrom({ dias_publicacao: [5, 1, 3, 1] })).toEqual([1, 3, 5])
  })

  it('ignora valores fora do intervalo 1-7', () => {
    expect(postingDaysFrom({ dias_publicacao: [0, 8, 2] })).toEqual([2])
  })

  it('sem escolha explícita, espalha a partir da frequência semanal (4x/semana → seg/ter/qui/sex)', () => {
    expect(postingDaysFrom({ frequencia_semanal: 4 })).toEqual([1, 2, 4, 5])
  })

  it('perfil vazio cai no padrão de 3x/semana (seg/qua/sex)', () => {
    expect(postingDaysFrom(null)).toEqual([1, 3, 5])
  })
})

describe('currentWeekDates', () => {
  it('devolve só os dias que ainda não passaram na semana atual (quarta-feira, pedindo seg/qua/sex)', () => {
    const wednesday = utc(2024, 1, 3) // semana de 1-7 jan/2024 (segunda a domingo)
    const dates = currentWeekDates([1, 3, 5], wednesday)
    expect(dates).toEqual([utc(2024, 1, 3), utc(2024, 1, 5)]) // segunda (dia 1) já passou
  })

  it('pedida numa segunda-feira, devolve a semana inteira', () => {
    const monday = utc(2024, 1, 1)
    const dates = currentWeekDates([1, 3, 5], monday)
    expect(dates).toEqual([utc(2024, 1, 1), utc(2024, 1, 3), utc(2024, 1, 5)])
  })
})

describe('nextWeekDates', () => {
  it('devolve as datas da semana seguinte, mesmo pedido no meio da semana atual', () => {
    const wednesday = utc(2024, 1, 3)
    const dates = nextWeekDates([1, 3, 5], wednesday)
    expect(dates).toEqual([utc(2024, 1, 8), utc(2024, 1, 10), utc(2024, 1, 12)])
  })

  it('gatilho de sexta-feira: pedido numa sexta, devolve a semana seguinte completa', () => {
    const friday = utc(2024, 1, 5)
    const dates = nextWeekDates([1, 3, 5], friday)
    expect(dates).toEqual([utc(2024, 1, 8), utc(2024, 1, 10), utc(2024, 1, 12)])
  })
})

describe('fullWeekDates', () => {
  it('devolve as 7 datas da semana (segunda a domingo), mesmo pedida no meio da semana', () => {
    const wednesday = utc(2024, 1, 3)
    expect(fullWeekDates(wednesday)).toEqual([
      utc(2024, 1, 1),
      utc(2024, 1, 2),
      utc(2024, 1, 3),
      utc(2024, 1, 4),
      utc(2024, 1, 5),
      utc(2024, 1, 6),
      utc(2024, 1, 7),
    ])
  })
})

describe('resolveWeekPlanDates (botão manual "gerar planejamento semanal")', () => {
  it('no meio da semana, completa o que resta da semana atual', () => {
    const wednesday = utc(2024, 1, 3)
    expect(resolveWeekPlanDates([1, 3, 5], wednesday)).toEqual([utc(2024, 1, 3), utc(2024, 1, 5)])
  })

  it('sem nenhum dia restante na semana atual (clicado sábado), cai pra semana seguinte', () => {
    const saturday = utc(2024, 1, 6) // seg/qua/sex já passaram
    expect(resolveWeekPlanDates([1, 3, 5], saturday)).toEqual([utc(2024, 1, 8), utc(2024, 1, 10), utc(2024, 1, 12)])
  })
})
