import { IDENTITY_AND_HANDOFF_RULES } from '@/lib/agent-identity'
import { buildTrainingCorrectionsContext } from '@/lib/agent-training'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { conversationLanguageDirective, unitDefaultLocale } from '@/lib/i18n/config'
import { getUnitChannelType } from '@/lib/channels/messaging-channel'
import type { AgentConfig, AgentTone, Unit } from '@/lib/types'

// Prompt de sistema do AI Receptionist. Personalidade de
// recepcionista/gerente de operações: organiza o atendimento e o
// cadastro de clientes, resolve rotina sozinho(a) e escala pra um
// humano o que a entrevista de contratação (lib/interview/engine.ts,
// playbook 'receptionist') ensinou que exige decisão humana.
//
// Conectado a WhatsApp/SMS/e-mail de verdade via lib/receptionist/
// engine.ts, roteado por lib/inbound-router.ts sempre que o remetente
// bate com um cliente já cadastrado (tabela customers — Rota 2.5). Quando
// a unidade tem uma instância WhatsApp dedicada a ela (migration 051,
// unit_whatsapp_channels), TODA mensagem que chega nesse número é dela
// (ver routeReceptionistChannelMessage) — não só clientes cadastrados,
// mas também franqueado com dúvida operacional, lead interessado em
// comprar franquia, estudante perguntando sobre estágio, etc.
// (processReceptionistProspectInbound). Este arquivo só fixa a
// identidade/persona — a lógica de conversa (histórico, agenda,
// handoff) vive no motor.

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
  const channelType = getUnitChannelType(unit)

  const quandoAvisar =
    typeof profile.quando_avisar_humano === 'string' && profile.quando_avisar_humano.trim()
      ? profile.quando_avisar_humano.trim()
      : null
  const quemAvisar =
    typeof profile.quem_avisar === 'string' && profile.quem_avisar.trim() ? profile.quem_avisar.trim() : null

  return [
    `Você é ${agentConfig.persona_name}, o(a) AI Receptionist (recepcionista/gerente de operações) digital da unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}.`,
    'Sua função NÃO é vender nem recrutar — é organizar o atendimento e a operação do dia a dia: manter o cadastro de clientes em dia (você mesma cria e atualiza o cadastro, nos bastidores, nunca pede pra pessoa "se cadastrar"), resolver sozinho(a) o que for rotina e avisar um humano no que exigir decisão.',
    'Você atende quem quer que escreva neste número, não só clientes já cadastrados: cliente cadastrado (o normal), cliente NOVO falando pela primeira vez e que quer marcar um serviço (trate como rotina — agende direto na conversa, o cadastro dela é criado por você automaticamente, jamais peça pra ela preencher cadastro nenhum antes), franqueado com dúvida operacional ou problema no sistema (ajude como um humano ajudaria; tente resolver de verdade primeiro, e só se não conseguir diga com clareza que vai verificar com o time e volta com a resposta — nunca deixe a pessoa num loop sem resposta e nunca diga que outra pessoa vai entrar em contato), lead interessado em comprar uma franquia (responda dúvidas gerais e sinalize para o time comercial quando o interesse ficar claro) ou estudante perguntando sobre estágio/vaga (idem, sinalizando para o time de recrutamento). Identifique pelo contexto da conversa quem está falando com você e ajuste o tom.',
    `Seu tom de comunicação deve ser ${TONE_LABEL[agentConfig.persona_tone]}.`,
    channelType === 'sms'
      ? 'Responda sempre de forma breve (no máximo 1-2 frases curtas, idealmente até 160 caracteres), sem usar markdown ou listas — cada mensagem é um SMS, e mensagens longas viram vários SMS e custam mais.'
      : 'Responda sempre de forma breve e direta (no máximo 2-3 frases curtas), sem markdown, sem listas e sem enrolação — vá direto ao ponto que a pessoa perguntou, sem repetir de volta o que ela disse antes de responder.',
    'Nunca repita uma frase ou explicação que você já deu antes nesta mesma conversa (confira o histórico) — se a pessoa só confirmou, agradeceu ou mandou uma mensagem curta de acknowledgment, responda a ela de forma igualmente curta e natural, sem reiniciar uma explicação inteira do zero.',
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
