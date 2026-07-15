import { generateStructuredReply, type ChatMessage } from '@/lib/openai'
import type { AgentConfig, AgentTone, InterviewTranscriptEntry, Unit } from '@/lib/types'

// Motor de entrevista/treinamento dos funcionários digitais.
//
// No momento da ativação, o funcionário (SDR, Recrutador ou Gestor de
// Tráfego) entrevista o dono/gestor da empresa numa conversa real de
// chat: ele faz as perguntas, adapta as próximas ao que foi respondido
// (ex.: 3 produtos → preço e detalhe de cada um) e SEMPRE encerra com a
// pergunta final "tem mais alguma coisa que eu deveria saber?".
//
// A regra da pergunta final não fica só no prompt: reduceInterview()
// (função pura, testável) só aceita interview_complete=true se a última
// mensagem do agente foi a pergunta final — se o modelo tentar encerrar
// antes, o motor converte a mensagem na pergunta final.
//
// O resultado vai para agent_configs.business_profile e é consumido
// pelos prompts/estratégia reais de cada funcionário (buildSystemPrompt
// do SDR, buildRecruiterBasePrompt, strategyFromBusinessProfile do
// Tráfego). A entrevista do Recrutador cobre a EMPRESA; o levantamento
// de cada vaga continua com o intake-engine assíncrono existente.

export type InterviewAgentType = 'sdr' | 'recruiter' | 'traffic_specialist'

export function isInterviewAgentType(agentType: string): agentType is InterviewAgentType {
  return agentType === 'sdr' || agentType === 'recruiter' || agentType === 'traffic_specialist'
}

type InterviewPlaybook = {
  /** como o cargo aparece nas mensagens ("vendedor (SDR)") */
  roleLabel: string
  /** o que ele vai fazer quando começar a trabalhar */
  mission: string
  /** roteiro-base: tópicos que PRECISAM estar cobertos antes de encerrar */
  requiredTopics: string[]
  /** schema (informal) do business_profile que o extractor preenche */
  profileSchema: string
}

export const INTERVIEW_PLAYBOOKS: Record<InterviewAgentType, InterviewPlaybook> = {
  sdr: {
    roleLabel: 'AI Sales Representative',
    mission:
      'atender clientes e leads pelo WhatsApp da empresa, qualificar interessados, vender os produtos/serviços e prospectar novos clientes',
    requiredTopics: [
      'quais produtos ou serviços a empresa vende — e, se forem vários, o preço e os detalhes de CADA um deles',
      'até que valor ou percentual de desconto você pode oferecer para fechar um negócio',
      'se a empresa vende para outras empresas (B2B), para consumidor final (B2C) ou os dois',
      'se atender empresas (B2B): que tipo de empresa e em qual região você deve prospectar no Google Maps',
      'se você deve conduzir a venda até o fechamento completo sozinho ou apenas qualificar o interessado e passar para um vendedor humano',
      'se você fecha sozinho: quando o cliente confirmar o fechamento, isso significa preencher uma vaga de emprego/estágio para essa empresa (ela é uma agência de recrutamento, estágios ou similar) ou é uma venda comum de produto/serviço (sem vaga nenhuma envolvida)',
      'quando o cliente fechar de verdade, se ele quer que você deixe registrado algum documento ou informação específica para enviar depois',
    ],
    profileSchema:
      '{"sobre_a_empresa": string, "produtos": [{"nome": string, "preco": string, "detalhes": string}], "politica_desconto": string, "tipo_cliente": "b2b"|"b2c"|"ambos", "prospeccao": {"tipos_empresa": string[], "regioes": string[]}, "fechamento": "fecha_sozinho"|"qualifica_e_passa_para_humano", "fechamento_natureza": "vaga_recrutamento"|"venda_ou_servico", "documento_fechamento": string, "observacoes": string[]}',
  },
  traffic_specialist: {
    roleLabel: 'gestor de tráfego pago',
    mission:
      'cuidar das campanhas de anúncio da empresa no Meta Ads e no Google Ads: acompanhar as métricas todo dia, sugerir otimizações e alocar bem o orçamento',
    requiredTopics: [
      'qual é o tipo de negócio da empresa (o que ela vende e para quem)',
      'qual o orçamento mensal disponível para anúncios, em reais',
      'qual é o público-alvo das campanhas',
      'qual a região de atuação (onde os anúncios devem aparecer)',
      'qual o objetivo principal das campanhas: gerar leads, vendas diretas ou reconhecimento de marca',
    ],
    profileSchema:
      '{"tipo_negocio": string, "orcamento_mensal_brl": number, "publico_alvo": string, "regiao": string, "objetivo_campanha": "leads"|"vendas"|"reconhecimento", "cpa_alvo_brl": number, "roas_alvo": number, "observacoes": string[]}',
  },
  recruiter: {
    roleLabel: 'recrutador(a)',
    mission:
      'cuidar das vagas da empresa: levantar o perfil ideal de cada vaga, buscar candidatos, fazer a triagem e entregar shortlists prontas (os detalhes de cada vaga você levanta depois, vaga a vaga — nesta entrevista você aprende sobre a EMPRESA)',
    requiredTopics: [
      'o que a empresa faz e em que segmento atua',
      'que tipos de cargo/vaga ela costuma contratar',
      'como é a cultura da empresa e o que ela valoriza nas pessoas que contrata',
      'onde ficam as unidades/locais de trabalho',
      'como funciona o processo seletivo dela (etapas, quem decide, prazos típicos)',
    ],
    profileSchema:
      '{"sobre_a_empresa": string, "segmento": string, "cargos_tipicos": string[], "cultura_valores": string[], "locais": string[], "processo_seletivo": string, "observacoes": string[]}',
  },
}

