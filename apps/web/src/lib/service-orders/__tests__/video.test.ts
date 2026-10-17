import { describe, expect, it } from 'vitest'
import { pickRecorderMimeType, validateVideoFile, videoExtension, VIDEO_BITS_PER_SECOND } from '../video'
import { MAX_VIDEO_SECONDS } from '../media'

describe('pickRecorderMimeType', () => {
  it('prefere mp4 (Safari) e cai pra webm (Chrome)', () => {
    expect(pickRecorderMimeType((t) => t === 'video/mp4')).toBe('video/mp4')
    expect(pickRecorderMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus')
    expect(pickRecorderMimeType(() => false)).toBeNull()
  })
  it('extensão por tipo', () => {
    expect(videoExtension('video/mp4;codecs=avc1')).toBe('mp4')
    expect(videoExtension('video/webm')).toBe('webm')
  })
})

describe('validateVideoFile', () => {
  it('aceita vídeo pequeno e curto', () => {
    expect(validateVideoFile({ size: 5e6, type: 'video/mp4' }, 12).ok).toBe(true)
    expect(validateVideoFile({ size: 5e6, type: 'video/mp4' }, null).ok).toBe(true)
  })
  it('recusa não-vídeo, vazio, >50MB e >15s', () => {
    expect(validateVideoFile({ size: 5e6, type: 'image/png' }, 1).ok).toBe(false)
    expect(validateVideoFile({ size: 0, type: 'video/mp4' }, 1).ok).toBe(false)
    expect(validateVideoFile({ size: 51 * 1024 * 1024, type: 'video/mp4' }, 5).ok).toBe(false)
    expect(validateVideoFile({ size: 5e6, type: 'video/mp4' }, MAX_VIDEO_SECONDS + 3).ok).toBe(false)
  })
  it('bitrate mantém 15s bem abaixo de 50MB', () => {
    expect((VIDEO_BITS_PER_SECOND / 8) * MAX_VIDEO_SECONDS).toBeLessThan(10 * 1024 * 1024)
  })
})
