import { describe, expect, it } from 'vitest'
import { detectBusinessLanguage, detectLanguageFromText, extractProseText } from '../language'

describe('detectLanguageFromText', () => {
  it('detecta português num texto claramente em português', () => {
    expect(detectLanguageFromText('Somos uma empresa de limpeza residencial e comercial, com atendimento personalizado.')).toBe('pt')
  })

  it('detecta inglês num texto claramente em inglês', () => {
    expect(
      detectLanguageFromText('We are a professional cleaning company serving residential and commercial customers with reliable service.'),
    ).toBe('en')
  })

  it('sem sinal nenhum (texto vazio) cai no padrão pt', () => {
    expect(detectLanguageFromText('')).toBe('pt')
  })

  it('texto majoritariamente inglês com uma frase solta em português continua detectando inglês (o bug real da Mawi)', () => {
    const text = [
      'Empresa profissional de limpeza residencial e comercial no Arizona, oferecendo serviços de limpeza recorrente e avulsa.',
      'The main objective is to generate customers, not simply content. Every post, caption, response, and campaign should help build trust.',
      'Mawi operates both residential and commercial cleaning, with residential services such as weekly, biweekly, and monthly cleaning.',
      'Prioritize real Mawi work. Whenever real photos, videos, testimonials, or before-and-after results are available, use them.',
      'Residential is the social-media priority. Use roughly a 70% residential / 30% commercial content balance.',
      'English should be the primary social-media language, while Mawi can communicate with leads in English, Portuguese, or Spanish.',
      'Keep the brand professional but human. We want Mawi to look like a reliable, established local company.',
    ].join(' ')
    expect(detectLanguageFromText(text)).toBe('en')
  })
})

describe('extractProseText', () => {
  it('junta strings longas de vários campos, ignorando valores curtos/enum', () => {
    const profile = {
      org_vertical_key: 'cleaning_services',
      descricao_curta: 'Empresa profissional de limpeza residencial e comercial no Arizona.',
      observacoes: ['Think locally. Content should be designed primarily to attract customers in the Phoenix metro area.'],
    }
    const text = extractProseText([profile])
    expect(text).toContain('limpeza residencial')
    expect(text).toContain('Phoenix metro area')
    expect(text).not.toContain('cleaning_services')
  })

  it('ignora perfis nulos sem quebrar', () => {
    expect(extractProseText([null, undefined])).toBe('')
  })

  it('entra em arrays e objetos aninhados', () => {
    const profile = { proibicoes: ['Do not criticize, compare with, or mention competitors negatively.'] }
    expect(extractProseText([profile])).toContain('mention competitors')
  })
})

describe('detectBusinessLanguage', () => {
  it('combina múltiplos perfis (org + agente) antes de detectar', () => {
    const orgProfile = { descricao_curta: 'We serve customers across the Phoenix metro area with reliable cleaning services.' }
    const agentProfile = { pilares_conteudo: ['Resultados e transformações'] }
    expect(detectBusinessLanguage([orgProfile, agentProfile])).toBe('en')
  })
})
