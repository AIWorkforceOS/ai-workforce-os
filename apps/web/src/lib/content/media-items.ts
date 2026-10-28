// O que abrir em tela grande ao clicar na miniatura de um post: imagem única → a imagem; carrossel → galeria dos slides; vídeo → o vídeo (toca).

import type { ContentPost } from './types'

export type MediaItem = { type: 'image' | 'video'; src: string; poster?: string; alt: string }

export function mediaItemsForPost(post: Pick<ContentPost, 'format' | 'image_url' | 'carousel' | 'video'>): MediaItem[] {
  if (post.format === 'video' && post.video?.mp4_url) {
    return [{ type: 'video', src: post.video.mp4_url, poster: post.video.poster_url, alt: 'Vídeo do post' }]
  }
  if (post.format === 'carousel' && post.carousel?.slide_urls?.length) {
    return post.carousel.slide_urls.map((src, i) => ({ type: 'image' as const, src, alt: `Slide ${i + 1} de ${post.carousel!.slide_urls.length}` }))
  }
  return post.image_url ? [{ type: 'image', src: post.image_url, alt: 'Imagem do post' }] : []
}
