import { describe, expect, it } from 'vitest'
import { countVideosThisMonth, monthStartIso, videoRotationFrom, videoThemeFor } from '../video-focus'

const ROT = ['manutenção', 'manutenção', 'manutenção', 'limpeza']

describe('rotação de tema dos vídeos', () => {
  it('3 de manutenção e depois 1 de limpeza, repetindo o ciclo', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => videoThemeFor(ROT, n))).toEqual([...ROT, ...ROT])
  })

  it('sem rotação o vídeo é livre', () => {
    expect(videoThemeFor([], 5)).toBeNull()
  })

  it('lê só lista de textos da ficha e ignora lixo', () => {
    expect(videoRotationFrom({ video_rotacao: [' manutenção ', 3, '', 'limpeza', null] })).toEqual(['manutenção', 'limpeza'])
    expect(videoRotationFrom({ video_rotacao: 'manutenção' })).toEqual([])
    expect(videoRotationFrom(null)).toEqual([])
  })

  it('o mês começa no dia 1 do calendário da unidade', () => {
    expect(monthStartIso(new Date('2026-11-01T03:00:00Z'), 'America/Phoenix')).toBe('2026-10-01T00:00:00.000Z')
    expect(monthStartIso(new Date('2026-11-01T12:00:00Z'), 'America/Phoenix')).toBe('2026-11-01T00:00:00.000Z')
  })

  it('conta só vídeos que não falharam nem foram rejeitados e não quebra se o banco falhar', async () => {
    const calls: unknown[][] = []
    const ok: any = { from: () => chain(calls, { count: 2, error: null }) }
    expect(await countVideosThisMonth(ok, 'u1', 'America/Phoenix')).toBe(2)
    expect(calls).toContainEqual(['not', 'status', 'in', '(failed,rejected)'])
    expect(calls).toContainEqual(['eq', 'format', 'video'])
    const bad: any = { from: () => chain([], { count: null, error: { message: 'boom' } }) }
    expect(await countVideosThisMonth(bad, 'u1', 'America/Phoenix')).toBe(0)
  })
})

function chain(calls: unknown[][], result: unknown) {
  const c: any = new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : (...args: unknown[]) => { calls.push([name, ...args]); return name === 'gte' ? Promise.resolve(result) : c }) })
  return c
}
