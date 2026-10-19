import { describe, expect, it, vi } from 'vitest'
import { refreshApp, type RefreshDeps } from '../app-refresh'

const deps = (over: Partial<RefreshDeps> = {}): RefreshDeps & { reload: ReturnType<typeof vi.fn> } => {
  const registration = { update: vi.fn(async () => undefined), waiting: { postMessage: vi.fn() } } as unknown as ServiceWorkerRegistration
  return {
    countPending: async () => 0,
    getRegistration: async () => registration,
    activate: vi.fn(async () => true),
    confirm: vi.fn(() => true),
    reload: vi.fn(),
    sleep: async () => undefined,
    ...over,
  } as RefreshDeps & { reload: ReturnType<typeof vi.fn> }
}

describe('Atualizar o app', () => {
  it('sem itens pendentes: procura versão nova, ativa e recarrega', async () => {
    const d = deps()
    expect(await refreshApp(d)).toBe('reloaded')
    expect(d.activate).toHaveBeenCalled()
    expect(d.reload).toHaveBeenCalledTimes(1)
  })
  it('com itens pendentes: pergunta antes; se cancelar, não recarrega nem ativa nada', async () => {
    const d = deps({ countPending: async () => 3, confirm: vi.fn(() => false) })
    expect(await refreshApp(d)).toBe('cancelled')
    expect(d.reload).not.toHaveBeenCalled()
    expect(d.activate).not.toHaveBeenCalled()
  })
  it('com itens pendentes e confirmado: recarrega sem trocar o service worker (a fila fica intacta no aparelho)', async () => {
    const d = deps({ countPending: async () => 2 })
    expect(await refreshApp(d)).toBe('reloaded')
    expect(d.activate).not.toHaveBeenCalled()
    expect(d.reload).toHaveBeenCalledTimes(1)
  })
  it('sem service worker ou com falha ao procurar atualização: ainda recarrega (as páginas vêm sempre da rede)', async () => {
    const semSw = deps({ getRegistration: async () => undefined })
    expect(await refreshApp(semSw)).toBe('reloaded')
    const quebrado = deps({ getRegistration: async () => { throw new Error('x') } })
    expect(await refreshApp(quebrado)).toBe('reloaded')
    expect(quebrado.reload).toHaveBeenCalled()
    const semBanco = deps({ countPending: async () => { throw new Error('idb') } })
    expect(await refreshApp(semBanco)).toBe('reloaded')
  })
})
