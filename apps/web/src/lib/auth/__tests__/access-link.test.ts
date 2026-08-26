import { describe, expect, it, vi } from 'vitest'
import { generateAccessLink } from '../access-link'

function fakeService(generateLink: (args: { type: 'invite' | 'recovery' }) => Promise<unknown>) {
  return { auth: { admin: { generateLink } } } as unknown as Parameters<typeof generateAccessLink>[0]
}

describe('generateAccessLink', () => {
  it('conta nova: usa o link de invite', async () => {
    const generateLink = vi.fn(async ({ type }: { type: 'invite' | 'recovery' }) =>
      type === 'invite' ? { data: { properties: { action_link: 'https://x/invite' } }, error: null } : null,
    )
    const service = fakeService(generateLink)

    const result = await generateAccessLink(service, 'maria@padaria.com', 'https://app/auth/set-password')

    expect(result).toEqual({ ok: true, link: 'https://x/invite', linkType: 'invite' })
    expect(generateLink).toHaveBeenCalledTimes(1)
  })

  it('conta já existe (invite falha com "already registered"): cai pro link de recovery', async () => {
    const generateLink = vi.fn(async ({ type }: { type: 'invite' | 'recovery' }) =>
      type === 'invite'
        ? { data: {}, error: { message: 'User already registered' } }
        : { data: { properties: { action_link: 'https://x/recovery' } }, error: null },
    )
    const service = fakeService(generateLink)

    const result = await generateAccessLink(service, 'maria@padaria.com', 'https://app/auth/set-password')

    expect(result).toEqual({ ok: true, link: 'https://x/recovery', linkType: 'recovery' })
    expect(generateLink).toHaveBeenCalledTimes(2)
  })

  it('invite falha por outro motivo (não "already exists"): erro, sem tentar recovery', async () => {
    const generateLink = vi.fn(async () => ({ data: {}, error: { message: 'Rate limit exceeded' } }))
    const service = fakeService(generateLink)

    const result = await generateAccessLink(service, 'maria@padaria.com', 'https://app/auth/set-password')

    expect(result).toEqual({ ok: false, error: 'Rate limit exceeded' })
    expect(generateLink).toHaveBeenCalledTimes(1)
  })

  it('recovery também falha: erro descritivo', async () => {
    const generateLink = vi.fn(async ({ type }: { type: 'invite' | 'recovery' }) =>
      type === 'invite'
        ? { data: {}, error: { message: 'already registered' } }
        : { data: {}, error: { message: 'boom' } },
    )
    const service = fakeService(generateLink)

    const result = await generateAccessLink(service, 'maria@padaria.com', 'https://app/auth/set-password')

    expect(result).toEqual({ ok: false, error: 'boom' })
  })
})
