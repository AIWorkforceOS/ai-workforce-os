import { describe, expect, it } from 'vitest'
import { mediaItemsForPost } from '../media-items'

describe('mediaItemsForPost (o que abre em tela grande)', () => {
  it('imagem única: a própria imagem', () => {
    expect(mediaItemsForPost({ format: 'image', image_url: 'https://x/a.png', carousel: null, video: null })).toEqual([{ type: 'image', src: 'https://x/a.png', alt: 'Imagem do post' }])
  })
  it('post antigo, sem format: continua abrindo a imagem', () => {
    expect(mediaItemsForPost({ image_url: 'https://x/a.png' } as never)).toHaveLength(1)
  })
  it('carrossel: galeria com todos os slides, em ordem', () => {
    const items = mediaItemsForPost({ format: 'carousel', image_url: 'https://x/1.png', carousel: { slide_urls: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png'] } as never, video: null })
    expect(items.map((i) => i.src)).toEqual(['https://x/1.png', 'https://x/2.png', 'https://x/3.png'])
    expect(items[1]!.alt).toBe('Slide 2 de 3')
  })
  it('vídeo: abre o MP4 (com capa), não a imagem', () => {
    const items = mediaItemsForPost({ format: 'video', image_url: 'https://x/poster.png', carousel: null, video: { mp4_url: 'https://x/v.mp4', poster_url: 'https://x/poster.png' } as never })
    expect(items).toEqual([{ type: 'video', src: 'https://x/v.mp4', poster: 'https://x/poster.png', alt: 'Vídeo do post' }])
  })
  it('sem mídia, nada para abrir', () => {
    expect(mediaItemsForPost({ format: 'image', image_url: null, carousel: null, video: null })).toEqual([])
  })
})
