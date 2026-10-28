import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishFacebookVideo, publishInstagramReel, type SocialConfig } from '../meta-content'

const config: SocialConfig = { pageAccessToken: 'tok', pageId: 'page1' }
const ok = (body: unknown) => ({ ok: true, json: async () => body })
afterEach(() => vi.unstubAllGlobals())

function recorder(handler: (url: string, body: URLSearchParams | null) => unknown) {
  const calls: { url: string; body: URLSearchParams | null }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: { body?: URLSearchParams }) => {
    const body = init?.body ?? null
    calls.push({ url: String(input), body })
    return ok(handler(String(input), body))
  }))
  return calls
}

describe('publishInstagramReel', () => {
  it('cria o contêiner REELS, espera o processamento e só então publica', async () => {
    let polls = 0
    const calls = recorder((url, body) => {
      if (url.includes('/media_publish')) return { id: 'reel1' }
      if (body) return { id: 'container1' }
      return { status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' }
    })
    const out = await publishInstagramReel(config, { instagramBusinessAccountId: 'ig1', videoUrl: 'https://cdn/v.mp4', caption: 'legenda' }, { pollIntervalMs: 0, maxAttempts: 10 })
    expect(out).toEqual({ externalPostId: 'reel1' })
    const create = calls.find((c) => c.body && c.url.endsWith('/ig1/media'))!
    expect(create.body!.get('media_type')).toBe('REELS')
    expect(create.body!.get('video_url')).toBe('https://cdn/v.mp4')
    expect(create.body!.get('caption')).toBe('legenda')
    expect(calls.at(-1)!.url).toContain('/media_publish')
    expect(polls).toBe(3)
  })
  it('se o processamento falha, não publica', async () => {
    const calls = recorder((url, body) => (body ? { id: 'c' } : { status_code: 'ERROR' }))
    await expect(publishInstagramReel(config, { instagramBusinessAccountId: 'ig1', videoUrl: 'u', caption: '' }, { pollIntervalMs: 0, maxAttempts: 3 })).rejects.toThrow(/falhou ao processar/)
    expect(calls.some((c) => c.url.includes('/media_publish'))).toBe(false)
  })
})

describe('publishFacebookVideo', () => {
  it('envia o vídeo por URL com a legenda', async () => {
    const calls = recorder(() => ({ id: 'fbvideo1' }))
    expect(await publishFacebookVideo(config, { videoUrl: 'https://cdn/v.mp4', caption: 'oi' })).toEqual({ externalPostId: 'fbvideo1' })
    expect(calls[0]!.url).toContain('/page1/videos')
    expect(calls[0]!.body!.get('file_url')).toBe('https://cdn/v.mp4')
    expect(calls[0]!.body!.get('description')).toBe('oi')
  })
})
