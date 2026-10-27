import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishFacebookCarousel, publishInstagramCarousel, type SocialConfig } from '../meta-content'

const config: SocialConfig = { pageAccessToken: 'tok', pageId: 'page1' }
const urls = ['https://cdn/1.png', 'https://cdn/2.png', 'https://cdn/3.png']
const ok = (body: unknown) => ({ ok: true, json: async () => body })

afterEach(() => vi.unstubAllGlobals())

function recorder(handler: (url: string, body: URLSearchParams | null) => unknown) {
  const calls: { url: string; body: URLSearchParams | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: { body?: URLSearchParams }) => {
      const body = init?.body ?? null
      calls.push({ url: String(input), body })
      return ok(handler(String(input), body))
    }),
  )
  return calls
}

describe('publishInstagramCarousel', () => {
  it('cria um filho por slide, espera, cria o contêiner CAROUSEL com os filhos e só então publica', async () => {
    let n = 0
    const calls = recorder((url, body) => {
      if (url.includes('/media_publish')) return { id: 'published1' }
      if (url.includes('/media') && body) return { id: n++ < 3 ? `child${n}` : 'parent' }
      return { status_code: 'FINISHED' }
    })
    const result = await publishInstagramCarousel(config, { instagramBusinessAccountId: 'ig1', imageUrls: urls, caption: 'legenda' }, { pollIntervalMs: 0 })
    expect(result).toEqual({ externalPostId: 'published1' })
    const posts = calls.filter((c) => c.body)
    const children = posts.slice(0, 3)
    expect(children.every((c) => c.body!.get('is_carousel_item') === 'true')).toBe(true)
    expect(children.map((c) => c.body!.get('image_url'))).toEqual(urls)
    const parent = posts[3]!
    expect(parent.body!.get('media_type')).toBe('CAROUSEL')
    expect(parent.body!.get('children')!.split(',')).toHaveLength(3)
    expect(parent.body!.get('caption')).toBe('legenda')
    expect(posts[4]!.url).toContain('/media_publish')
    expect(posts[4]!.body!.get('creation_id')).toBe('parent')
  })
  it('recusa menos de 2 ou mais de 10 imagens, sem chamar a Meta', async () => {
    const calls = recorder(() => ({}))
    await expect(publishInstagramCarousel(config, { instagramBusinessAccountId: 'ig1', imageUrls: ['a'], caption: '' })).rejects.toThrow(/2 a 10/)
    await expect(publishInstagramCarousel(config, { instagramBusinessAccountId: 'ig1', imageUrls: Array(11).fill('a'), caption: '' })).rejects.toThrow(/2 a 10/)
    expect(calls).toHaveLength(0)
  })
  it('se um slide falha ao processar, não publica nada', async () => {
    const calls = recorder((url, body) => (body ? { id: 'c' } : { status_code: 'ERROR' }))
    await expect(publishInstagramCarousel(config, { instagramBusinessAccountId: 'ig1', imageUrls: urls, caption: 'x' }, { pollIntervalMs: 0 })).rejects.toThrow(/falhou ao processar/)
    expect(calls.some((c) => c.url.includes('/media_publish'))).toBe(false)
  })
})

describe('publishFacebookCarousel', () => {
  it('sobe as fotos sem publicar e cria um único post com attached_media', async () => {
    let n = 0
    const calls = recorder((url) => (url.includes('/photos') ? { id: `photo${++n}` } : { id: 'fbpost1' }))
    const result = await publishFacebookCarousel(config, { imageUrls: urls, caption: 'legenda' })
    expect(result).toEqual({ externalPostId: 'fbpost1' })
    const photos = calls.filter((c) => c.url.includes('/photos'))
    expect(photos.every((c) => c.body!.get('published') === 'false')).toBe(true)
    const feed = calls.find((c) => c.url.includes('/feed'))!
    expect(feed.body!.get('message')).toBe('legenda')
    expect(JSON.parse(feed.body!.get('attached_media[2]')!)).toEqual({ media_fbid: 'photo3' })
  })
})
