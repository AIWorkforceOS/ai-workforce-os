import { afterEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { buildCaptionSystemPrompt } from '../generator'
import type { AgentConfig, Unit } from '@/lib/types'

const unit = { name: 'Unidade Teste', region_city: 'Campinas' } as Unit
const config = {
  id: 'cfg-1',
  unit_id: 'unit-1',
  agent_type: 'content_specialist',
  persona_name: 'Bia',
  persona_tone: 'friendly',
  daily_limit: 15,
  active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
  escalation_rules: { after_messages: 5, keywords: [] },
  sectors: [],
  is_active: true,
  business_profile: { pilares_conteudo: ['bastidores', 'dicas'] },
  created_at: '',
  updated_at: '',
} as AgentConfig

describe('buildCaptionSystemPrompt', () => {
  it('menciona a plataforma certa e o pilar de conteúdo escolhido', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'instagram',
      pillar: 'bastidores',
    })
    expect(prompt).toContain('Instagram')
    expect(prompt).toContain('bastidores')
  })

  it('usa Facebook quando a plataforma é facebook', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'facebook',
      pillar: null,
    })
    expect(prompt).toContain('Facebook')
    expect(prompt).not.toContain('Instagram')
  })

  it('inclui a ficha do negócio quando existe business_profile', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: { org_company_name: 'Limpeza Rápida' },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('Limpeza Rápida')
  })

  it('avisa para nunca inventar promoção/preço nem citar concorrentes', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).toContain('Nunca invente promoção')
    expect(prompt).toContain('Nunca mencione concorrentes')
  })

  it('pede resposta em JSON com caption, image_prompt e reasoning', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).toContain('"caption"')
    expect(prompt).toContain('"image_prompt"')
    expect(prompt).toContain('"reasoning"')
  })

  it('detecta inglês pelo texto real da ficha e instrui a legenda nesse idioma (achado ao vivo na Mawi Cleaning)', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: {
        descricao_curta: 'Empresa profissional de limpeza no Arizona.',
        observacoes: [
          'The main objective is to generate customers, not simply content. Every post should help build trust with our customers.',
          'English should be the primary social-media language, while Mawi can communicate with leads in English, Portuguese, or Spanish.',
        ],
      },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('escreva a legenda inteiramente em inglês')
  })

  it('idioma explícito da unidade vence a detecção por texto (achado ao vivo: dono descreveu em português negócio que opera em inglês)', () => {
    const englishUnit = { ...unit, default_conversation_language: 'en' } as Unit
    const prompt = buildCaptionSystemPrompt({
      config,
      unit: englishUnit,
      organizationProfile: {
        descricao_curta: 'Empresa profissional de limpeza no Arizona.',
        observacoes: ['Construir autoridade, não apenas engajamento; focar em qualified leads e contratos recorrentes.'],
      },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('escreva a legenda inteiramente em inglês')
  })

  it('detecta português quando a ficha é predominantemente em português', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: { descricao_curta: 'Somos uma empresa de limpeza residencial e comercial com atendimento personalizado e pontual.' },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('escreva a legenda inteiramente em português')
  })

  it('inclui as cores da marca no prompt da imagem quando há brand_kit na ficha da organização', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: { brand_kit: { primary_color: '#1E40AF', secondary_color: '#10B981' } },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('#1E40AF')
    expect(prompt).toContain('#10B981')
  })

  it('não menciona paleta de marca quando não há brand_kit configurado', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).not.toContain('Identidade visual da marca')
  })

  it('inclui a data comemorativa quando o post é planejado pra ela (planejamento semanal)', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null, holiday: 'Natal' })
    expect(prompt).toContain('Data comemorativa: este post vai ao ar em "Natal"')
  })

  it('não menciona data comemorativa quando não há uma pro dia', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).not.toContain('Data comemorativa')
  })
})

describe('generatePostImage — composição do logo', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/openai')
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  async function tinyPngBase64(color: { r: number; g: number; b: number }): Promise<string> {
    const buffer = await sharp({ create: { width: 40, height: 40, channels: 3, background: color } }).png().toBuffer()
    return buffer.toString('base64')
  }

  it('sem logoUrl, devolve a imagem gerada sem tentar buscar nada', async () => {
    vi.resetModules()
    const baseImage = await tinyPngBase64({ r: 10, g: 20, b: 30 })
    vi.doMock('@/lib/openai', () => ({ generateImage: async () => ({ base64Image: baseImage }) }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { generatePostImage } = await import('../generator')
    const result = await generatePostImage({ apiKey: 'k', imagePrompt: 'a scene' })

    expect(result.base64Image).toBe(baseImage)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('com logoUrl, baixa o logo e devolve uma imagem PNG válida e diferente da original (logo colado de verdade)', async () => {
    vi.resetModules()
    const baseImage = await tinyPngBase64({ r: 200, g: 50, b: 50 })
    const logoBuffer = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .png()
      .toBuffer()
    vi.doMock('@/lib/openai', () => ({ generateImage: async () => ({ base64Image: baseImage }) }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => logoBuffer.buffer.slice(logoBuffer.byteOffset, logoBuffer.byteOffset + logoBuffer.byteLength) })))

    const { generatePostImage } = await import('../generator')
    const result = await generatePostImage({ apiKey: 'k', imagePrompt: 'a scene', logoUrl: 'https://example.com/logo.png' })

    expect(result.base64Image).not.toBe(baseImage)
    const metadata = await sharp(Buffer.from(result.base64Image, 'base64')).metadata()
    expect(metadata.width).toBe(40)
    expect(metadata.height).toBe(40)
  })

  it('se o download do logo falhar, devolve a imagem original em vez de derrubar o post inteiro', async () => {
    vi.resetModules()
    const baseImage = await tinyPngBase64({ r: 5, g: 5, b: 5 })
    vi.doMock('@/lib/openai', () => ({ generateImage: async () => ({ base64Image: baseImage }) }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { generatePostImage } = await import('../generator')
    const result = await generatePostImage({ apiKey: 'k', imagePrompt: 'a scene', logoUrl: 'https://example.com/missing.png' })

    expect(result.base64Image).toBe(baseImage)
  })
})
