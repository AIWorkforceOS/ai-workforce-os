import { describe, expect, it } from 'vitest'
import { extractStaticAssetUrls, installReadiness, parseOfflineTarget } from '../offline-routes'
import { isSnapshotUsable, SNAPSHOT_MAX_AGE_MS } from '../offline-store'
import { hasRoom, isStorageLow, roomNeeded } from '../storage-quota'

const ID = '639bfb55-2a72-4430-90ce-c4770431c30f'

describe('parseOfflineTarget', () => {
  it('reconhece ordem, sincronização e agenda; o resto cai na agenda', () => {
    expect(parseOfflineTarget(`/portal-funcionario/ordem/${ID}`)).toEqual({ view: 'order', appointmentId: ID })
    expect(parseOfflineTarget(`/portal-funcionario/ordem/${ID}/?x=1`)).toEqual({ view: 'order', appointmentId: ID })
    expect(parseOfflineTarget('/portal-funcionario/sincronizacao')).toEqual({ view: 'sync' })
    expect(parseOfflineTarget('/portal-funcionario')).toEqual({ view: 'agenda' })
    expect(parseOfflineTarget(null)).toEqual({ view: 'agenda' })
  })
  it('não aceita caminho estranho nem id que não é UUID', () => {
    expect(parseOfflineTarget('/portal-funcionario/ordem/abc')).toEqual({ view: 'agenda' })
    expect(parseOfflineTarget('//evil.com/portal-funcionario')).toEqual({ view: 'agenda' })
    expect(parseOfflineTarget('/dashboard')).toEqual({ view: 'agenda' })
  })
})

describe('extractStaticAssetUrls', () => {
  it('acha scripts e estilos em tags e no payload, sem repetir', () => {
    const html = `<link href="/_next/static/css/a1.css"/><script src="/_next/static/chunks/main-9.js"></script><script>self.__next_f.push([1,"x \\"/_next/static/chunks/page-7.js\\" y"])</script><script src="/_next/static/chunks/main-9.js"></script>`
    expect(extractStaticAssetUrls(html).sort()).toEqual(['/_next/static/chunks/main-9.js', '/_next/static/chunks/page-7.js', '/_next/static/css/a1.css'])
  })
})

describe('installReadiness (trocar o ícone do Safari pelo app)', () => {
  it('só fica pronto com fila vazia, sem erros, sem rascunhos e com internet', () => {
    expect(installReadiness({ pendingItems: 0, failedItems: 0, drafts: 0, online: true })).toEqual({ ready: true, reasons: [] })
  })
  it('qualquer pendência bloqueia e diz o motivo', () => {
    const r = installReadiness({ pendingItems: 2, failedItems: 1, drafts: 3, online: false })
    expect(r.ready).toBe(false)
    expect(r.reasons).toHaveLength(4)
  })
})

describe('validade do snapshot (só consulta)', () => {
  it('14 dias: depois disso a agenda guardada não é exibida (nada é apagado por isso)', () => {
    const now = Date.now()
    expect(isSnapshotUsable({ savedAt: now - 13 * 86_400_000 }, now)).toBe(true)
    expect(isSnapshotUsable({ savedAt: now - SNAPSHOT_MAX_AGE_MS - 1 }, now)).toBe(false)
    expect(isSnapshotUsable(null, now)).toBe(false)
  })
})

describe('espaço no aparelho', () => {
  const MB = 1024 * 1024
  const status = (free: number, quota = 1000 * MB) => ({ supported: true, usage: quota - free, quota, free, persisted: false })
  it('só aceita guardar se sobrar espaço com margem', () => {
    expect(hasRoom(status(500 * MB), 50 * MB)).toBe(true)
    expect(hasRoom(status(60 * MB), 50 * MB)).toBe(false)
    expect(roomNeeded(10 * MB)).toBe(15 * MB + 25 * MB)
  })
  it('navegador sem estimativa não bloqueia (não dá para saber)', () => {
    expect(hasRoom({ supported: false, usage: 0, quota: 0, free: Infinity, persisted: false }, 999 * MB)).toBe(true)
  })
  it('avisa antes de acabar', () => {
    expect(isStorageLow(status(100 * MB))).toBe(true)
    expect(isStorageLow(status(400 * MB))).toBe(false)
    expect(isStorageLow(status(50 * MB, 400 * MB))).toBe(true)
  })
})
