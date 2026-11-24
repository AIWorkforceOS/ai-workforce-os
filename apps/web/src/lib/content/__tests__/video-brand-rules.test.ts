import { describe, expect, it } from 'vitest'
import { buildProfessionalVideoPrompt } from '../video-post'

describe('regras obrigatórias de identidade dos vídeos', () => {
  it('inclui paleta, estilo, proibição de logo inventada e diferenciação do histórico', () => {
    const prompt = buildProfessionalVideoPrompt({
      brandName: 'Mawi Cleaning',
      primary: '#123456',
      secondary: '#abcdef',
      visualStyle: 'clean and premium',
      sceneStory: 'Cena 1: equipe trabalhando.',
      closingMood: 'confiança',
      recentPosts: [{ pillar: 'prova', caption: 'Vídeo anterior sobre limpeza de cozinha', imagePrompt: null }],
    })
    expect(prompt).toContain('#123456')
    expect(prompt).toContain('#abcdef')
    expect(prompt).toContain('clean and premium')
    expect(prompt).toContain('Vídeo anterior sobre limpeza de cozinha')
    expect(prompt).toContain('different opening shot')
    expect(prompt).toContain('no generated logos')
  })
})
