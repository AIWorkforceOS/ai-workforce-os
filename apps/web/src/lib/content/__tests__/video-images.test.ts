import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySceneImages, sanitizeVisual, scenePrompt, visualsFor } from '../video-images'
import type { VideoContent } from '../video'

const content = (visuals: (string | undefined)[] = []): VideoContent => ({
  script: '',
  scenes: [0, 1, 2].map((i) => ({ headline: `H${i}`, text: '', seconds: 5, transition: 'fade' as const, visual: visuals[i] })),
  cta: { headline: 'Fale', text: '', seconds: 4, visual: visuals[3] },
  hashtags: [],
})

describe('visualsFor / scenePrompt', () => {
  it('usa a descrição do roteiro e completa com cenas de reserva (cenas… + fechamento)', () => {
    const v = visualsFor(content(['Two technicians inspecting an electrical panel in a lobby']))
    expect(v).toHaveLength(4)
    expect(v[0]).toContain('electrical panel')
    expect(v[1]!.length).toBeGreaterThan(20) // reserva
    expect(new Set(v).size).toBe(4) // reservas variadas
  })
  it('o prompt final proíbe texto, logo e marca-d’água e pede composição vertical com espaço para o texto', () => {
    const p = scenePrompt('A crew cleaning an office. ')
    for (const w of ['No text', 'no logos', 'no watermarks', 'vertical', 'empty space']) expect(p).toContain(w)
    expect(p.startsWith('A crew cleaning an office.')).toBe(true)
  })
})

describe('sanitizeVisual (o gerador de imagem desenha logos falsos)', () => {
  it('remove logo, texto, placas, marca e o nome da empresa, mantendo a cena', () => {
    const v = sanitizeVisual("Mawi technicians in navy uniforms inspecting an HVAC unit on a roof, with Mawi branding visible, a banner reading 'Mawi Cleaning'")
    expect(v).toMatch(/technicians in navy uniforms inspecting an HVAC unit on a roof/)
    expect(v).not.toMatch(/mawi|brand|banner|reading/i)
  })
  it('descrição que era só logo/texto vira a cena de reserva', () => {
    const out = visualsFor({ scenes: [{ headline: 'a', text: '', seconds: 4, transition: 'fade' }], cta: { headline: 'Fale', text: '', seconds: 4, visual: "A Mawi logo on a clean background, with the text 'Contact us' displayed prominently." } })
    expect(out[1]).not.toMatch(/logo|text|mawi/i)
    expect(out[1]!.length).toBeGreaterThan(20)
  })
})

describe('applySceneImages', () => {
  it('aplica as URLs nas cenas e no fechamento sem sobrescrever fundo que o dono escolheu', () => {
    const c = content()
    c.scenes[1]!.background_url = 'https://meu/fundo.jpg'
    const out = applySceneImages(c, ['u0', 'u1', 'u2', 'u3'])
    expect(out.scenes.map((s) => s.background_url)).toEqual(['u0', 'https://meu/fundo.jpg', 'u2'])
    expect(out.cta.background_url).toBe('u3')
  })
  it('imagem que falhou (null) deixa a cena sem fundo, para sair com a cor da marca', () => {
    const out = applySceneImages(content(), ['u0', null, 'u2', 'u3'])
    expect(out.scenes[1]!.background_url).toBeNull()
  })
})

describe('generateSceneImageUrls', () => {
  beforeEach(() => vi.resetModules())
  async function run(failOn: number[]) {
    vi.resetModules()
    let call = 0
    const generateImage = vi.fn(async () => {
      const mine = call++
      if (failOn.includes(mine)) throw new Error('OpenAI indisponível')
      return { base64Image: 'aW1n' }
    })
    vi.doMock('@/lib/openai', () => ({ generateImage }))
    vi.doMock('../generator', () => ({ uploadGeneratedImage: vi.fn(async () => 'https://cdn/x.png') }))
    const mod = await import('../video-images')
    const p = mod.generateSceneImageUrls({ supabase: {} as never, apiKey: 'k', unitId: 'u1', visuals: ['a', 'b', 'c', 'd'] })
    return { p, generateImage }
  }
  it('gera uma imagem por cena em qualidade média, vertical', async () => {
    const { p, generateImage } = await run([])
    expect((await p).every(Boolean)).toBe(true)
    expect(generateImage).toHaveBeenCalledTimes(4)
    expect(generateImage.mock.calls.every((c) => (c as unknown as [{ size: string; quality: string }])[0].quality === 'medium' && (c as unknown as [{ size: string }])[0].size === '1024x1536')).toBe(true)
  })
  it('uma falha vira null (cena sem imagem); mais da metade falhando derruba o vídeo com erro claro', async () => {
    expect((await (await run([1])).p).filter((x) => x === null)).toHaveLength(1)
    await expect((await run([0, 1, 2])).p).rejects.toThrow(/Não foi possível gerar as imagens/)
  })
})
