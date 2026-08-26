import { describe, expect, it, vi, afterEach } from 'vitest'
import { researchCompanyWebsite } from '../company-research'

describe('researchCompanyWebsite', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('URL inválida: erro descritivo sem tentar fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await researchCompanyWebsite({ url: 'não é uma url', apiKey: 'key' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('inválida')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aceita domínio sem protocolo (ex.: "padariaestrela.com.br") e completa com https://', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('padariaestrela.com.br')) {
        return new Response('<html><body>Cardápio completo, pão francês R$0,50, bolos por encomenda, aberto 6h-20h todos os dias.</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"dossier":"Padaria com cardápio de pães e bolos, funciona das 6h às 20h."}' } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await researchCompanyWebsite({ url: 'padariaestrela.com.br', apiKey: 'key' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe('https://padariaestrela.com.br/')
      expect(result.summary).toContain('pães')
    }
  })

  it('site fora do ar: erro descritivo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 500 })))

    const result = await researchCompanyWebsite({ url: 'https://site-fora-do-ar.com', apiKey: 'key' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('acessar')
  })

  it('site com pouco conteúdo (só menu de navegação): não inventa um dossiê, devolve erro', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('vazio.com')) {
        return new Response('<html><body><nav>Home Sobre Contato</nav></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"dossier":null}' } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await researchCompanyWebsite({ url: 'https://vazio.com', apiKey: 'key' })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('conteúdo suficiente')
  })
})
