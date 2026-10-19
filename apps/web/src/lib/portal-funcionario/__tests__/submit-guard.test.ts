import { describe, expect, it } from 'vitest'
import { createSubmitGuard } from '../submit-guard'

describe('trava de duplo toque no Salvar', () => {
  it('dois toques seguidos: só o primeiro roda; o segundo é ignorado', async () => {
    const guard = createSubmitGuard()
    let calls = 0
    let release: () => void = () => undefined
    const first = guard.run(async () => { calls++; await new Promise<void>((r) => (release = r)) })
    const second = await guard.run(async () => { calls++ })
    expect(second).toEqual({ ran: false })
    expect(guard.active).toBe(true)
    release()
    expect((await first).ran).toBe(true)
    expect(calls).toBe(1)
  })
  it('libera ao terminar e também quando o salvamento falha (nunca fica travado)', async () => {
    const guard = createSubmitGuard()
    await expect(guard.run(async () => { throw new Error('rede') })).rejects.toThrow('rede')
    expect(guard.active).toBe(false)
    expect((await guard.run(async () => 7))).toEqual({ ran: true, value: 7 })
  })
})
