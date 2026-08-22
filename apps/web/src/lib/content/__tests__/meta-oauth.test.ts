import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { buildFacebookOAuthUrl, signOAuthState, verifyOAuthState, META_OAUTH_SCOPES } from '../meta-oauth'

describe('buildFacebookOAuthUrl', () => {
  it('monta a URL de autorização com client_id, redirect_uri, state e config_id', () => {
    const url = buildFacebookOAuthUrl({
      appId: 'app123',
      redirectUri: 'https://app.alizoai.com/api/content/accounts/oauth/callback',
      state: 'xyz',
      configId: 'cfg123',
    })
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toContain('facebook.com')
    expect(parsed.searchParams.get('client_id')).toBe('app123')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.alizoai.com/api/content/accounts/oauth/callback')
    expect(parsed.searchParams.get('state')).toBe('xyz')
    expect(parsed.searchParams.get('config_id')).toBe('cfg123')
    expect(parsed.searchParams.get('response_type')).toBe('code')
  })

  it('pede os escopos de publicar no Facebook e no Instagram', () => {
    expect(META_OAUTH_SCOPES).toContain('pages_manage_posts')
    expect(META_OAUTH_SCOPES).toContain('instagram_content_publish')
  })
})

describe('signOAuthState / verifyOAuthState', () => {
  const secret = 'test-app-secret'

  it('assina e verifica de volta o mesmo unitId', () => {
    const state = signOAuthState({ unitId: 'unit-1' }, secret)
    const result = verifyOAuthState(state, secret)
    expect(result).toEqual({ unitId: 'unit-1' })
  })

  it('rejeita state assinado com outro secret (adulterado/forjado)', () => {
    const state = signOAuthState({ unitId: 'unit-1' }, secret)
    expect(verifyOAuthState(state, 'outro-secret')).toBeNull()
  })

  it('rejeita state malformado (sem o formato payload.assinatura)', () => {
    expect(verifyOAuthState('nao-e-um-state-valido', secret)).toBeNull()
    expect(verifyOAuthState('a.b.c', secret)).toBeNull()
  })

  it('rejeita state expirado (mais velho que a janela de tolerância)', () => {
    const stalePayload = Buffer.from(JSON.stringify({ unitId: 'unit-1', nonce: 'n', ts: Date.now() - 60 * 60_000 })).toString('base64url')
    const signature = createHmac('sha256', secret).update(stalePayload).digest('base64url')
    expect(verifyOAuthState(`${stalePayload}.${signature}`, secret)).toBeNull()
  })

  it('dois states pro mesmo unitId têm nonces diferentes (não é replay-able entre si)', () => {
    const stateA = signOAuthState({ unitId: 'unit-1' }, secret)
    const stateB = signOAuthState({ unitId: 'unit-1' }, secret)
    expect(stateA).not.toBe(stateB)
  })
})
