import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBackgrounds, backdropPrompt, wantsSlideBackgrounds } from '../slide-backgrounds'
import type { CarouselContent } from '../carousel'
import type * as CarouselRender from '../carousel-render'

const inst = (original_text: string, over: Record<string, unknown> = {}, restrictions: string[] = []) =>
  ({ original_text, interpretation: { formats: [], avoid_formats: [], restrictions, ...over } }) as never

describe('wantsSlideBackgrounds', () => {
  it('lê a instrução real do dono (sem o campo estruturado, só pelo texto)', () => {
    const texto = 'sendo 1 correcel sempre com imagens de fundo a logo sempre sem fundo para não ficar com a faixa branca em volta, 1 video curto'
    expect(wantsSlideBackgrounds(inst(texto))).toBe(true)
  })
  it('campo estruturado vale; "sem imagens de fundo" e instrução sem o assunto não ligam', () => {
    expect(wantsSlideBackgrounds(inst('qualquer', { slide_backgrounds: true }))).toBe(true)
    expect(wantsSlideBackgrounds(inst('carrossel sem imagens de fundo'))).toBe(false)
    expect(wantsSlideBackgrounds(inst('não use fotos de fundo'))).toBe(false)
    expect(wantsSlideBackgrounds(inst('captar clientes comerciais com carrossel'))).toBe(false)
    expect(wantsSlideBackgrounds(null)).toBe(false)
  })
  it('um "false" da IA não apaga um pedido claro no texto', () => {
    expect(wantsSlideBackgrounds(inst('sempre com imagens de fundo', { slide_backgrounds: false }))).toBe(true)
  })
  it('o pedido pode vir só nas restrições', () => {
    expect(wantsSlideBackgrounds(inst('foco comercial', {}, ['carrossel com fotos de fundo']))).toBe(true)
  })
})

describe('applyBackgrounds', () => {
  const content = (): CarouselContent => ({
    cover: { title: 'c', subtitle: '' },
    slides: [{ title: 'a', body: '' }, { title: 'b', body: '' }, { title: 'c', body: '' }, { title: 'd', body: '' }],
    cta: { title: 'f', body: '' },
    hashtags: [],
  })
  it('capa e fechamento usam a 1ª; o conteúdo reveza as demais', () => {
    const out = applyBackgrounds(content(), ['u1', 'u2', 'u3'])
    expect(out.cover.background_url).toBe('u1')
    expect(out.cta.background_url).toBe('u1')
    expect(out.slides.map((s) => s.background_url)).toEqual(['u2', 'u3', 'u2', 'u3'])
  })
  it('uma só imagem vale para todos; sem imagens, não muda nada; fundo escolhido pelo dono é respeitado', () => {
    expect(applyBackgrounds(content(), ['u1']).slides.every((s) => s.background_url === 'u1')).toBe(true)
    expect(applyBackgrounds(content(), [])).toEqual(content())
    const c = content()
    c.slides[0]!.background_url = 'https://meu/fundo.png'
    expect(applyBackgrounds(c, ['u1', 'u2']).slides[0]!.background_url).toBe('https://meu/fundo.png')
  })
})

describe('prompt do fundo gerado', () => {
  it('proíbe texto, logo, pessoas e rostos', () => {
    const p = backdropPrompt('a bright office lobby')
    for (const w of ['No text', 'no logos', 'no people', 'no faces']) expect(p).toContain(w)
  })
})

describe('createCarouselPostDraft com fundos', () => {
  beforeEach(() => vi.resetModules())

  async function run(opts: { wants: boolean; library: { kind: string; file_url: string; title: string; usage_instructions?: string }[] }) {
    const generateImage = vi.fn(async () => ({ base64Image: 'aW1n' }))
    const upload = vi.fn(async () => `https://cdn/bg-${Math.random().toString(36).slice(2, 6)}.png`)
    const renderSlides = vi.fn(async (specs: unknown[]) => specs.map(() => Buffer.from('png')))
    const content = {
      cover: { title: 'Capa', subtitle: '' },
      slides: [{ title: 'a', body: '' }, { title: 'b', body: '' }, { title: 'c', body: '' }],
      cta: { title: 'Fale', body: '' },
      hashtags: [],
    }
    vi.doMock('@/lib/openai', () => ({ generateImage, generateStructuredReply: vi.fn(async () => ({ scenes: ['uma cena', 'outra cena', 'terceira cena'] })), getOpenAIApiKey: () => 'k' }))
    vi.doMock('@/lib/attachments', () => ({ fetchActiveAttachments: async () => opts.library, buildAttachmentsContext: () => '' }))
    vi.doMock('../generator', () => ({ generateCarouselContent: vi.fn(async () => ({ content, caption: 'legenda', reasoning: 'r' })), uploadGeneratedImage: upload }))
    vi.doMock('../carousel-render', async (orig) => ({ ...(await orig<typeof CarouselRender>()), renderSlides }))
    const mod = await import('../carousel-post')
    const instruction = opts.wants ? inst('carrossel sempre com imagens de fundo', { formats: ['carrossel'] }) : null
    const draft = await mod.createCarouselPostDraft({
      supabase: {} as never, apiKey: 'k', config: { business_profile: {} } as never, unit: { id: 'u1', org_id: 'o1', name: 'Mawi' } as never,
      organizationProfile: null, platform: 'instagram', pillar: null, instruction: instruction as never,
    })
    return { draft, generateImage, renderSlides }
  }

  it('sem fotos na biblioteca: gera 3 fundos por IA em qualidade baixa e aplica em todos os slides', async () => {
    const { draft, generateImage, renderSlides } = await run({ wants: true, library: [{ kind: 'image', title: 'LOGO', file_url: 'https://x/logo.png', usage_instructions: 'identidade visual' }] })
    expect(generateImage).toHaveBeenCalledTimes(3)
    expect(generateImage.mock.calls.every((c) => (c as unknown as [{ quality: string }])[0].quality === 'low')).toBe(true)
    expect(draft.fields.carousel.backgrounds).toBe('ai')
    const specs = renderSlides.mock.calls[0]![0] as { background_url: string | null }[]
    expect(specs.every((s) => s.background_url)).toBe(true)
  })

  it('com fotos reais na biblioteca (fora a logo): usa as fotos e NÃO gera imagem', async () => {
    const { draft, generateImage } = await run({ wants: true, library: [{ kind: 'image', title: 'LOGO', file_url: 'https://x/logo.png' }, { kind: 'image', title: 'Obra concluída', file_url: 'https://x/obra.jpg' }] })
    expect(generateImage).not.toHaveBeenCalled()
    expect(draft.fields.carousel.backgrounds).toBe('library')
    expect(draft.fields.carousel.cover.background_url).toBe('https://x/obra.jpg')
  })

  it('sem pedir fundos: nenhuma imagem, nenhum fundo (comportamento de antes)', async () => {
    const { draft, generateImage } = await run({ wants: false, library: [] })
    expect(generateImage).not.toHaveBeenCalled()
    expect(draft.fields.carousel.backgrounds).toBeUndefined()
    expect(draft.fields.carousel.cover.background_url).toBeUndefined()
  })
})
