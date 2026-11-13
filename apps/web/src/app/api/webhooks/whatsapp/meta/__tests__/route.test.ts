import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
})

describe('webhook oficial da Meta', () => {
  it('confirma o challenge apenas com o token correto', async () => {
    vi.stubEnv('META_WHATSAPP_VERIFY_TOKEN', 'verify-secret')
    const { GET } = await import('../route')

    const ok = await GET(new Request('http://localhost/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=1234'))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('1234')

    const denied = await GET(new Request('http://localhost/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234'))
    expect(denied.status).toBe(403)
  })

  it('recusa payload sem assinatura da Meta antes de acessar o banco', async () => {
    vi.stubEnv('META_WHATSAPP_APP_SECRET', 'app-secret')
    const { POST } = await import('../route')
    const response = await POST(new Request('http://localhost/api/webhooks/whatsapp/meta', {
      method: 'POST',
      body: JSON.stringify({ entry: [] }),
    }))
    expect(response.status).toBe(401)
  })
})
