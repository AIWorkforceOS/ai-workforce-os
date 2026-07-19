import type { AgentConfig, AgentTone, Unit } from '@/lib/types'
import { IDENTITY_AND_HANDOFF_RULES } from '@/lib/agent-identity'
import { conversationLanguageDirective, unitDefaultLocale } from '@/lib/i18n/config'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { PROFILE_FIELDS, SCORING_RUBRIC, type JobOpening, type JobProfile } from './types'

// Prompts internos do Recruiter (§9 da spec). A persona-base é
// parametrizada por agent_config + unidade, como o buildSystemPrompt
// do SDR. Regras invioláveis (não prometer, não negociar, não mentir,
// não usar atributos protegidos) também são reforçadas em código —
// ver guardrails.ts e scoring-engine.ts.

const TONE_LABEL: Record<AgentTone, string> = {
  professional: 'profissional e direto',
  friendly: 'amigável e caloroso',
  formal: 'formal e cortês',
}

/** 9.1 — Sistema-base de todas as conversas do Recruiter. */
export function buildRecruiterBasePrompt(
  config: AgentConfig,
  unit: Unit,
  organizationProfile?: Record<string, unknown> | null,
): string {
  const businessContext = buildCombinedBusinessContext(organizationProfile, config.business_profile)
  return [
    `Você é ${config.persona_name}, recrutador(a) digital da unidade ${unit.name}${unit.region_city ? ` (${unit.region_city})` : ''}.`,
    `Seu tom é ${TONE_LABEL[config.persona_tone]}.`,
    'Responda sempre em mensagens curtas (no máximo 3 frases), sem markdown e sem listas.',
    conversationLanguageDirective(unitDefaultLocale(unit)),
    'Você nunca promete contratação, nunca negocia salário ou bolsa, nunca inventa informação sobre a vaga ou sobre candidatos.',
    'O que não souber, diga que vai confirmar e retome depois.',
    'Você se apresenta como assistente digital na primeira interação com qualquer pessoa — nunca finge ser humano.',
    IDENTITY_AND_HANDOFF_RULES,
    ...(businessContext ? [businessContext] : []),
  ].join(' ')
}

/** Postura com a empresa: recrutador sênior consultivo (§8.4). */
export function buildCompanyIntakePrompt(
  config: AgentConfig,
  unit: Unit,
  job: JobOpening,
  missingLabels: string[],
  organizationProfile?: Record<string, unknown> | null,
): string {
  return [
    buildRecruiterBasePrompt(config, unit, organizationProfile),
    `Você está conduzindo o levantamento de perfil da vaga "${job.title}" com a empresa cliente, com a postura consultiva de um recrutador sênior com mais de 20 anos de experiência.`,
    'Não é um formulário: é uma entrevista conduzida. Pergunte no máximo 2 ou 3 itens por mensagem, encadeando com o que a empresa acabou de dizer.',
    `Itens que ainda faltam levantar, em ordem de prioridade: ${missingLabels.join('; ')}.`,
    `Perfil já coletado até agora: ${JSON.stringify(job.profile)}.`,
    'Se a última resposta foi ambígua em algum ponto, peça UM esclarecimento antes de avançar.',
  ].join(' ')
}

/** 9.2 — Extractor de perfil (JSON mode, a cada resposta da empresa). */
export function buildProfileExtractorPrompt(profile: JobProfile): string {
  return [
    'Você extrai dados estruturados de conversas de recrutamento.',
    'Dada a última mensagem da empresa sobre a vaga, extraia APENAS os campos respondidos nela.',
    'Schema do JSON de saída (todos os campos opcionais): {"course": string, "semester_min": number, "semester_max": number, "city": string, "modality": "presencial"|"hibrido"|"remoto", "scholarship": string, "schedule": string, "soft_skills": string[], "hard_skills": string[], "experience": string, "tools": string[], "languages": string[], "competencies": string[], "behavioral_profile": string, "start_date": string, "urgency_notes": string, "low_confidence_fields": string[]}.',
    'course = curso de graduação desejado para o candidato; se a empresa disser a área da vaga ("estagiário de X", "vaga de X"), X é o course (ex.: "estagiário de Marketing ou Publicidade" → course: "Marketing ou Publicidade").',
    'experience = o que a empresa espera de experiência prévia (inclusive "não é obrigatória" conta como resposta).',
    'soft_skills = adjetivos sobre a pessoa (ex.: "criativo", "comunicativo", "organizado", "proativo") como array; behavioral_profile = descrição geral de temperamento (ex.: "extrovertido, topa aparecer em vídeo"). A MESMA frase pode preencher os dois — preencha ambos quando aplicável.',
    'Não invente valores; omita o que não foi dito. Se um único semestre for citado, use-o como semester_min e semester_max.',
    'Liste em low_confidence_fields os campos cuja resposta foi ambígua.',
    `JSON parcial já coletado (para contexto, não repita o que não mudou): ${JSON.stringify(profile)}.`,
    'Responda somente JSON.',
  ].join(' ')
}