export const FINAL_QUESTION =
  'Antes de eu começar a trabalhar: tem mais alguma coisa importante que eu deveria saber sobre a empresa ou sobre como você quer que eu trabalhe?'

const READY_MESSAGE =
  'Perfeito, anotei tudo! Obrigado pela entrevista — estou pronto(a) para começar a trabalhar. 🚀'

/** Saída do modelo em cada turno (JSON mode). */
export type InterviewerOutput = {
  message?: string
  profile_updates?: Record<string, unknown>
  asked_final_question?: boolean
  interview_complete?: boolean
}

const TONE_LABEL: Record<AgentTone, string> = {
  professional: 'profissional e direto',
  friendly: 'amigável e caloroso',
  formal: 'formal e cortês',
}

export function buildInterviewerPrompt(params: {
  config: AgentConfig
  unit: Unit
  profile: Record<string, unknown>
  finalAlreadyAsked: boolean
}): string {
  const { config, unit, profile, finalAlreadyAsked } = params
  const playbook = INTERVIEW_PLAYBOOKS[config.agent_type as InterviewAgentType]
  const topics = playbook.requiredTopics.map((topic, i) => `${i + 1}) ${topic}`).join(' ')
  return [
    `Você é ${config.persona_name}, ${playbook.roleLabel} digital recém-contratado(a) pela unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}. Quando começar a trabalhar, sua função será ${playbook.mission}.`,
    'AGORA você está na sua entrevista de contratação: quem fala com você é o seu novo chefe (dono ou gestor da empresa). Seu objetivo é aprender 100% sobre a empresa e sobre como ela quer que você trabalhe — fazendo as perguntas certas, melhor do que qualquer funcionário humano faria.',
    'COMO CONDUZIR: você faz as perguntas e o chefe responde. No máximo 2 perguntas por mensagem, começando pelas mais importantes. Adapte as próximas perguntas ao que já foi respondido: se uma resposta abrir um desdobramento importante (ex.: "vendemos 3 produtos"), aprofunde antes de mudar de assunto (pergunte preço e detalhe de cada um dos 3). Se uma resposta for vaga ou ambígua, peça UM esclarecimento objetivo antes de avançar.',
    `Seu tom é ${TONE_LABEL[config.persona_tone]}. Escreva em português do Brasil, mensagens curtas, sem markdown.`,
    `TÓPICOS OBRIGATÓRIOS (todos precisam estar cobertos antes de encerrar): ${topics}`,
    'REGRA INEGOCIÁVEL DO ENCERRAMENTO:',
    `- Quando (e somente quando) todos os tópicos obrigatórios estiverem cobertos, sua próxima mensagem deve ser a pergunta final: "${FINAL_QUESTION}" (pode adaptar as palavras, nunca o sentido) — e nela marque "asked_final_question": true.`,
    '- Se a resposta à pergunta final trouxer informação nova, registre no perfil, aprofunde se necessário e faça a pergunta final DE NOVO depois.',
    '- Só marque "interview_complete": true quando o chefe responder à pergunta final indicando que não há mais nada a acrescentar. Nessa mensagem de encerramento, agradeça e diga que está pronto(a) para começar a trabalhar.',
    finalAlreadyAsked
      ? 'ATENÇÃO: sua última mensagem JÁ FOI a pergunta final. Se a resposta do chefe não trouxe nada novo, encerre agora com "interview_complete": true; se trouxe, registre, aprofunde e refaça a pergunta final ao terminar.'
      : '',
    `O QUE VOCÊ JÁ APRENDEU ATÉ AGORA (perfil coletado): ${JSON.stringify(profile)}`,
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    '{"message": "sua próxima mensagem para o chefe", "profile_updates": { apenas os campos aprendidos com a ÚLTIMA resposta dele }, "asked_final_question": boolean, "interview_complete": boolean}',
    `Schema do perfil (preencha nesses nomes de campo): ${playbook.profileSchema}.`,
    'Em "observacoes" acumule instruções extras que não cabem nos outros campos — sempre envie o array COMPLETO atualizado. Em campos de lista (ex.: "produtos"), envie a lista completa atualizada quando ela mudar. Não invente valores: registre apenas o que o chefe disse.',
  ]
    .filter(Boolean)
    .join(' ')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Funde as atualizações do turno no perfil (valores vazios não apagam nada). */
export function mergeProfile(
  current: Record<string, unknown>,
  updates: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged = { ...current }
  for (const [key, value] of Object.entries(updates ?? {})) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    if (Array.isArray(value) && value.length === 0) continue
    const existing = merged[key]
    merged[key] = isPlainObject(value) && isPlainObject(existing) ? { ...existing, ...value } : value
  }
  return merged
}

