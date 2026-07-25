import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkKeywordRanking, getSerpApiKey } from '../rank-tracking'

describe('rank-tracking — SERP_API_KEY ausente (integração graciosa)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('getSerpApiKey devolve null quando a env var não está configurada', () => {
    vi.stubEnv('SERP_API_KEY', '')
    expect(getSerpApiKey()).toBeNull()
  })

  it('getSerpApiKey devolve a chave quando configurada', () => {
    vi.stubEnv('SERP_API_KEY', 'test-key-123')
    expect(getSerpApiKey()).toBe('test-key-123')
  })

  it('checkKeywordRanking nunca lança e devolve status not_configured sem a chave', async () => {
    vi.stubEnv('SERP_API_KEY', '')
    const result = await checkKeywordRanking({ keyword: 'limpeza residencial', siteUrl: 'https://example.com' })
    expect(result).toEqual({ status: 'not_configured' })
  })

  it('checkKeywordRanking não faz nenhuma chamada de rede sem a chave', async () => {
    vi.stubEnv('SERP_API_KEY', '')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await checkKeywordRanking({ keyword: 'x', siteUrl: 'https://example.com' })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
