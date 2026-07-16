import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateChatReply } from '@/lib/openai'
import { buildSystemPrompt } from '@/lib/conversation-engine'
import { runInterviewTurn } from '@/lib/interview/engine'
import type { AgentConfig, Unit } from '@/lib/types'

// Idioma padrão por unidade + troca dinâmica DE VERDADE contra a OpenAI
// (pedido do produto: unidades fora do Brasil, ex. Mawi Services nos EUA,
// devem ser atendidas em inglês por padrão, mudando para outro idioma só
// se o lead pedir ou passar a escrever nele — sem anunciar a troca).
//
// Não roda no `pnpm test` normal (custa chamadas de API): habilite com
//   RUN_LIVE_LANGUAGE=1 pnpm vitest run src/lib/__tests__/language-live.e2e.test.ts

function loadOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  for (const rel of ['../../../.env.local', '../../../../../.env.local']) {
    try {
      const env = readFileSync(path.resolve(__dirname, rel), 'utf8')
      const match = env.match(/^OPENAI_API_KEY=(.+)$/m)
      const key = match?.[1]?.trim().replace(/^["']|["']$/g, '')
      if (key) return key
    } catch {
      // tenta o próximo caminho
    }
  }
  return null
}

const apiKey = process.env.RUN_LIVE_LANGUAGE === '1' ? loadOpenAIKey() : null

// Acentuação típica do português — praticamente nunca aparece numa
// resposta em inglês de algumas frases, então serve de sinal leve mas
// confiável do idioma real da resposta.
const PT_DIACRITICS = /[ãõçáéíóúâêô]/i
const ANNOUNCES_SWITCH = /switching to|mudando (o idioma|para)|vou mudar (o idioma|para)/i

describe.runIf(!!apiKey)('idioma padrão por unidade (OpenAI real)', () => {
  const usUnit = {
    id: 'unit-us',
    name: 'Mawi Services',
    region_city: 'Miami',
    default_conversation_language: 'en',
  } as Unit

  it('Sales Rep de unidade dos EUA responde em inglês por padrão e troca para português quando o lead escreve nele', async () => {
    const config = {
      id: 'cfg-us',
      unit_id: 'unit-us',
      agent_type: 'sdr',
      persona_name: 'Alex',
      persona_tone: 'friendly',
      daily_limit: 50,
      active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
      escalation_rules: { after_messages: 999, keywords: [] },
      sectors: [],
      is_active: true,
      business_profile: {
        sobre_a_empresa: 'Commercial cleaning company based in Miami, Florida.',
        produtos: [
          { nome: 'Standard office cleaning', preco: '$300/month', detalhes: 'Weekly cleaning for small offices' },
        ],
        fechamento: 'qualifica_e_passa_para_humano',
      },
      interview_status: 'completed',
      interview_transcript: [],
      created_at: '',
      updated_at: '',
    } as AgentConfig

    const systemPrompt = buildSystemPrompt(config, usUnit)

    const firstReply = await generateChatReply({
      apiKey: apiKey!,
      systemPrompt,
      history: [{ role: 'user', content: 'Hi, how much does your cleaning service cost?' }],
    })
    expect(firstReply).not.toMatch(PT_DIACRITICS)

    const secondReply = await generateChatReply({
      apiKey: apiKey!,
      systemPrompt,
      history: [
        { role: 'user', content: 'Hi, how much does your cleaning service cost?' },
        { role: 'assistant', content: firstReply },
        {
          role: 'user',
          content: 'Oi, na verdade eu prefiro falar em português. Vocês atendem empresas pequenas também?',
        },
      ],
    })
    expect(secondReply).toMatch(PT_DIACRITICS)
    expect(secondReply).not.toMatch(ANNOUNCES_SWITCH)
  }, 60_000)

  it('a entrevista de contratação de uma unidade dos EUA começa em inglês', async () => {
    const config = {
      id: 'cfg-us-interview',
      unit_id: 'unit-us',
      agent_type: 'sdr',
      persona_name: 'Alex',
      persona_tone: 'friendly',
      daily_limit: 50,
      active_hours: { start: '00:00', end: '23:59', days: [0, 1, 2, 3, 4, 5, 6] },
      escalation_rules: { after_messages: 999, keywords: [] },
      sectors: [],
      is_active: false,
      business_profile: {},
      interview_transcript: [],
      created_at: '',
      updated_at: '',
    } as AgentConfig

    const turn = await runInterviewTurn({ apiKey: apiKey!, config, unit: usUnit, userMessage: null })
    expect(turn.reply).not.toMatch(PT_DIACRITICS)
  }, 60_000)
})

describe.runIf(!apiKey)('idioma padrão por unidade (OpenAI real)', () => {
  it.skip('pulado — rode com RUN_LIVE_LANGUAGE=1 e OPENAI_API_KEY disponível', () => {})
})
