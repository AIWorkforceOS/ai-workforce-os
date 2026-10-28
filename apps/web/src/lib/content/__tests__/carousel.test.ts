import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import {
  buildSlideSpecs,
  carouselPublishingEnabled,
  composeCaption,
  moveSlide,
  normalizeCarousel,
  normalizeCarouselEdit,
  pickPostFormat,
  type CarouselContent,
} from '../carousel'
import { brandFrom, contrastRatio, fetchImageDataUrl, readableOn, renderSlide, renderSlides, SLIDE_HEIGHT, SLIDE_WIDTH } from '../carousel-render'

const raw = {
  cover_title: 'Limpeza comercial sem parar a operação',
  cover_subtitle: 'Guia para gestores de Facilities',
  slides: [
    { title: 'Rotina planejada', body: 'Limpeza em horários que não atrapalham.' },
    { title: 'Um só responsável', body: 'Ordens e relatórios num só lugar.' },
    { title: 'Resposta rápida', body: 'Chamados viram ordens com prazo.' },
  ],
  cta_title: 'Peça uma proposta',
  cta_body: 'Fale com a MAWI.',
  hashtags: ['Facilities', '#limpeza', 'limpeza', 'ma wi!'],
}

const content = (): CarouselContent => {
  const n = normalizeCarousel(raw)
  if (!n.ok) throw new Error(n.error)
  return n.value
}

describe('normalizeCarousel (o que a IA devolve)', () => {
  it('aceita um carrossel completo e limpa hashtags (sem duplicar nem símbolos)', () => {
    const c = content()
    expect(c.slides).toHaveLength(3)
    expect(c.hashtags).toEqual(['#Facilities', '#limpeza', '#mawi'])
  })
  it('recusa sem capa, sem CTA ou com poucos slides', () => {
    expect(normalizeCarousel({ ...raw, cover_title: '' }).ok).toBe(false)
    expect(normalizeCarousel({ ...raw, cta_title: ' ' }).ok).toBe(false)
    expect(normalizeCarousel({ ...raw, slides: raw.slides.slice(0, 2) }).ok).toBe(false)
    expect(normalizeCarousel(null).ok).toBe(false)
  })
  it('corta no máximo de slides e no tamanho dos textos', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `T${i}`, body: 'x'.repeat(500) }))
    const r = normalizeCarousel({ ...raw, slides: many })
    expect(r.ok && r.value.slides).toHaveLength(8)
    expect(r.ok && r.value.slides[0]!.body.length).toBe(220)
  })
})

describe('normalizeCarouselEdit (o que o navegador manda)', () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    cover: { title: 'Capa', subtitle: '' },
    slides: [{ title: 'a', body: '' }, { title: 'b', body: '' }, { title: 'c', body: '' }],
    cta: { title: 'Fale conosco', body: '' },
    hashtags: [],
    ...over,
  })
  it('aceita e só mantém fundo https', () => {
    const r = normalizeCarouselEdit(edit({ slides: [{ title: 'a', background_url: 'javascript:alert(1)' }, { title: 'b', background_url: 'https://x.co/i.png' }, { title: 'c' }] }))
    expect(r.ok && r.value.slides.map((s) => s.background_url)).toEqual([null, 'https://x.co/i.png', null])
  })
  it('exige capa, CTA e 3 a 8 slides', () => {
    expect(normalizeCarouselEdit(edit({ cover: { title: '' } })).ok).toBe(false)
    expect(normalizeCarouselEdit(edit({ cta: { title: '' } })).ok).toBe(false)
    expect(normalizeCarouselEdit(edit({ slides: [{ title: 'a' }] })).ok).toBe(false)
    expect(normalizeCarouselEdit(edit({ slides: Array.from({ length: 9 }, () => ({ title: 't' })) })).ok).toBe(false)
  })
})