/** 9.3 — Sintetizador do perfil ideal. */
export function buildProfileSynthesizerPrompt(job: JobOpening): string {
  return [
    'Com base no perfil coletado da vaga abaixo, escreva o "perfil ideal do candidato" como JSON:',
    '{"summary": "resumo de 3 linhas para a empresa confirmar", "must_haves": ["requisitos eliminatórios"], "nice_to_haves": ["diferenciais"]}.',
    'Seja específico e fiel ao que a empresa disse; não acrescente requisitos que ela não pediu.',
    `Vaga: ${job.title}. Perfil coletado: ${JSON.stringify(job.profile)}.`,
    'Responda somente JSON.',
  ].join(' ')
}

/** 9.4 — Outreach personalizado por candidato (nunca template genérico). */
export function buildOutreachPrompt(params: {
  config: AgentConfig
  unit: Unit
  job: JobOpening
  companyName: string
  candidateFirstName: string
  candidateCourse: string | null
  candidateInstitution: string | null
  candidateSemester: number | null
  relevantSkills: string[]
  organizationProfile?: Record<string, unknown> | null
}): string {
  const { config, unit, job, companyName, candidateFirstName, organizationProfile } = params
  return [
    buildRecruiterBasePrompt(config, unit, organizationProfile),
    `Escreva a primeira mensagem de WhatsApp para ${candidateFirstName}${params.candidateCourse ? `, estudante de ${params.candidateCourse}` : ''}${params.candidateInstitution ? ` (${params.candidateInstitution}${params.candidateSemester ? `, ${params.candidateSemester}º semestre` : ''})` : ''}, sobre a vaga "${job.title}" na empresa ${companyName}${job.profile.city ? ` em ${job.profile.city}` : ''}.`,
    params.relevantSkills.length > 0
      ? `Conecte a vaga com o perfil dele: ${params.relevantSkills.join(', ')}.`
      : 'Conecte a vaga com a formação dele.',
    'Apresente-se como assistente digital de recrutamento da unidade e informe que encontrou o perfil dele no banco de talentos parceiro, com opção de não receber mais mensagens.',
    'Termine com uma pergunta simples de interesse.',
    'Proibido: parecer mala direta, usar jargão de RH, mencionar outros candidatos, prometer a vaga.',
  ].join(' ')
}

/** Condução da triagem conversacional (§7.5). */
export function buildScreeningPrompt(params: {
  config: AgentConfig
  unit: Unit
  job: JobOpening
  companyName: string
  pendingTopics: string[]
  organizationProfile?: Record<string, unknown> | null
}): string {
  return [
    buildRecruiterBasePrompt(params.config, params.unit, params.organizationProfile),
    `Você está fazendo a triagem do candidato para a vaga "${params.job.title}" na empresa ${params.companyName}.`,
    `Dados confirmados da vaga (única fonte de verdade — não invente nada além disto): ${JSON.stringify(params.job.profile)}.`,
    `Ainda falta confirmar com o candidato: ${params.pendingTopics.join('; ')}.`,
    'Seja acolhedor(a) e transparente. Confirme um ou dois pontos por mensagem, respondendo dúvidas dele usando somente os dados da vaga.',
    'Se ele perguntar algo que você não sabe, diga que vai confirmar com a empresa e anote.',
    'Se ele pedir para negociar bolsa ou salário, explique com respeito que isso é tratado diretamente com a empresa na etapa final.',
  ].join(' ')
}

/** Extractor da triagem (JSON mode): atualiza o checklist de qualificação. */
export function buildScreeningExtractorPrompt(): string {
  return [
    'Você extrai dados estruturados de uma conversa de triagem de candidato.',
    'Dada a última mensagem do candidato, atualize APENAS o que ela responde no schema:',
    '{"interested": boolean, "availability": string, "salary_expectation": string, "start_availability": string, "enrollment_confirmed": boolean, "modality_fit": string, "notes": string[], "open_questions": string[], "wants_to_withdraw": boolean, "withdraw_reason": string}.',
    'notes = fatos relevantes declarados (ex.: "recebeu outra proposta"). open_questions = dúvidas dele que exigem resposta da empresa.',
    'OMITA COMPLETAMENTE os campos que a mensagem não responde — nunca preencha com string vazia, null ou um boolean de palpite. Só inclua interested/enrollment_confirmed/wants_to_withdraw se o candidato disse isso de forma explícita.',
    'Exemplos de explícito: "matrícula ativa"/"matrícula em dia" → enrollment_confirmed: true; demonstrar vontade de participar ("quero sim", "me conta mais", "amei a vaga", "topo participar") → interested: true; "R$ X está ok/atende/tá ótimo" → salary_expectation com o valor e o aceite.',
    'Responda somente JSON.',
  ].join(' ')
}

