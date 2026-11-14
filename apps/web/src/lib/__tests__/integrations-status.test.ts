import { afterEach, describe, expect, it, vi } from 'vitest'
import { getIntegrationsConfigStatus } from '../integrations'

const META_ENV = [
  'META_WHATSAPP_ACCESS_TOKEN',
  'META_WHATSAPP_VERIFY_TOKEN',
  'META_WHATSAPP_APP_SECRET',
] as const

describe('getIntegrationsConfigStatus', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('só marca o WhatsApp oficial como configurado com as três credenciais', () => {
    for (const name of META_ENV) vi.stubEnv(name, '')
    expect(getIntegrationsConfigStatus().find((item) => item.key === 'meta_whatsapp')?.configured).toBe(false)

    for (const name of META_ENV) vi.stubEnv(name, 'configured')
    expect(getIntegrationsConfigStatus().find((item) => item.key === 'meta_whatsapp')?.configured).toBe(true)
  })
})
