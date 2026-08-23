// Publicação real no Instagram/Facebook — cobre o polling do container de
// mídia do Instagram (achado ao vivo em 2026-08-23: publicar sem esperar o
// container terminar de processar dá "Media ID is not available", code
// 9007). NÃO cobre o comportamento real da API, só o contrato das chamadas.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishInstagramPost, type SocialConfig } from '../meta-content'

const config: SocialConfig = { pageAccessToken: 'token123', pageId: 'page1' }
const params = { instagramBusinessAccountId: 'ig1', imageUrl: 'https://example.com/post.png', caption: 'legenda' }

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('publishInstagramPost', () => {
  it('publica direto quando o container já está FINISHED na primeira checagem', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'container1' })) // POST /media
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' })) // GET status
      .mockResolvedValueOnce(jsonResponse({ id: 'published1' })) // POST /media_publish
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishInstagramPost(config, params, { pollIntervalMs: 0 })

    expect(result).toEqual({ externalPostId: 'published1' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('espera o container sair de IN_PROGRESS antes de publicar (o bug real: publicar cedo demais dá code 9007)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'container1' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'published1' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishInstagramPost(config, params, { pollIntervalMs: 0 })

    expect(result).toEqual({ externalPostId: 'published1' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('rejeita com erro claro quando o container falha (status ERROR) — nunca chama media_publish', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'container1' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'ERROR' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishInstagramPost(config, params, { pollIntervalMs: 0 })).rejects.toThrow(/falhou ao processar/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('desiste com erro de timeout depois de maxAttempts sem FINISHED — nunca chama media_publish', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'container1' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ status_code: 'IN_PROGRESS' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(publishInstagramPost(config, params, { pollIntervalMs: 0, maxAttempts: 2 })).rejects.toThrow(/timeout/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