describe('slides e edição', () => {
  it('ordem final: capa, conteúdo, fechamento, com numeração', () => {
    const specs = buildSlideSpecs(content())
    expect(specs.map((s) => s.kind)).toEqual(['cover', 'content', 'content', 'content', 'cta'])
    expect(specs.map((s) => `${s.index}/${s.total}`)).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5'])
  })
  it('moveSlide reordena sem mutar e ignora índices inválidos', () => {
    const list = ['a', 'b', 'c']
    expect(moveSlide(list, 0, 2)).toEqual(['b', 'c', 'a'])
    expect(list).toEqual(['a', 'b', 'c'])
    expect(moveSlide(list, 0, 5)).toBe(list)
  })
  it('legenda: hashtags no fim, sem repetir as que o texto já tem, e no limite do Instagram', () => {
    expect(composeCaption('Texto #limpeza', ['#limpeza', '#facilities'])).toBe('Texto #limpeza\n\n#facilities')
    expect(composeCaption('x'.repeat(3000), ['#a']).length).toBeLessThanOrEqual(2200)
  })
})

describe('pickPostFormat', () => {
  const inst = (formats: string[], avoid: string[] = []) => ({ interpretation: { formats, avoid_formats: avoid } }) as never
  it('sem instrução ou sem pedir carrossel: imagem única, como sempre foi', () => {
    expect(pickPostFormat(null, [])).toBe('image')
    expect(pickPostFormat(inst([]), [])).toBe('image')
    expect(pickPostFormat(inst(['vídeo curto']), [], { allowVideo: false })).toBe('image')
  })
  it('pedindo só carrossel: sempre carrossel; pedindo carrossel e imagem: alterna', () => {
    expect(pickPostFormat(inst(['carrossel']), ['carousel'])).toBe('carousel')
    expect(pickPostFormat(inst(['carrossel', 'imagem única']), [])).toBe('carousel')
    expect(pickPostFormat(inst(['carrossel', 'imagem única']), ['carousel'])).toBe('image')
  })
  it('carrossel proibido na instrução: imagem', () => {
    expect(pickPostFormat(inst(['carrossel'], ['carrossel']), [])).toBe('image')
  })
})

describe('trava de publicação', () => {
  it('desligada por padrão; só "on" liga', () => {
    expect(carouselPublishingEnabled({})).toBe(false)
    expect(carouselPublishingEnabled({ CONTENT_CAROUSEL_PUBLISH: 'true' })).toBe(false)
    expect(carouselPublishingEnabled({ CONTENT_CAROUSEL_PUBLISH: 'ON' })).toBe(true)
  })
})

describe('contraste do texto', () => {
  it('escolhe a cor com mais contraste', () => {
    expect(readableOn('#0A1224')).toBe('#FFFFFF')
    expect(readableOn('#FFFFFF')).toBe('#0B1220')
    expect(readableOn('#06B6D4')).toBe('#0B1220') // ciano: texto branco não passa de ~2:1
    expect(contrastRatio('#0A1224', readableOn('#0A1224'))).toBeGreaterThan(7)
  })
})

describe('desenho dos slides (PNG de verdade)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('gera PNG 1080×1350 para cada slide, com texto acentuado', async () => {
    const pngs = await renderSlides(buildSlideSpecs(content()), brandFrom({ name: 'MAWI' }))
    expect(pngs).toHaveLength(5)
    for (const png of pngs) {
      const meta = await sharp(png).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['png', SLIDE_WIDTH, SLIDE_HEIGHT])
    }
    // slides diferentes de fato (não é tudo a mesma imagem em branco)
    expect(pngs[0]!.equals(pngs[1]!)).toBe(false)
  })
  it('com logo e foto de fundo (data URL) também desenha', async () => {
    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#cc3333' } }).png().toBuffer()
    const dataUrl = `data:image/png;base64,${tiny.toString('base64')}`
    const spec = buildSlideSpecs(content())[1]!
    const png = await renderSlide(spec, brandFrom({ name: 'MAWI', logo: { dataUrl, width: 40, height: 40, darkOnTransparent: true }, lang: 'en' }), dataUrl)
    expect((await sharp(png).metadata()).width).toBe(SLIDE_WIDTH)
  })
  it('fetchImageDataUrl recusa o que não é imagem ou não baixa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(4) })))
    await expect(fetchImageDataUrl('https://x/a', 'a imagem')).rejects.toThrow(/não é uma imagem/)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, headers: new Headers() })))
    await expect(fetchImageDataUrl('https://x/a', 'a imagem')).rejects.toThrow(/status 404/)
  })
})
