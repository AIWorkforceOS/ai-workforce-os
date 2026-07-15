import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateChatReply } from '@/lib/openai'
import { runInterviewTurn } from '@/lib/interview/engine'
import { buildSystemPrompt } from '@/lib/conversation-engine'
import type { AgentConfig, InterviewTranscriptEntry, Unit } from '@/lib/types'

// Entrevista simulada DE VERDADE contra a OpenAI: um "dono de clínica"
// (também um LLM, com fatos fixos) responde às perguntas do SDR digital.
// Valida ponta a ponta: condução adaptativa, a regra da pergunta final
// ("tem mais alguma coisa?" — inclusive o loop quando a resposta traz
// informação nova), a extração do business_profile e o consumo dele no
// buildSystemPrompt do atendimento real.
//
// Não roda no `pnpm test` normal (custa chamadas de API): habilite com
//   RUN_LIVE_INTERVIEW=1 pnpm vitest run src/lib/__tests__/interview-live.e2e.test.ts

function loadOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  // .env.local pode estar em apps/web/ ou na raiz do monorepo
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

const apiKey = process.env.RUN_LIVE_INTERVIEW === '1' ? loadOpenAIKey() : null

const OWNER_PERSONA = [
  'Você é Marcos, dono da clínica OdontoPrime, respondendo à entrevista de contratação do seu novo vendedor digital (SDR). Responda em 1 a 3 frases, natural, só o que for perguntado.',
  'Fatos da sua empresa (não invente além disto):',
  '- Vende 3 serviços: limpeza dental por R$ 200, clareamento por R$ 800 e implante por R$ 3.500.',
  '- Desconto máximo pra fechar: 10%.',
  '- Atende consumidor final (B2C) e também empresas parceiras (B2B) — os dois.',
  '- Prospecção B2B: academias e empresas de plano odontológico na região de Campinas e Valinhos.',
  '- O SDR deve apenas qualificar o interessado e passar para um atendente humano fechar.',
].join('\n')

describe.runIf(!!apiKey)('entrevista simulada real (OpenAI)', () => {
  it(
    'SDR conduz a entrevista, encerra só depois da pergunta final e o perfil alimenta o prompt real',
    async () => {
      const unit = {
        id: 'unit-live',
        name: 'OdontoPrime Campinas',
        region_city: 'Campinas',
      } as Unit

      let config = {
        id: 'cfg-live',
        unit_id: 'unit-live',
        agent_type: 'sdr',
        persona_name: 'Kai',
        persona_tone: 'friendly',
        daily_limit: 15,
        active_hours: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] },
        escalation_rules: { after_messages: 5, keywords: [] },
        sectors: [],
        is_active: false,
        business_profile: {},
        interview_transcript: [] as InterviewTranscriptEntry[],
        created_at: '',
        updated_at: '',
      } as AgentConfig

      // Abertura: o funcionário se apresenta e faz as primeiras perguntas
      let turn = await runInterviewTurn({ apiKey: apiKey!, config, unit, userMessage: null })
      config = { ...config, business_profile: turn.profile, interview_transcript: turn.transcript }

      let finalQuestionCount = 0
      let done = false

      for (let i = 0; i < 18 && !done; i++) {
        const lastAssistant = [...(config.interview_transcript ?? [])]
          .reverse()
          .find((m) => m.role === 'assistant')

        let ownerReply: string
        if (lastAssistant?.asked_final) {
          finalQuestionCount += 1
          // 1ª pergunta final: o dono ainda lembra de algo (testa o loop);
          // da 2ª em diante, não tem mais nada — a entrevista deve encerrar.
          ownerReply =
            finalQuestionCount === 1
              ? 'Ah, sim! Importante: nunca agende avaliação para sábados e domingos, a clínica não abre.'
              : 'Não, agora é só isso. Pode começar!'
        } else {
          ownerReply = await generateChatReply({
            apiKey: apiKey!,
            systemPrompt: OWNER_PERSONA,
            // Pro "dono", as mensagens do entrevistador são o interlocutor (user)
            history: (config.interview_transcript ?? []).slice(-16).map(({ role, content }) => ({
              role: role === 'assistant' ? ('user' as const) : ('assistant' as const),
              content,
            })),
          })
        }

        turn = await runInterviewTurn({ apiKey: apiKey!, config, unit, userMessage: ownerReply })
        config = { ...config, business_profile: turn.profile, interview_transcript: turn.transcript }
        done = turn.done
      }

      // Log da entrevista completa, pra inspeção manual
      for (const entry of config.interview_transcript ?? []) {
        console.log(`${entry.role === 'assistant' ? '🤖' : '👤'}${entry.asked_final ? ' [pergunta final]' : ''} ${entry.content}`)
      }
      console.log('📋 business_profile:', JSON.stringify(config.business_profile, null, 2))

      // 1. Encerrou dentro do limite de turnos, e SÓ depois da pergunta final respondida
      expect(done).toBe(true)
      expect(finalQuestionCount).toBeGreaterThanOrEqual(2) // refez a pergunta final após info nova

      const profile = config.business_profile as Record<string, unknown>
      const profileJson = JSON.stringify(profile)

      // 2. Aprendeu os 3 produtos com os preços (condução adaptativa)
      const produtos = profile.produtos as { nome: string; preco: string }[]
      expect(Array.isArray(produtos)).toBe(true)
      expect(produtos.length).toBeGreaterThanOrEqual(3)
      expect(profileJson).toMatch(/200/)
      expect(profileJson).toMatch(/800/)
      expect(profileJson).toMatch(/3\.?500/)

      // 3. Cobriu desconto, B2B/B2C, prospecção e política de fechamento
      expect(profileJson).toMatch(/10/)
      expect(profile.tipo_cliente).toBe('ambos')
      expect(profileJson.toLowerCase()).toMatch(/campinas/)
      expect(profile.fechamento).toBe('qualifica_e_passa_para_humano')

      // 4. A instrução extra dada na pergunta final foi registrada
      expect(profileJson.toLowerCase()).toMatch(/sábado|domingo|fim de semana|finais de semana/)

      // 5. O perfil alimenta o prompt do atendimento real
      const systemPrompt = buildSystemPrompt(config, unit)
      expect(systemPrompt).toContain('FICHA DA EMPRESA')
      expect(systemPrompt).toMatch(/3\.?500/)
      expect(systemPrompt).toContain('agendar uma conversa com um vendedor humano')
    },
    300_000,
  )
})

describe.runIf(!apiKey)('entrevista simulada real (OpenAI)', () => {
  it.skip('pulado — rode com RUN_LIVE_INTERVIEW=1 e OPENAI_API_KEY disponível', () => {})
})
