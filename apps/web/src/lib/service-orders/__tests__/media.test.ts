import { describe, expect, it } from 'vitest'
import { isMediaUrlOfAppointment, buildMediaPath, isAllowedContentType, mediaSizeLimit, validateMediaItems, MAX_VIDEO_BYTES, MAX_PHOTO_BYTES } from '../media'

const U = 'unit-1'
const A = 'appt-1'

describe('buildMediaPath', () => {
  it('é determinístico: mesmo saveId/posição/nome gera o mesmo caminho (reenvio com upsert não duplica)', () => {
    const p = { unitId: U, appointmentId: A, kind: 'before' as const, saveId: 'save-9', position: 2, fileName: 'IMG 0001.jpg' }
    expect(buildMediaPath(p)).toBe(buildMediaPath(p))
    expect(buildMediaPath(p)).toBe('unit-1/appt-1/antes-save-9-2-IMG_0001.jpg')
  })
  it('vídeo e nota fiscal têm prefixos próprios; nome perigoso é sanitizado', () => {
    expect(buildMediaPath({ unitId: U, appointmentId: A, kind: 'video', saveId: 's', position: 0, fileName: '../x y.mp4' })).toBe('unit-1/appt-1/video-s-0-.._x_y.mp4')
    expect(buildMediaPath({ unitId: U, appointmentId: A, kind: 'material_invoice', saveId: 's', position: 0, fileName: 'n.jpg' })).toContain('nota-fiscal-')
  })
})

describe('validateMediaItems', () => {
  const ok = { path: `${U}/${A}/antes-s-0-a.jpg`, kind: 'before' }
  it('aceita caminhos da própria ordem', () => {
    expect(validateMediaItems([ok], U, A)).toEqual({ ok: true, items: [ok] })
  })
  it('recusa caminho de outra ordem/unidade, com .., tipo desconhecido, lista vazia ou enorme', () => {
    expect(validateMediaItems([{ path: `${U}/outra/antes-s-0-a.jpg`, kind: 'before' }], U, A).ok).toBe(false)
    expect(validateMediaItems([{ path: `${U}/${A}/../x.jpg`, kind: 'before' }], U, A).ok).toBe(false)
    expect(validateMediaItems([{ path: ok.path, kind: 'executavel' }], U, A).ok).toBe(false)
    expect(validateMediaItems([], U, A).ok).toBe(false)
    expect(validateMediaItems(Array.from({ length: 41 }, () => ok), U, A).ok).toBe(false)
    expect(validateMediaItems('x', U, A).ok).toBe(false)
  })
})

describe('limites e tipos', () => {
  it('vídeo até 50MB, foto até 25MB', () => {
    expect(mediaSizeLimit('video')).toBe(MAX_VIDEO_BYTES)
    expect(mediaSizeLimit('before')).toBe(MAX_PHOTO_BYTES)
  })
  it('só aceita o tipo certo pra cada categoria', () => {
    expect(isAllowedContentType('video', 'video/mp4')).toBe(true)
    expect(isAllowedContentType('video', 'image/jpeg')).toBe(false)
    expect(isAllowedContentType('before', 'image/jpeg')).toBe(true)
    expect(isAllowedContentType('before', 'application/pdf')).toBe(false)
    expect(isAllowedContentType('after', null)).toBe(false)
  })
})

describe('isMediaUrlOfAppointment', () => {
  const base = 'https://x.supabase.co/storage/v1/object/public/service-orders'
  it('aceita só URL desta ordem', () => {
    expect(isMediaUrlOfAppointment(`${base}/${U}/${A}/antes-1.jpg`, U, A)).toBe(true)
    expect(isMediaUrlOfAppointment(`${base}/${U}/outra/antes-1.jpg`, U, A)).toBe(false)
    expect(isMediaUrlOfAppointment(`${base}/${U}/${A}/../x.jpg`, U, A)).toBe(false)
    expect(isMediaUrlOfAppointment(42, U, A)).toBe(false)
  })
})
