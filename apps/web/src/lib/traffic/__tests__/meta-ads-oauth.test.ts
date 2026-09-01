// Login com Facebook pro Tráfego Pago (pedido do Vinicius, 2026-08-28) —
// mesmo problema resolvido pro Gestor de Conteúdo em 2026-08-22, aplicado
// à conta de anúncio. buildFacebookOAuthUrl/signOAuthState/verifyOAuthState
// já são testados em lib/content/__tests__/meta-oauth.test.ts (reaproveitados
// aqui sem duplicação) — este arquivo cobre só o que é específico de conta
// de anúncio.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { META_ADS_OAUTH_SCOPES, getMetaAdsAppCredentials, listManagedAdAccounts } from '../meta-ads-oauth'

describe('META_ADS_OAUTH_SCOPES', () => {
  it('pede as permissões de operar contas de anúncio', () => {
    expect(META_ADS_OAUTH_SCOPES).toContain('ads_management')
    expect(META_ADS_OAUTH_SCOPES).toContain('ads_read')
    expect(META_ADS_OAUTH_SCOPES).toContain('business_management')
  })
})

describe('getMetaAdsAppCredentials', () => {
  const originalEnv = { ...process.env }
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('null quando falta alguma env var (degradação graciosa)', () => {
    delete process.env.META_APP_ID
    delete process.env.META_APP_SECRET
    delete process.env.META_ADS_LOGIN_CONFIG_ID
    expect(getMetaAdsAppCredentials()).toBeNull()
  })

  it('devolve as credenciais quando as 3 env vars estão presentes', () => {
    process.env.META_APP_ID = 'app123'
    process.env.META_APP_SECRET = 'secret123'
    process.env.META_ADS_LOGIN_CONFIG_ID = 'cfg-ads-123'
    expect(getMetaAdsAppCredentials()).toEqual({ appId: 'app123', appSecret: 'secret123', loginConfigId: 'cfg-ads-123' })
  })

  it('usa META_ADS_LOGIN_CONFIG_ID (separado do META_LOGIN_CONFIG_ID do Conteúdo) — mesmo com o do Conteúdo presente, sem o de anúncios continua null', () => {
    process.env.META_APP_ID = 'app123'
    process.env.META_APP_SECRET = 'secret123'
    process.env.META_LOGIN_CONFIG_ID = 'cfg-content-999'
    delete process.env.META_ADS_LOGIN_CONFIG_ID
    expect(getMetaAdsAppCredentials()).toBeNull()
  })
})

describe('listManagedAdAccounts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('devolve as contas de anúncio que o usuário administra', async () => {
    const accounts = [
      { id: 'act_111', name: 'Padaria da Maria', currency: 'BRL', account_status: 1 },
      { id: 'act_222', name: 'Padaria da Maria (loja 2)', currency: 'BRL', account_status: 1 },
    ]
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ data: accounts }) }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listManagedAdAccounts('user-token')

    expect(result).toEqual(accounts)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = new URL(fetchMock.mock.calls[0]![0])
    expect(calledUrl.pathname).toContain('me/adaccounts')
    expect(calledUrl.searchParams.get('access_token')).toBe('user-token')
  })

  it('lança erro com o código da Meta quando a chamada falha', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: 'Invalid token', code: 190 } }) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listManagedAdAccounts('bad-token')).rejects.toThrow('Invalid token')
  })
})
