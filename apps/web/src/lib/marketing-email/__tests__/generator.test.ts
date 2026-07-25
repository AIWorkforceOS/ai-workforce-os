import { describe, expect, it } from 'vitest'
import { buildCampaignSystemPrompt } from '../generator'
import type { Unit } from '@/lib/types'

const unit = { name: 'Unidade Teste' } as Unit

describe('buildCampaignSystemPrompt', () => {
  it('menciona o objetivo quando gerando do zero', () => {
    const prompt = buildCampaignSystemPrompt({
      unit,
      organizationProfile: null,
      objective: 'avisar sobre promoção de inverno',
      source: null,
    })
    expect(prompt).toContain('avisar sobre promoção de inverno')
    expect(prompt).toContain('escrever do zero')
  })

  it('menciona o conteúdo original quando adaptando uma fonte existente', () => {
    const prompt = buildCampaignSystemPrompt({
      unit,
      organizationProfile: null,
      objective: '',
      source: { title: '5 dicas de manutenção', text: 'Conteúdo do blog sobre manutenção preventiva.' },
    })
    expect(prompt).toContain('5 dicas de manutenção')
    expect(prompt).toContain('adaptar o conteúdo')
  })

  it('inclui instrução extra quando objective é passado junto com uma fonte', () => {
    const prompt = buildCampaignSystemPrompt({
      unit,
      organizationProfile: null,
      objective: 'foque no CTA de agendamento',
      source: { title: 'Título', text: 'Texto' },
    })
    expect(prompt).toContain('Instrução extra do responsável pela campanha: "foque no CTA de agendamento"')
  })

  it('inclui a ficha do negócio quando existe organizationProfile', () => {
    const prompt = buildCampaignSystemPrompt({
      unit,
      organizationProfile: { org_company_name: 'Limpeza Rápida' },
      objective: 'reengajar clientes',
      source: null,
    })
    expect(prompt).toContain('Limpeza Rápida')
  })

  it('avisa para nunca inventar promoção/preço, nunca citar concorrentes, e nunca incluir link de descadastro', () => {
    const prompt = buildCampaignSystemPrompt({ unit, organizationProfile: null, objective: 'novidade', source: null })
    expect(prompt).toContain('Nunca invente promoção')
    expect(prompt).toContain('Nunca mencione concorrentes')
    expect(prompt).toContain('NÃO inclua link de descadastro')
  })

  it('pede resposta em JSON com subject, body_text e reasoning', () => {
    const prompt = buildCampaignSystemPrompt({ unit, organizationProfile: null, objective: 'novidade', source: null })
    expect(prompt).toContain('"subject"')
    expect(prompt).toContain('"body_text"')
    expect(prompt).toContain('"reasoning"')
  })
})