function lastAssistantAskedFinal(transcript: InterviewTranscriptEntry[]): boolean {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i]!
    if (entry.role === 'assistant') return entry.asked_final === true
  }
  return false
}

export type InterviewTurnResult = {
  reply: string
  done: boolean
  profile: Record<string, unknown>
  transcript: InterviewTranscriptEntry[]
}

/**
 * Aplica a saída do modelo ao estado da entrevista (função pura).
 *
 * Garante em código a regra do produto: a entrevista SÓ termina depois
 * que a pergunta final ("tem mais alguma coisa?") foi feita E respondida.
 * Se o modelo tentar encerrar sem tê-la feito, a mensagem vira a pergunta
 * final; se ele marcar as duas flags no mesmo turno, vale como pergunta
 * final (ainda não encerra).
 */
export function reduceInterview(params: {
  profile: Record<string, unknown>
  /** transcript já incluindo a última mensagem do usuário */
  transcript: InterviewTranscriptEntry[]
  output: InterviewerOutput
}): InterviewTurnResult {
  const profile = mergeProfile(params.profile, params.output.profile_updates)
  const finalAlreadyAsked = lastAssistantAskedFinal(params.transcript)
  const wantsComplete = params.output.interview_complete === true
  const askingFinalNow = params.output.asked_final_question === true

  // Encerra apenas se a pergunta final já tinha sido feita (e este turno não é ela de novo)
  const done = wantsComplete && finalAlreadyAsked && !askingFinalNow

  let reply = (params.output.message ?? '').trim()
  let askedFinal = askingFinalNow && !done

  if (wantsComplete && !done && !askedFinal) {
    // Tentou encerrar antes da pergunta final → força a pergunta final agora
    reply = reply.length > 0 ? `${reply} ${FINAL_QUESTION}` : FINAL_QUESTION
    askedFinal = true
  }

  if (reply.length === 0) {
    reply = done ? READY_MESSAGE : 'Certo! Me conta um pouco mais sobre isso, por favor?'
  }

  const transcript: InterviewTranscriptEntry[] = [
    ...params.transcript,
    { role: 'assistant', content: reply, ...(askedFinal ? { asked_final: true as const } : {}) },
  ]

  return { reply, done, profile, transcript }
}

/**
 * Roda um turno da entrevista: `userMessage=null` gera a mensagem de
 * abertura (apresentação + primeiras perguntas); caso contrário processa
 * a resposta do chefe e devolve a próxima pergunta.
 */
export async function runInterviewTurn(params: {
  apiKey: string
  config: AgentConfig
  unit: Unit
  userMessage: string | null
}): Promise<InterviewTurnResult> {
  const { apiKey, config, unit, userMessage } = params
  if (!isInterviewAgentType(config.agent_type)) {
    throw new Error(`Tipo de agente sem entrevista de contratação: ${config.agent_type}`)
  }

  const profile = (config.business_profile ?? {}) as Record<string, unknown>
  const baseTranscript = (config.interview_transcript ?? []) as InterviewTranscriptEntry[]
  const transcript: InterviewTranscriptEntry[] =
    userMessage && userMessage.trim().length > 0
      ? [...baseTranscript, { role: 'user', content: userMessage.trim() }]
      : [...baseTranscript]

  // Últimas 24 mensagens bastam: o perfil coletado no prompt compensa o corte
  const history: ChatMessage[] = transcript.slice(-24).map(({ role, content }) => ({ role, content }))
  if (history.length === 0) {
    history.push({
      role: 'user',
      content: '(o chefe acabou de te contratar e está pronto para a entrevista — apresente-se e comece)',
    })
  }

  const output = await generateStructuredReply<InterviewerOutput>({
    apiKey,
    systemPrompt: buildInterviewerPrompt({
      config,
      unit,
      profile,
      finalAlreadyAsked: lastAssistantAskedFinal(transcript),
    }),
    history,
    maxTokens: 900,
  })

  return reduceInterview({ profile, transcript, output })
}

/**
 * Transforma o business_profile em texto de system prompt — a "ficha da
 * empresa" que o funcionário usa no trabalho real. Retorna null quando a
 * entrevista ainda não coletou nada (comportamento antigo preservado).
 */
export function buildBusinessContext(profile: Record<string, unknown> | null | undefined): string | null {
  if (!profile || Object.keys(profile).length === 0) return null
  return [
    'FICHA DA EMPRESA — tudo o que você aprendeu na sua entrevista de contratação, é a fonte de verdade sobre a empresa:',
    JSON.stringify(profile),
    'Use essas informações ativamente nas conversas e decisões; NÃO invente nada que não esteja na ficha.',
  ].join(' ')
}
