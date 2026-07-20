import { generateStructuredReply, type ChatMessage } from '@/lib/openai'
import { interviewLanguageDirective, interviewLanguageLabel, unitDefaultLocale, type Locale } from '@/lib/i18n/config'
import { VERTICAL_TEMPLATES, isVerticalKey, type VerticalKey } from '@/lib/verticals/catalog'
import type { AgentConfig, AgentTone, InterviewTranscriptEntry, Organization, Unit } from '@/lib/types'

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

export type InterviewAgentType = 'sdr' | 'recruiter' | 'traffic_specialist' | 'receptionist'

export function isInterviewAgentType(agentType: string): agentType is InterviewAgentType {
  return (
    agentType === 'sdr' ||
    agentType === 'recruiter' ||
    agentType === 'traffic_specialist' ||
    agentType === 'receptionist'
  )
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
  /** instruções extras só deste playbook, anexadas depois do schema */
  extraGuidance?: (locale: Locale) => string
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
      'se você fecha sozinho: quando o cliente confirmar o fechamento de verdade, EXATAMENTE quais dados você precisa perguntar pra ele nesse momento — pode ser um perfil de vaga (curso, semestre, cidade, modalidade, quantidade de vagas) se a empresa for uma agência de recrutamento/estágios, dados como CPF/CNPJ e endereço se for uma venda que gera contrato (ex.: franquia), ou qualquer outra coisa — pergunte especificamente o que ESTA empresa precisa, nunca assuma um padrão',
      'se você fecha sozinho: o que deve acontecer depois de coletar esses dados — pra quem ou pro quê isso deve ser encaminhado (ex.: "criar uma vaga e mandar pro Recrutador", "notificar o jurídico/financeiro pra emitir contrato de franquia", "só registrar o interesse e notificar o time comercial humano pra fechar por telefone") — e se isso significa especificamente criar uma vaga de recrutamento/estágio e mandar pro Recrutador (sim ou não)',
      'você também atende e fecha negócio por e-mail, além de WhatsApp/SMS — pergunte se o processo muda nesse canal (ex.: tom mais formal, respostas podem demorar mais, pode ser necessário confirmar algo por escrito) ou se é exatamente o mesmo processo de fechamento independente do canal',
    ],
    profileSchema:
      '{"sobre_a_empresa": string, "produtos": [{"nome": string, "preco": string, "detalhes": string}], "politica_desconto": string, "tipo_cliente": "b2b"|"b2c"|"ambos", "prospeccao": {"tipos_empresa": string[], "regioes": string[]}, "fechamento": "fecha_sozinho"|"qualifica_e_passa_para_humano", "fechamento_campos": [{"chave": string, "pergunta": string}], "fechamento_acao": string, "fechamento_cria_vaga_recrutamento": boolean, "observacoes": string[]}',
    extraGuidance: (locale) =>
      `Sobre "fechamento_campos": cada item precisa de uma "chave" curta em snake_case (identificador, ex.: "cidade", "cpf_cnpj") e uma "pergunta" em ${interviewLanguageLabel(locale)} explicando o que perguntar ao cliente — envie SOMENTE os campos que fazem sentido para ESTA empresa, nunca uma lista padrão. Se "fechamento_cria_vaga_recrutamento" for true, use preferencialmente as chaves course, semester_min, semester_max, city, modality, positions_needed, urgency (mantém compatibilidade com o Recrutador). Em "fechamento_acao", descreva em texto livre e específico o que fazer com o fechamento e para quem encaminhar — nunca deixe vago. "fechamento_campos"/"fechamento_acao"/"fechamento_cria_vaga_recrutamento" valem para QUALQUER canal em que a conversa aconteça (WhatsApp, SMS ou e-mail) — é a mesma decisão de fechamento, não crie um processo separado para e-mail; se o chefe disser que o processo muda no e-mail (ex.: precisa de confirmação por escrito, outro prazo), registre essa diferença dentro de "fechamento_acao" ou em "observacoes".`,
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
  receptionist: {
    roleLabel: 'recepcionista/gerente de operações',
    mission:
      'organizar o atendimento e a operação do dia a dia: manter o cadastro de clientes em dia, resolver sozinho(a) o que for rotina e avisar um humano no que exigir decisão',
    requiredTopics: [
      'qual é o tipo de negócio da empresa e como funciona o atendimento hoje (loja física, telefone, WhatsApp, agenda, recepção, etc.)',
      'quais tarefas do dia a dia você pode resolver sozinho(a), sem precisar avisar ninguém (ex.: cadastrar um cliente novo, atualizar um dado, responder uma dúvida simples)',
      'em quais situações você deve avisar um humano e esperar, em vez de decidir sozinho(a) (ex.: reclamação, cancelamento, algo fora do combinado) — e quem exatamente deve ser avisado nesses casos',
      'quais dados mínimos você deve pedir quando um cliente novo aparece (nome e telefone sempre; o que mais faz sentido pedir para ESTE negócio, ex.: endereço, e-mail)',
      'se a empresa já separa os clientes por algum tipo de marcação/categoria (ex.: VIP, inadimplente, novo) e quais são essas categorias',
      'qual o horário de funcionamento da empresa e o que fazer com contatos fora desse horário',
    ],
    profileSchema:
      '{"tipo_negocio": string, "como_atende_hoje": string, "tarefas_automaticas": string[], "quando_avisar_humano": string, "quem_avisar": string, "dados_minimos_cliente": string[], "tags_clientes": string[], "horario_funcionamento": string, "observacoes": string[]}',
  },
}

