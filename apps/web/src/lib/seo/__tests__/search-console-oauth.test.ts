import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildGoogleOAuthUrl,
  exchangeCodeForTokens,
  getGoogleSearchConsoleCredentials,
  listVerifiedSites,
  refreshAccessToken,
  signOAuthState,
  verifyOAuthState,
} from '../search-console-oauth'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe('getGoogleSearchConsoleCredentials', () => {
  it('null quando faltam as env vars (integração falha graciosamente)', () => {
    delete process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID
    delete process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
    expect(getGoogleSearchConsoleCredentials()).toBeNull()
  })

  it('devolve client id/secret quando ambos configurados', () => {
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID = 'client-1'
    process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET = 'secret-1'
    expect(getGoogleSearchConsoleCredentials()).toEqual({ clientId: 'client-1', clientSecret: 'secret-1' })
  })
})

describe('buildGoogleOAuthUrl', () => {
  it('monta a URL de autorização com escopo, offline access e state', () => {
    const url = buildGoogleOAuthUrl({ clientId: 'client-1', redirectUri: 'https://app.com/callback', state: 'signed-state' })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe('client-1')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.com/callback')
    expect(parsed.searchParams.get('state')).toBe('signed-state')
    expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
  })
})

describe('signOAuthState / verifyOAuthState (reexportado de lib/content/meta-oauth)', () => {
  it('assina e verifica corretamente', () => {
    const state = signOAuthState({ unitId: 'unit-1' }, 'app-secret')
    expect(verifyOAuthState(state, 'app-secret')).toEqual({ unitId: 'unit-1' })
  })

  it('rejeita state assinado com outro secret', () => {
    const state = signOAuthState({ unitId: 'unit-1' }, 'app-secret')
    expect(verifyOAuthState(state, 'secret-errado')).toBeNull()
  })
})

describe('exchangeCodeForTokens', () => {
  it('troca o code por access+refresh token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 }) })),
    )
    const result = await exchangeCodeForTokens({ code: 'code-1', redirectUri: 'https://app.com/callback', clientId: 'c', clientSecret: 's' })
    expect(result).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresInSeconds: 3600 })
  })

  it('lança erro claro quando o Google não devolve refresh_token (reautorização sem revogar acesso)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'access-1', expires_in: 3600 }) })))
    await expect(exchangeCodeForTokens({ code: 'c', redirectUri: 'r', clientId: 'c', clientSecret: 's' })).rejects.toThrow('refresh token')
  })

  it('lança erro quando a resposta não é ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error_description: 'invalid_grant' }) })))
    await expect(exchangeCodeForTokens({ code: 'c', redirectUri: 'r', clientId: 'c', clientSecret: 's' })).rejects.toThrow('invalid_grant')
  })
})

describe('refreshAccessToken', () => {
  it('renova o access token a partir do refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'access-novo', expires_in: 3600 }) })))
    const result = await refreshAccessToken({ refreshToken: 'refresh-1', clientId: 'c', clientSecret: 's' })
    expect(result).toEqual({ accessToken: 'access-novo', expiresInSeconds: 3600 })
  })

  it('lança erro quando o refresh falha (token revogado)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error_description: 'invalid_grant' }) })))
    await expect(refreshAccessToken({ refreshToken: 'r', clientId: 'c', clientSecret: 's' })).rejects.toThrow('invalid_grant')
  })
})

describe('listVerifiedSites', () => {
  it('lista as propriedades verificadas, filtrando siteUnverifiedUser', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          siteEntry: [
            { siteUrl: 'https://exemplo.com/', permissionLevel: 'siteOwner' },
            { siteUrl: 'sc-domain:exemplo.com', permissionLevel: 'siteFullUser' },
            { siteUrl: 'https://outro.com/', permissionLevel: 'siteUnverifiedUser' },
          ],
        }),
      })),
    )
    const sites = await listVerifiedSites('access-1')
    expect(sites).toEqual(['https://exemplo.com/', 'sc-domain:exemplo.com'])
  })

  it('lista vazia quando a conta não tem nenhuma propriedade', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ siteEntry: [] }) })))
    expect(await listVerifiedSites('access-1')).toEqual([])
  })

  it('lança erro quando a API falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error_description: 'token expirado' }) })))
    await expect(listVerifiedSites('access-1')).rejects.toThrow('token expirado')
  })
})
