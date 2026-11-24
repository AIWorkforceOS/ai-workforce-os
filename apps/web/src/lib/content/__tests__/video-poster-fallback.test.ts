import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { createFallbackVideoPoster } from '../video-post'

describe('capa local de contingência do vídeo', () => {
  it('gera PNG válido com as dimensões da capa', async () => {
    const poster = await createFallbackVideoPoster({ brandName: 'Mawi & Cleaning', primary: '#123456', secondary: '#abcdef' })
    const metadata = await sharp(poster).metadata()
    expect(metadata.format).toBe('png')
    expect(metadata.width).toBe(1080)
    expect(metadata.height).toBe(1350)
  })
})