// Ficha da Empresa compartilhada (organizations.vertical_key/business_profile,
// migration 025, sub-etapa 2/7 de Business Profile + Vertical Templates).
// Perguntada UMA VEZ por organização, só na primeira entrevista que começa
// depois de a org ainda não ter vertical_key definido — ver runInterviewTurn
// (gate por interview_status/profile.org_intake_started) e
// extractOrganizationIntake (grava em organizations, nunca em
// agent_configs.business_profile). Puramente aditivo: uma entrevista que já
// estava em andamento antes desta mudança nunca ganha estes tópicos.

function verticalOptionsLabel(locale: Locale): string {
  return Object.values(VERTICAL_TEMPLATES)
    .map((t) => (locale === 'en' ? t.labelEn : t.labelPt))
    .join(', ')
}

function orgIntakeTopics(locale: Locale): string[] {
  return [
    `o segmento principal do negócio — apresente estas opções: ${verticalOptionsLabel(locale)}; se a resposta do chefe não se encaixar claramente em nenhuma, analise a descrição que ele der do negócio e sugira o segmento que parece mais adequado (ou "${locale === 'en' ? VERTICAL_TEMPLATES.other.labelEn : VERTICAL_TEMPLATES.other.labelPt}" se nenhum se encaixar bem) — em qualquer caso, SEMPRE peça confirmação explícita do chefe antes de registrar "org_vertical_confirmed": true`,
    'um pequeno conjunto de fatos de identidade da empresa, compartilhados entre todos os funcionários digitais dela: nome oficial, descrição curta do negócio, principais diferenciais competitivos, tom de voz preferido no atendimento, idioma(s) em que a empresa atende, horário geral de funcionamento, e quais canais de atendimento ela usa',
  ]
}

const ORG_VERTICAL_KEY_SCHEMA_VALUES = Object.keys(VERTICAL_TEMPLATES)
  .map((key) => `"${key}"`)
  .join('|')

const ORG_INTAKE_PROFILE_SCHEMA_FRAGMENT =
  `"org_vertical_key": ${ORG_VERTICAL_KEY_SCHEMA_VALUES}, "org_vertical_confirmed": boolean (só true depois de confirmado com o chefe), "org_company_name": string, "org_description": string, "org_differentiators": string[], "org_tone_of_voice": string, "org_languages": string[], "org_business_hours": string, "org_channels": string[]`

export const FINAL_QUESTION =
  'Antes de eu começar a trabalhar: tem mais alguma coisa importante que eu deveria saber sobre a empresa ou sobre como você quer que eu trabalhe?'

const FINAL_QUESTION_EN =
  "Before I start working: is there anything important I should know about the company or how you'd like me to work?"

function finalQuestionFor(locale: Locale): string {
  return locale === 'en' ? FINAL_QUESTION_EN : FINAL_QUESTION
}

const READY_MESSAGE =
  'Perfeito, anotei tudo! Obrigado pela entrevista — estou pronto(a) para começar a trabalhar. 🚀'

const READY_MESSAGE_EN =
  "Perfect, got it all! Thanks for the interview — I'm ready to start working. 🚀"

function readyMessageFor(locale: Locale): string {
  return locale === 'en' ? READY_MESSAGE_EN : READY_MESSAGE
}

const CONTINUE_PROMPT = 'Certo! Me conta um pouco mais sobre isso, por favor?'
const CONTINUE_PROMPT_EN = 'Got it! Could you tell me a bit more about that, please?'

