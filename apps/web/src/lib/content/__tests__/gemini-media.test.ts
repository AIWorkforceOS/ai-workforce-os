import { beforeEach, describe, expect, it, vi } from 'vitest'

const reserveGeminiUsage = vi.fn(async () => true)
vi.mock('@/lib/api-usage', () => ({
  GEMINI_IMAGE_COST_USD: 0.0504,
  GEMINI_VIDEO_15S_COST_USD: 1.04256,
  reserveGeminiUsage,
}))

describe('Gemini media', () => {
  beforeEach(() => {
    vi.resetModules()
    reserveGeminiUsage.mockClear()
  })

  it('usa image_size no contrato de imagem da Interactions API', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ steps: [{ content: [{ type: 'image', data: 'aW1hZ2U=', mime_type: 'image/png' }] }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { generateGeminiImage } = await import('../gemini-media')

    await generateGeminiImage({ apiKey: 'test-key', prompt: 'poster' })

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body.response_format).toEqual({ type: 'image', aspect_ratio: '4:5', image_size: '2K' })
    expect(body.response_format).not.toHaveProperty('resolution')
  })
})
