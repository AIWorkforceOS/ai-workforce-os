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

  it('regressão (2026-08-28, conta AlizoAi): posts recentes vêm com mais texto da legenda (não só a 1ª frase) e a regra de não-repetição é explícita sobre ARGUMENTO, não só rótulo de pilar — achado real: 3 posts seguidos com pilares diferentes repetiram a mesma lógica reescrita com sinônimos', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'instagram',
      pillar: null,
      recentPosts: [{ pillar: 'dor', caption: 'a'.repeat(200), imagePrompt: null }],
    })
    expect(prompt).toContain('REGRA DURA')
    expect(prompt).toContain('não só usar palavras diferentes pra dizer a mesma coisa')
    // 200 chars de legenda de teste devem aparecer quase inteiros agora (truncamento subiu de 100 pra 220)
    expect(prompt).toContain('a'.repeat(200))
  })

  it('regressão (2026-08-28, conta AlizoAi): instrui variedade visual concreta, não só "não repita" — achado real: negócio sem produto físico caía sempre no mesmo clichê (escritório com telas)', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).toContain('VARIEDADE VISUAL DE VERDADE')
    expect(prompt).toContain('ilustração/composição gráfica abstrata')
    expect(prompt).toContain('Nunca use o MESMO formato do post imediatamente anterior')
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

  it('instrui a agir como gestor de conteúdo de verdade, não postar por postar (pedido do Vinicius, 2026-08-23)', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).toContain('gestor de conteúdo de verdade')
    expect(prompt).toContain('gerar resultado de negócio de verdade')
  })

  it('sem posts recentes, não inclui a seção de contexto (nada pra evitar repetir ainda)', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).not.toContain('POSTS RECENTES DESTA CONTA')
  })

  it('com posts recentes, lista pilar + legenda + cena de cada um e instrui a não repetir', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'instagram',
      pillar: 'dicas',
      recentPosts: [
        { pillar: 'bastidores', caption: 'Nossa equipe em ação hoje cedo, preparando tudo para o dia.', imagePrompt: 'team cleaning an office lobby at sunrise' },
        { pillar: 'dicas', caption: 'Dica rápida: troque o pano de microfibra a cada 200 usos.', imagePrompt: null },
      ],
    })
    expect(prompt).toContain('POSTS RECENTES DESTA CONTA')
    expect(prompt).toContain('REGRA DURA')
    expect(prompt).toContain('[bastidores]')
    expect(prompt).toContain('team cleaning an office lobby at sunrise')
    expect(prompt).toContain('[dicas]')
    expect(prompt).toContain('Dica rápida')
  })

  it('trunca legendas/cenas longas do contexto de posts recentes', () => {
    const longCaption = 'A'.repeat(400)
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'instagram',
      pillar: null,
      recentPosts: [{ pillar: null, caption: longCaption, imagePrompt: null }],
    })
    expect(prompt).not.toContain(longCaption)
    expect(prompt).toContain('…')
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

  it('regressão (2026-08-27): idioma_conteudo no perfil do próprio Gestor de Conteúdo vence até o idioma padrão da unidade — achado real do Vinicius: pediu "todos os posts em inglês" num retreinamento e continuou saindo em português porque não existia onde essa instrução "grudar" como dado estruturado', () => {
    const configWithEnglishContent = { ...config, business_profile: { ...config.business_profile, idioma_conteudo: 'en' } }
    const prompt = buildCaptionSystemPrompt({
      config: configWithEnglishContent,
      unit, // unit sem default_conversation_language explícito (undefined) — sem o campo novo, cairia na detecção por texto (português)
      organizationProfile: null,
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('escreva a legenda inteiramente em inglês')
  })

  it('sem idioma_conteudo definido, comportamento antigo intocado (idioma da unidade/detecção)', () => {
    const prompt = buildCaptionSystemPrompt({
      config, // business_profile sem idioma_conteudo
      unit,
      organizationProfile: { descricao_curta: 'Somos uma padaria de bairro, tradicional, com atendimento familiar.' },
      platform: 'instagram',
      pillar: null,
    })
    expect(prompt).toContain('escreva a legenda inteiramente em português')
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

describe('buildCaptionSystemPrompt — biblioteca de materiais (2026-08-26)', () => {
  it('regressão: inclui o attachmentsContext quando fornecido — Conteúdo/Social era um dos 3 cargos que ainda não liam a biblioteca de materiais, achado real do Vinicius (criativos ruins)', () => {
    const prompt = buildCaptionSystemPrompt({
      config,
      unit,
      organizationProfile: null,
      platform: 'instagram',
      pillar: null,
      attachmentsContext: 'MATERIAIS DISPONÍVEIS PARA ENVIAR: cardápio-padaria.pdf',
    })
    expect(prompt).toContain('MATERIAIS DISPONÍVEIS PARA ENVIAR')
    expect(prompt).toContain('cardápio-padaria.pdf')
  })

  it('sem attachmentsContext, não quebra (comportamento antigo intocado)', () => {
    const prompt = buildCaptionSystemPrompt({ config, unit, organizationProfile: null, platform: 'instagram', pillar: null })
    expect(prompt).not.toContain('MATERIAIS DISPONÍVEIS')
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

  it('se o download do logo falhar, a geração falha inteira em vez de publicar sem a marca (pedido do Vinicius: nenhum post sem logo)', async () => {
    vi.resetModules()
    const baseImage = await tinyPngBase64({ r: 5, g: 5, b: 5 })
    vi.doMock('@/lib/openai', () => ({ generateImage: async () => ({ base64Image: baseImage }) }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    const { generatePostImage } = await import('../generator')
    await expect(
      generatePostImage({ apiKey: 'k', imagePrompt: 'a scene', logoUrl: 'https://example.com/missing.png' }),
    ).rejects.toThrow('Não foi possível baixar o logo da marca')
  })
})