function continuePromptFor(locale: Locale): string {
  return locale === 'en' ? CONTINUE_PROMPT_EN : CONTINUE_PROMPT
}

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
  /** true só na(s) entrevista(s) que ainda vão perguntar a Ficha da Empresa compartilhada (ver runInterviewTurn) */
  includeOrgIntake?: boolean
}): string {
  const { config, unit, profile, finalAlreadyAsked, includeOrgIntake = false } = params
  const playbook = INTERVIEW_PLAYBOOKS[config.agent_type as InterviewAgentType]
  const locale = unitDefaultLocale(unit)
  const allTopics = includeOrgIntake ? [...orgIntakeTopics(locale), ...playbook.requiredTopics] : playbook.requiredTopics
  const topics = allTopics.map((topic, i) => `${i + 1}) ${topic}`).join(' ')
  return [
    `Você é ${config.persona_name}, ${playbook.roleLabel} digital recém-contratado(a) pela unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}. Quando começar a trabalhar, sua função será ${playbook.mission}.`,
    'AGORA você está na sua entrevista de contratação: quem fala com você é o seu novo chefe (dono ou gestor da empresa). Seu objetivo é aprender 100% sobre a empresa e sobre como ela quer que você trabalhe — fazendo as perguntas certas, melhor do que qualquer funcionário humano faria.',
    'COMO CONDUZIR: você faz as perguntas e o chefe responde. No máximo 2 perguntas por mensagem, começando pelas mais importantes. Adapte as próximas perguntas ao que já foi respondido: se uma resposta abrir um desdobramento importante (ex.: "vendemos 3 produtos"), aprofunde antes de mudar de assunto (pergunte preço e detalhe de cada um dos 3). Se uma resposta for vaga ou ambígua, peça UM esclarecimento objetivo antes de avançar.',
    `Seu tom é ${TONE_LABEL[config.persona_tone]}. ${interviewLanguageDirective(locale)} Mensagens curtas, sem markdown.`,
    includeOrgIntake
      ? 'Esta empresa ainda não tem uma Ficha da Empresa compartilhada entre os funcionários digitais dela — comece a entrevista pelos tópicos 1 e 2 (identidade da empresa e segmento de negócio) antes de entrar nos tópicos específicos do seu cargo.'
      : '',
    `TÓPICOS OBRIGATÓRIOS (todos precisam estar cobertos antes de encerrar): ${topics}`,
    'REGRA INEGOCIÁVEL DO ENCERRAMENTO:',
    `- Quando (e somente quando) todos os tópicos obrigatórios estiverem cobertos, sua próxima mensagem deve ser a pergunta final: "${finalQuestionFor(locale)}" (pode adaptar as palavras, nunca o sentido) — e nela marque "asked_final_question": true.`,
    '- Se a resposta à pergunta final trouxer informação nova, registre no perfil, aprofunde se necessário e faça a pergunta final DE NOVO depois.',
    '- Só marque "interview_complete": true quando o chefe responder à pergunta final indicando que não há mais nada a acrescentar. Nessa mensagem de encerramento, agradeça e diga que está pronto(a) para começar a trabalhar.',
    finalAlreadyAsked
      ? 'ATENÇÃO: sua última mensagem JÁ FOI a pergunta final. Se a resposta do chefe não trouxe nada novo, encerre agora com "interview_complete": true; se trouxe, registre, aprofunde e refaça a pergunta final ao terminar.'
      : '',
    `O QUE VOCÊ JÁ APRENDEU ATÉ AGORA (perfil coletado): ${JSON.stringify(profile)}`,
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    '{"message": "sua próxima mensagem para o chefe", "profile_updates": { apenas os campos aprendidos com a ÚLTIMA resposta dele }, "asked_final_question": boolean, "interview_complete": boolean}',
    `Schema do perfil (preencha nesses nomes de campo): ${playbook.profileSchema}.`,
    includeOrgIntake
      ? `Além desse schema, quando cobrir os tópicos 1 e 2 (e SOMENTE depois de o chefe confirmar o segmento), inclua também estes campos no profile_updates: ${ORG_INTAKE_PROFILE_SCHEMA_FRAGMENT}.`
      : '',
    'Em "observacoes" acumule instruções extras que não cabem nos outros campos — sempre envie o array COMPLETO atualizado. Em campos de lista (ex.: "produtos"), envie a lista completa atualizada quando ela mudar. Não invente valores: registre apenas o que o chefe disse.',
    playbook.extraGuidance?.(locale) ?? '',
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
  /** idioma da unidade — padrão 'pt' preserva o comportamento histórico */
  locale?: Locale
}): InterviewTurnResult {
  const locale = params.locale ?? 'pt'
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
    const finalQuestion = finalQuestionFor(locale)
    reply = reply.length > 0 ? `${reply} ${finalQuestion}` : finalQuestion
    askedFinal = true
  }

  if (reply.length === 0) {
    reply = done ? readyMessageFor(locale) : continuePromptFor(locale)
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
  /** Organização dona da unidade — usada só para decidir/gravar a Ficha da Empresa compartilhada (vertical_key/business_profile, migration 025). Ausente/null = nunca pergunta a ficha compartilhada, comportamento idêntico ao de hoje. */
  organization?: Organization | null
  userMessage: string | null
}): Promise<InterviewTurnResult> {
  const { apiKey, config, unit, organization = null, userMessage } = params
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

  // Só pergunta a Ficha da Empresa compartilhada enquanto a org ainda não
  // tem vertical_key E (a) esta é a entrevista que está começando agora
  // (interview_status ainda 'pending' — nunca reabre uma entrevista já em
  // andamento antes desta mudança) OU (b) ela mesma já iniciou esse
  // sub-roteiro num turno anterior (profile.org_intake_started, marcado
  // logo abaixo) — assim o tópico continua lembrado turno a turno até o
  // chefe confirmar o segmento, do mesmo jeito que os tópicos do playbook.
  const includeOrgIntake =
    Boolean(organization) &&
    !organization!.vertical_key &&
    profile.org_vertical_confirmed !== true &&
    ((config.interview_status ?? 'pending') === 'pending' || profile.org_intake_started === true)

  const output = await generateStructuredReply<InterviewerOutput>({
    apiKey,
    systemPrompt: buildInterviewerPrompt({
      config,
      unit,
      profile,
      finalAlreadyAsked: lastAssistantAskedFinal(transcript),
      includeOrgIntake,
    }),
    history,
    maxTokens: 900,
  })

  const result = reduceInterview({ profile, transcript, output, locale: unitDefaultLocale(unit) })
  if (includeOrgIntake && result.profile.org_intake_started !== true) {
    result.profile = { ...result.profile, org_intake_started: true }
  }
  return result
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

/**
 * Compõe a Ficha da Empresa compartilhada (organizations.business_profile,
 * migration 025) com a ficha específica de um funcionário
 * (agent_configs.business_profile) — usada pelos 4 prompts de sistema
 * (Sales, Recrutador, Receptionist, Tráfego). Quando a ficha compartilhada
 * ainda está vazia (todas as organizações hoje), o texto produzido é
 * IDÊNTICO ao de `buildBusinessContext(agentProfile)` sozinho — nenhuma
 * organização já entrevistada nesta sub-etapa perde ou ganha comportamento.
 */
export function buildCombinedBusinessContext(
  organizationProfile: Record<string, unknown> | null | undefined,
  agentProfile: Record<string, unknown> | null | undefined,
): string | null {
  const orgContext = buildBusinessContext(organizationProfile)
  const agentContext = buildBusinessContext(agentProfile)
  if (!orgContext) return agentContext
  const orgBlock = [
    'FICHA COMPARTILHADA DA EMPRESA — vale para todos os funcionários digitais desta empresa, aprendida na entrevista de contratação de um deles:',
    JSON.stringify(organizationProfile),
    'Use essas informações ativamente; NÃO invente nada que não esteja nelas.',
  ].join(' ')
  return agentContext ? `${orgBlock} INFORMAÇÕES ESPECÍFICAS DESTE FUNCIONÁRIO: ${agentContext}` : orgBlock
}

export type OrganizationIntakeResult = { vertical_key: VerticalKey; business_profile: Record<string, unknown> }

const ORG_INTAKE_FIELD_MAP: [string, string][] = [
  ['org_company_name', 'company_name'],
  ['org_description', 'description'],
  ['org_differentiators', 'differentiators'],
  ['org_tone_of_voice', 'tone_of_voice'],
  ['org_languages', 'languages'],
  ['org_business_hours', 'business_hours'],
  ['org_channels', 'channels'],
]

/**
 * Função pura e separada de `mergeProfile` (que continua gravando só em
 * agent_configs.business_profile, sem alteração): a partir do profile do
 * AGENTE após um turno de entrevista, decide se o chefe acabou de confirmar
 * o segmento/identidade da empresa — e se sim, devolve o que gravar em
 * organizations.vertical_key/business_profile. Retorna null enquanto não
 * houver confirmação explícita (`org_vertical_confirmed !== true`).
 */
export function extractOrganizationIntake(profile: Record<string, unknown>): OrganizationIntakeResult | null {
  if (profile.org_vertical_confirmed !== true) return null
  if (!isVerticalKey(profile.org_vertical_key)) return null

  const business_profile: Record<string, unknown> = {}
  for (const [from, to] of ORG_INTAKE_FIELD_MAP) {
    const value = profile[from]
    if (value !== undefined) business_profile[to] = value
  }
  return { vertical_key: profile.org_vertical_key, business_profile }
}
