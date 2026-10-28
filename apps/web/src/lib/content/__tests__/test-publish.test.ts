import { describe, expect, it } from 'vitest'
import { TEST_CAROUSEL, TEST_VIDEO, checkTestPublishRequest, isTestPageName } from '../test-publish'
import { normalizeCarouselEdit } from '../carousel'
import { normalizeVideoEdit } from '../video'

describe('isTestPageName', () => {
  it.each(['Alizo TESTE', 'Mawi - Teste Meta', 'Sandbox Alizo', 'Page Test', 'test'])('aceita: %s', (n) => expect(isTestPageName(n)).toBe(true))
  it.each(['Mawi Cleaning', 'AlizoAI', 'Contestação Ltda', 'Latest News', 'Detestável', '', null, undefined])('recusa: %s', (n) => expect(isTestPageName(n as string)).toBe(false))
})

describe('checkTestPublishRequest', () => {
  const base = { pageName: 'Alizo TESTE', confirm: 'Alizo TESTE', isSuperAdmin: true }
  it('passa só com super admin, página de teste e confirmação exata', () => {
    expect(checkTestPublishRequest(base)).toEqual({ ok: true })
  })
  it('perfil real é recusado mesmo com a confirmação certa', () => {
    expect(checkTestPublishRequest({ ...base, pageName: 'Mawi Cleaning', confirm: 'Mawi Cleaning' }).ok).toBe(false)
  })
  it('sem super admin ou com confirmação errada, recusa', () => {
    expect(checkTestPublishRequest({ ...base, isSuperAdmin: false }).ok).toBe(false)
    expect(checkTestPublishRequest({ ...base, confirm: 'alizo teste' }).ok).toBe(false)
    expect(checkTestPublishRequest({ ...base, confirm: undefined }).ok).toBe(false)
  })
})

describe('conteúdo de teste', () => {
  it('é marcado como teste e é válido para o carrossel e o vídeo (3+ slides/cenas, 15–30 s)', () => {
    expect(JSON.stringify(TEST_CAROUSEL)).toContain('TESTE')
    expect(JSON.stringify(TEST_VIDEO)).toContain('TESTE')
    expect(normalizeCarouselEdit(TEST_CAROUSEL).ok).toBe(true)
    expect(normalizeVideoEdit(TEST_VIDEO).ok).toBe(true)
  })
})
