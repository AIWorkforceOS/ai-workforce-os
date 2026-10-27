import { describe, expect, it } from 'vitest'
import { buildCaptionSystemPrompt } from '../generator'
import type { AgentConfig, Unit } from '@/lib/types'
import type { ContentInstruction } from '../instructions'

const unit = { id: 'u', name: 'Mawi', default_conversation_language: 'en' } as Unit
const config = { persona_name: 'Bia', business_profile: {} } as unknown as AgentConfig
const params = { config, unit, organizationProfile: null, platform: 'instagram' as const, pillar: 'dicas', visualAngle: 'foto real' }
const instruction = {
  objective: 'Captar clientes comerciais',
  original_text: 'foco comercial',
  starts_on: '2026-11-01',
  ends_on: '2026-11-16',
  interpretation: { objective: 'Captar clientes comerciais', formats: [], avoid_formats: [], audience: null, cta: null, restrictions: [], summary: '' },
} as unknown as ContentInstruction

describe('prompt do gerador com instrução', () => {
  it('sem instrução, o prompt não menciona instrução operacional', () => {
    expect(buildCaptionSystemPrompt(params)).not.toContain('INSTRUÇÃO OPERACIONAL')
  })
  it('com instrução, entra o bloco e o pedido de prova (formato e CTA)', () => {
    const prompt = buildCaptionSystemPrompt({ ...params, instruction })
    expect(prompt).toContain('INSTRUÇÃO OPERACIONAL ATIVA')
    expect(prompt).toContain('instruction_cta')
  })
})
