import { beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzePartnerSupportMedia } from '@/lib/ti/partner-media'

const { generateStructuredReplyFromImage, transcribeAudio } = vi.hoisted(() => ({
  generateStructuredReplyFromImage: vi.fn(),
  transcribeAudio: vi.fn(),
}))

vi.mock('@/lib/openai', () => ({
  getOpenAIApiKey: () => 'test-key',
  generateStructuredReplyFromImage,
  transcribeAudio,
}))

describe('analyzePartnerSupportMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('transforma imagem em evidência textual sem persistir o arquivo', async () => {
    generateStructuredReplyFromImage.mockResolvedValue({
      description: 'Tela de login aberta.',
      visible_text: 'Acesso negado',
      uncertainty: 'Não é possível confirmar a causa.',
    })

    const result = await analyzePartnerSupportMedia([{
      kind: 'image',
      mimeType: 'image/png',
      base64: Buffer.from('imagem').toString('base64'),
      caption: 'Erro ao entrar',
    }])

    expect(result[0]).toContain('Tela de login aberta.')
    expect(result[0]).toContain('Acesso negado')
    expect(generateStructuredReplyFromImage).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-key',
      userText: 'Erro ao entrar',
    }))
  })

  it('transcreve áudio recebido como evidência', async () => {
    transcribeAudio.mockResolvedValue({ text: 'O botão salvar não funciona.', durationSeconds: 4.2 })

    const result = await analyzePartnerSupportMedia([{
      kind: 'audio',
      mimeType: 'audio/ogg',
      base64: Buffer.from('audio').toString('base64'),
    }])

    expect(result).toEqual(['Áudio 1 transcrito (4.2s): O botão salvar não funciona.'])
  })

  it('recusa mídia incompatível com o tipo declarado', async () => {
    await expect(analyzePartnerSupportMedia([{
      kind: 'image',
      mimeType: 'audio/ogg',
      base64: Buffer.from('invalido').toString('base64'),
    }])).rejects.toThrow('Imagem 1 tem formato ou tamanho inválido.')
  })
})