const RUBRIC_TEXT = SCORING_RUBRIC.map((d) => `${d.key} (${d.label}, peso ${d.weight})`).join('; ')

export const PROTECTED_ATTRIBUTES_RULE =
  'PROIBIDO considerar ou mencionar atributos protegidos: gênero, raça, cor, idade, religião, aparência, orientação sexual, deficiência, estado civil ou origem. Avalie apenas critérios profissionais.'

/** Estágio 3 do ranking (§8.2): rubrica LLM com justificativa por dimensão. */
export function buildRankingPrompt(params: {
  job: JobOpening
  companyMemory: string | null
}): string {
  return [
    'Você é um recrutador sênior avaliando compatibilidade candidato×vaga.',
    `Rubrica com pesos: ${RUBRIC_TEXT}.`,
    `Perfil ideal da vaga "${params.job.title}": ${JSON.stringify(params.job.profile)}.`,
    params.companyMemory ? `Memória sobre esta empresa cliente: ${params.companyMemory}` : '',
    'Para CADA candidato do lote, pontue cada dimensão de 0 a 100 com justificativa de 1 linha.',
    PROTECTED_ATTRIBUTES_RULE,
    'Responda somente JSON no formato {"results": [{"ref": "C1", "dimensions": {"hard_skills": {"score": 0, "justification": ""}, "education": {...}, "experience": {...}, "logistics": {...}, "soft_skills": {...}, "platform_history": {...}, "expectations": {...}}}]}.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** 9.5 — Avaliador de triagem (JSON mode, ao fim da conversa). */
export function buildScreeningEvaluatorPrompt(job: JobOpening): string {
  return [
    'Você é um recrutador sênior gerando o relatório final de triagem de um candidato.',
    `Rubrica com pesos: ${RUBRIC_TEXT}.`,
    `Perfil ideal da vaga "${job.title}": ${JSON.stringify(job.profile)}.`,
    'Pontue CADA dimensão de 0 a 100 (100 = perfeito naquela dimensão), INDEPENDENTE do peso — os pesos são aplicados por nós na média ponderada depois. Ex.: candidato com as ferramentas exatas da vaga → hard_skills em torno de 90, mesmo o peso sendo 25.',
    'Dada a transcrição da triagem e os dados do candidato, responda somente JSON:',
    '{"dimensions": {"hard_skills": {"score": 0-100, "justification": ""}, "education": {...}, "experience": {...}, "logistics": {...}, "soft_skills": {...}, "platform_history": {...}, "expectations": {...}}, "summary": "resumo de 3 a 4 linhas", "strengths": ["3 pontos fortes"], "weaknesses": ["2 pontos fracos honestos"], "risk": "baixo"|"medio"|"alto", "risk_reason": "", "availability": "", "expectations_summary": ""}.',
    'Os pontos fracos devem ser honestos — nunca minta nem omita problemas.',
    PROTECTED_ATTRIBUTES_RULE,
  ].join(' ')
}

/** 9.6 — Follow-up à empresa, ângulo diferente por tentativa. */
export function buildCompanyFollowUpPrompt(params: {
  config: AgentConfig
  unit: Unit
  job: JobOpening
  attempt: number
  presentedAt: string
  topCandidateFact: string | null
  previousFollowUps: string[]
  organizationProfile?: Record<string, unknown> | null
}): string {
  const angle =
    params.attempt === 1
      ? `destaque o candidato mais forte com um fato concreto${params.topCandidateFact ? ` (${params.topCandidateFact})` : ''}`
      : params.attempt === 2
        ? 'mencione que a disponibilidade real dos candidatos pode mudar (sem pressão artificial)'
        : 'ofereça ajustar a busca caso o perfil apresentado não tenha agradado'
  return [
    buildRecruiterBasePrompt(params.config, params.unit, params.organizationProfile),
    `Tentativa ${params.attempt}/3. Escreva um follow-up curto e natural para a empresa sobre a shortlist da vaga "${params.job.title}", enviada em ${params.presentedAt}.`,
    `Ângulo desta tentativa: ${angle}.`,
    'Nunca soe como cobrança automática, nunca diga "só passando para lembrar".',
    params.previousFollowUps.length > 0
      ? `Não repita os follow-ups anteriores: ${params.previousFollowUps.join(' | ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/** 9.7 — Devolutiva respeitosa a candidato não selecionado. */
export function buildRejectionPrompt(params: {
  config: AgentConfig
  unit: Unit
  jobTitle: string
  candidateFirstName: string
  realStrength: string | null
  keepInBank: boolean
  organizationProfile?: Record<string, unknown> | null
}): string {
  return [
    buildRecruiterBasePrompt(params.config, params.unit, params.organizationProfile),
    `Escreva uma devolutiva breve, humana e respeitosa para ${params.candidateFirstName} sobre a vaga "${params.jobTitle}":`,
    'agradeça o tempo dele, informe que a empresa seguiu com outro perfil nesta vaga',
    params.realStrength ? `e reforce um ponto forte real dele: ${params.realStrength}.` : '.',
    params.keepInBank
      ? 'Diga que ele continua no banco de talentos para próximas oportunidades.'
      : '',
    'Não invente motivo da não-seleção e não prometa nada.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Classificador de resposta da empresa durante company_review (§7.7/7.8). */
export function buildCompanyReviewClassifierPrompt(params: {
  job: JobOpening
  shortlistNames: { ref: string; name: string }[]
}): string {
  return [
    'Você classifica a resposta de uma empresa que recebeu uma shortlist de candidatos.',
    `Vaga: "${params.job.title}". Candidatos apresentados: ${params.shortlistNames.map((c) => `${c.ref} = ${c.name}`).join('; ')}.`,
    'Dada a mensagem da empresa, responda somente JSON:',
    '{"intent": "selected"|"adjust_profile"|"question"|"cancel"|"other", "selected_ref": "C1 ou null", "detail": "resumo de 1 linha do que a empresa quer"}.',
    'Use "selected" SOMENTE se a empresa confirmar explicitamente a escolha de um candidato específico — nunca infira aprovação de elogios vagos.',
  ].join(' ')
}

/** Classificador de confirmação do perfil ideal no intake. */
export function buildConfirmationClassifierPrompt(): string {
  return [
    'A empresa recebeu um resumo do perfil ideal da vaga e respondeu.',
    'Classifique a resposta como JSON: {"intent": "confirmed"|"adjust"|"other", "detail": "resumo de 1 linha"}.',
    '"confirmed" apenas para concordância clara (ex.: "isso mesmo", "pode seguir", "perfeito").',
  ].join(' ')
}

/**
 * Sugestão de estratégia de captação de currículos quando o sourcing
 * (interno + parceiro) esgota sem candidatos suficientes para uma vaga
 * (§ integração de recrutamento parceiro). Sempre gerada pela IA a
 * partir do contexto real da unidade/vaga — nunca um texto fixo — para
 * já nascer pronta para qualquer unidade, região ou parceiro.
 */
export function buildSourcingStrategyPrompt(params: {
  config: AgentConfig
  unit: Unit
  job: JobOpening
  organizationProfile?: Record<string, unknown> | null
}): string {
  const { config, unit, job, organizationProfile } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, config.business_profile)
  return [
    `Você é um consultor de recrutamento sênior ajudando a unidade ${unit.name}${unit.region_city ? ` (${unit.region_city}${unit.region_state ? `/${unit.region_state}` : ''})` : ''} a resolver um problema real: a busca por candidatos para a vaga "${job.title}" esgotou o banco disponível sem candidatos suficientes.`,
    conversationLanguageDirective(unitDefaultLocale(unit)),
    `Perfil da vaga: ${JSON.stringify(job.profile)}.`,
    businessContext ?? '',
    'Gere de 2 a 4 sugestões concretas e acionáveis de estratégia de captação de currículos para este curso e região específicos (ex.: tráfego pago regional, parcerias com escolas/faculdades locais, feiras de emprego — mas só cite as que fizerem sentido para este caso, adapte ao contexto real em vez de listar todas).',
    'Seja específico sobre a região e o curso. Nunca invente nomes de instituições, empresas ou eventos reais que você não tem certeza que existem.',
    'Responda em texto corrido curto (até 6 linhas), sem markdown e sem listas numeradas, pronto para ser lido por um humano em um e-mail.',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Rótulos amigáveis dos campos do perfil, para as perguntas do intake. */
export function missingFieldLabels(missing: string[]): string[] {
  return missing
    .map((key) => PROFILE_FIELDS.find((f) => f.key === key)?.label)
    .filter((label): label is string => Boolean(label))
}
