import { describe, expect, it, vi } from 'vitest'
import { kickQuoteJob } from '../server'
import { isRunnerAuthorized } from '../runner-auth'

const req = (auth?: string) => new Request('http://x', { headers: auth ? { authorization: auth } : {} })

describe('autenticação servidor-a-servidor (cron e disparo imediato)', () => {
  it('só passa com Bearer <CRON_SECRET> exato', () => {
    expect(isRunnerAuthorized(req('Bearer s3cret'), { CRON_SECRET: 's3cret' })).toBe(true)
    expect(isRunnerAuthorized(req('Bearer outro'), { CRON_SECRET: 's3cret' })).toBe(false)
    expect(isRunnerAuthorized(req('s3cret'), { CRON_SECRET: 's3cret' })).toBe(false)
    expect(isRunnerAuthorized(req(), { CRON_SECRET: 's3cret' })).toBe(false)
  })
  it('sem CRON_SECRET configurado NINGUÉM passa (nunca aberto por padrão, nem com cabeçalho vazio)', () => {
    expect(isRunnerAuthorized(req('Bearer '), {})).toBe(false)
    expect(isRunnerAuthorized(req('Bearer undefined'), {})).toBe(false)
    expect(isRunnerAuthorized(req(), { CRON_SECRET: '' })).toBe(false)
  })
})

describe('kickQuoteJob (disparo imediato após salvar)', () => {
  it('chama a rota de execução com o segredo e devolve true se aceitou (202)', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
    expect(await kickQuoteJob('https://alizoai.com', 'job-1', f as never)).toBe(true)
    expect(f).toHaveBeenCalledWith('https://alizoai.com/api/quote-jobs/job-1/run', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer s3cret' } }))
  })
  it('nunca lança: rede caída, resposta ruim ou sem segredo só devolve false (o cron por minuto pega o job)', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect(await kickQuoteJob('https://x', 'j', vi.fn().mockRejectedValue(new Error('rede')) as never)).toBe(false)
    expect(await kickQuoteJob('https://x', 'j', vi.fn().mockResolvedValue(new Response(null, { status: 500 })) as never)).toBe(false)
    vi.stubEnv('CRON_SECRET', '')
    const f = vi.fn()
    expect(await kickQuoteJob('https://x', 'j', f as never)).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})
