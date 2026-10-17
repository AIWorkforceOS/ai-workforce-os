import { beforeEach, describe, expect, it, vi } from 'vitest'

const upload = vi.fn()
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ upload }) } }) }))

import { uploadAndRegisterMedia } from '../media-upload'

const params = { unitId: 'u', appointmentId: 'a', fieldName: 'photosBefore', saveId: 's-1', position: 0, file: new File(['x'], 'f.jpg', { type: 'image/jpeg' }) }

beforeEach(() => {
  upload.mockReset()
  vi.unstubAllGlobals()
})

describe('uploadAndRegisterMedia', () => {
  it('sobe com upsert no caminho determinístico e registra', async () => {
    upload.mockResolvedValue({ error: null })
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() })
    vi.stubGlobal('fetch', fetchMock)
    expect(await uploadAndRegisterMedia(params)).toEqual({ kind: 'synced' })
    expect(upload.mock.calls[0]![0]).toBe('u/a/antes-s-1-0-f.jpg')
    expect(upload.mock.calls[0]![2]).toMatchObject({ upsert: true })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).items[0]).toEqual({ path: 'u/a/antes-s-1-0-f.jpg', kind: 'before' })
  })
  it('falha de rede no upload mantém (retry), sem registrar', async () => {
    upload.mockRejectedValue(new Error('net'))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await uploadAndRegisterMedia(params)).toEqual({ kind: 'retry', reason: 'network' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('JWT expirado vira retry de sessão', async () => {
    upload.mockResolvedValue({ error: { message: 'JWT expired' } })
    expect(await uploadAndRegisterMedia(params)).toMatchObject({ kind: 'retry', reason: 'session' })
  })
  it('422 no registro é retry; 401 é sessão; campo desconhecido falha', async () => {
    upload.mockResolvedValue({ error: null })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 422, ok: false, headers: new Headers() }))
    expect(await uploadAndRegisterMedia(params)).toMatchObject({ kind: 'retry' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false, headers: new Headers() }))
    expect(await uploadAndRegisterMedia(params)).toMatchObject({ kind: 'retry', reason: 'session' })
    expect(await uploadAndRegisterMedia({ ...params, fieldName: 'xyz' })).toMatchObject({ kind: 'failed' })
  })
})
