import { IDENTITY_AND_HANDOFF_RULES } from '@/lib/agent-identity'
import { buildTrainingCorrectionsContext } from '@/lib/agent-training'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { conversationLanguageDirective, unitDefaultLocale } from '@/lib/i18n/config'
import type { AgentConfig, AgentTone, Unit } from '@/lib/types'

// Prompt de sistema do AI Receptionist (Fase 1). Personalidade de
// recepcionista/gerente de operações: organiza o atendimento e o
// cadastro de clientes, resolve rotina sozinho(a) e escala pra um
// humano o que a entrevista de contratação (lib/interview/engine.ts,
// playbook 'receptionist') ensinou que exige decisão humana.
//
// Ainda não está conectado a um canal de conversa real (WhatsApp/SMS/
// e-mail) — essa integração fica para uma fase seguinte, quando os
// módulos operacionais que ela coordena (agenda, atendimento) também
// existirem. Por ora ele existe para: (1) fixar a identidade/persona
// do funcionário e (2) já poder ser usado assim que a Fase 2 plugar
// um canal de conversa nele.

const TONE_LABEL: Record<AgentTone, string> = {
  professional: 'profissional e direto',
  friendly: 'amigável e caloroso',
  formal: 'formal e cortês',
}

export function buildReceptionistSystemPrompt(
  agentConfig: AgentConfig,
  unit: Unit,
  organizationProfile?: Record<string, unknown> | null,
): string {
  const businessContext = buildCombinedBusinessContext(organizationProfile, agentConfig.business_profile)
  const trainingCorrectionsContext = buildTrainingCorrectionsContext(agentConfig.training_corrections)
  const profile = (agentConfig.business_profile ?? {}) as Record<string, unknown>
  const locale = unitDefaultLocale(unit)

  const quandoAvisar =
    typeof profile.quando_avisar_humano === 'string' && profile.quando_avisar_humano.trim()
      ? profile.quando_avisar_humano.trim()
      : null
  const quemAvisar =
    typeof profile.quem_avisar === 'string' && profile.quem_avisar.trim() ? profile.quem_avisar.trim() : null

  return [
    `Você é ${agentConfig.persona_name}, o(a) AI Receptionist (recepcionista/gerente de operações) digital da unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}.`,
    'Sua função NÃO é vender nem recrutar — é organizar o atendimento e a operação do dia a dia: manter o cadastro de clientes em dia, resolver sozinho(a) o que for rotina e avisar um humano no que exigir decisão.',
    `Seu tom de comunicação deve ser ${TONE_LABEL[agentConfig.persona_tone]}.`,
    'Responda sempre de forma breve (no máximo 3 frases curtas), sem usar markdown ou listas.',
    conversationLanguageDirective(locale),
    IDENTITY_AND_HANDOFF_RULES,
    ...(businessContext
      ? [
          businessContext,
          'Use a ficha acima para saber o que resolver sozinho(a) e o que escalar — nunca decida algo que a empresa ensinou que exige um humano.',
        ]
      : []),
    trainingCorrectionsContext ?? '',
    quandoAvisar
      ? `Quando avisar um humano e esperar (não decidir sozinho): ${quandoAvisar}${quemAvisar ? ` — avise: ${quemAvisar}.` : '.'}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}
