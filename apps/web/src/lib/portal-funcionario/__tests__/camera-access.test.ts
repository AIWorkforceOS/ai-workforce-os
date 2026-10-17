import { afterEach, describe, expect, it, vi } from 'vitest'
import { cameraHelp, classifyCameraError, queryCameraPermission, requestCameraAccess } from '../camera-access'

afterEach(() => vi.unstubAllGlobals())

describe('classifyCameraError', () => {
  it('mapeia os erros do navegador', () => {
    expect(classifyCameraError({ name: 'NotAllowedError' })).toBe('denied')
    expect(classifyCameraError({ name: 'NotReadableError' })).toBe('in_use')
    expect(classifyCameraError({ name: 'NotFoundError' })).toBe('not_found')
    expect(classifyCameraError(new Error('x'))).toBe('error')
  })
})

describe('requestCameraAccess', () => {
  it('concede e libera a câmera em seguida', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }) } })
    expect(await requestCameraAccess()).toEqual({ ok: true })
    expect(stop).toHaveBeenCalled()
  })
  it('negado = denied, sem insistir', async () => {
    const getUserMedia = vi.fn().mockRejectedValue({ name: 'NotAllowedError' })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    expect(await requestCameraAccess()).toEqual({ ok: false, reason: 'denied' })
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })
  it('restrição de qualidade recusada: tenta de novo com restrição simples', async () => {
    const getUserMedia = vi.fn().mockRejectedValueOnce({ name: 'OverconstrainedError' }).mockResolvedValueOnce({ getTracks: () => [] })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    expect(await requestCameraAccess()).toEqual({ ok: true })
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
  it('sem suporte', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestCameraAccess()).toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('queryCameraPermission / cameraHelp', () => {
  it('lê o estado quando o navegador deixa; unknown quando não', async () => {
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state: 'denied' }) } })
    expect(await queryCameraPermission()).toBe('denied')
    vi.stubGlobal('navigator', {})
    expect(await queryCameraPermission()).toBe('unknown')
  })
  it('instrução específica de iPhone e Android', () => {
    expect(cameraHelp('denied', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toMatch(/aA/)
    expect(cameraHelp('denied', 'Mozilla/5.0 (Linux; Android 14)')).toMatch(/cadeado/)
  })
})
