import { describe, expect, it } from 'vitest'
import {
  pickNextContentType,
  pickNextKeyword,
  seoKeywordsFrom,
  shouldGenerateContentToday,
  shouldRunAuditToday,
  siteUrlFrom,
} from '../planner'

describe('shouldRunAuditToday', () => {
  it('roda quando nunca auditou antes', () => {
    expect(shouldRunAuditToday({ lastAuditAt: null })).toBe(true)
  })

  it('não roda de novo dentro de 7 dias', () => {
    const now = new Date('2026-07-24T12:00:00Z')
    const twoDaysAgo = new Date('2026-07-22T12:00:00Z').toISOString()
    expect(shouldRunAuditToday({ lastAuditAt: twoDaysAgo, now })).toBe(false)
  })

  it('roda de novo depois de 7 dias', () => {
    const now = new Date('2026-07-24T12:00:00Z')
    const eightDaysAgo = new Date('2026-07-16T12:00:00Z').toISOString()
    expect(shouldRunAuditToday({ lastAuditAt: eightDaysAgo, now })).toBe(true)
  })
})

describe('siteUrlFrom / seoKeywordsFrom', () => {
  it('extrai site_url quando presente', () => {
    expect(siteUrlFrom({ site_url: 'https://example.com' })).toBe('https://example.com')
  })

  it('devolve null quando ausente ou vazio', () => {
    expect(siteUrlFrom(null)).toBeNull()
    expect(siteUrlFrom({ site_url: '  ' })).toBeNull()
  })

  it('extrai palavras-chave alvo como array de strings', () => {
    expect(seoKeywordsFrom({ palavras_chave_alvo: ['limpeza residencial', 'faxina campinas'] })).toEqual(['limpeza residencial', 'faxina campinas'])
  })

  it('devolve array vazio quando ausente', () => {
    expect(seoKeywordsFrom(null)).toEqual([])
  })
})

describe('shouldGenerateContentToday', () => {
  it('gera quando não há itens recentes', () => {
    expect(shouldGenerateContentToday({ recentItems: [] })).toBe(true)
  })

  it('não gera quando a frequência semanal já foi atingida', () => {
    const recentItems = [{ created_at: new Date().toISOString() }, { created_at: new Date().toISOString() }]
    expect(shouldGenerateContentToday({ recentItems, weeklyFrequency: 2 })).toBe(false)
  })

  it('ignora itens fora da janela de 7 dias', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    expect(shouldGenerateContentToday({ recentItems: [{ created_at: tenDaysAgo }], weeklyFrequency: 1 })).toBe(true)
  })
})

describe('pickNextContentType', () => {
  it('escolhe blog quando nada foi gerado ainda', () => {
    expect(pickNextContentType([])).toBe('blog')
  })

  it('prioriza o tipo há mais tempo sem gerar', () => {
    const now = Date.now()
    const recentItems = [
      { content_type: 'blog' as const, created_at: new Date(now).toISOString() },
      { content_type: 'gbp_post' as const, created_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() },
    ]
    expect(pickNextContentType(recentItems)).toBe('landing_page')
  })
})

describe('pickNextKeyword', () => {
  it('devolve null para tipos de GBP (não usam palavra-chave)', () => {
    expect(pickNextKeyword({ contentType: 'gbp_post', keywords: ['x'], recentItems: [] })).toBeNull()
    expect(pickNextKeyword({ contentType: 'gbp_description', keywords: ['x'], recentItems: [] })).toBeNull()
  })

  it('devolve null quando não há palavras-chave cadastradas', () => {
    expect(pickNextKeyword({ contentType: 'blog', keywords: [], recentItems: [] })).toBeNull()
  })

  it('devolve a única palavra-chave quando só há uma', () => {
    expect(pickNextKeyword({ contentType: 'blog', keywords: ['limpeza residencial'], recentItems: [] })).toBe('limpeza residencial')
  })

  it('prioriza a palavra-chave menos usada recentemente', () => {
    const now = Date.now()
    const recentItems = [
      { target_keyword: 'limpeza residencial', created_at: new Date(now).toISOString() },
      { target_keyword: 'faxina campinas', created_at: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() },
    ]
    expect(pickNextKeyword({ contentType: 'blog', keywords: ['limpeza residencial', 'faxina campinas'], recentItems })).toBe('faxina campinas')
  })
})
