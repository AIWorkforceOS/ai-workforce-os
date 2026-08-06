import type { SupabaseClient } from '@supabase/supabase-js'
import { generateChatReply, generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'
import { sendTechnicalAlertEmail } from '@/lib/email'
import { logSystemEvent } from '@/lib/system-events'
import { buildAccountContext } from '@/lib/chat/account-context'
import { unitDefaultLocale } from '@/lib/i18n/config'
import type { Unit } from '@/lib/types'

// Funcionário TI interno — não entra no catálogo de vendas (sem
// agent_configs, sem tela de contratação): é uma capacidade interna,
// chamada por código, atuando de ponta a ponta pra quem já usa a
// plataforma Alizo. Escopo deliberadamente mais restrito que a Kai (ver
// lib/chat/actions.ts, que já executa ações reais de baixo risco): o TI
// é só leitura + e-mail, NUNCA executa nada que altere dado — pedido
// explícito do produto ("não mexe em nada"). Chamado de forma síncrona
// pela Recepcionista (lib/receptionist/engine.ts) pra devolver, na mesma
// mensagem, uma resposta já completa em vez do handoff genérico "vou
// verificar com o time".

export type TechSupportOutcome = { answer: string; filedIncident: boolean }

type TechSupportClassification = {
  kind?: 'guidance' | 'error_report'
  reported_problem?: string
}

function buildClassifierPrompt(): string {
  return [
    'Você está classificando a mensagem de alguém que usa a plataforma AI Workforce OS (Alizo) e tem uma dúvida ou relatou um problema sobre o USO DA PRÓPRIA PLATAFORMA (não é sobre o negócio dela, é sobre o sistema Alizo em si). Não escreva a resposta aqui — só classifique.',
    'Responda SOMENTE um JSON válido: {"kind": "guidance"|"error_report", "reported_problem": string}.',
    '"guidance" = a pessoa só não sabe onde ou como fazer algo que a plataforma já suporta normalmente (dúvida de uso: "como eu conecto...", "onde fica...", "como faço pra..."). "error_report" = a pessoa relatou algo que não funcionou como esperado, uma mensagem de erro, ou um comportamento estranho/falho do sistema — mesmo sem saber o motivo técnico.',
    '"reported_problem" = um resumo curto (1-2 frases), na perspectiva da própria pessoa, do que ela perguntou ou relatou.',
  ].join(' ')
}

function buildGuidancePrompt(params: { accountContext: string | null; locale: 'pt' | 'en' }): string {
  const { accountContext, locale } = params
  return [
    'Você é o TI interno da Alizo (AI Workforce OS) — um técnico consultivo, direto e prestativo, orientando quem já usa a plataforma sobre como fazer algo nela.',
    'Você NUNCA executa nenhuma ação (não reconecta, não reconfigura, não corrige nada por conta própria) — sua função é só orientar com precisão, o passo a passo exato, usando o contexto real da conta abaixo quando ele ajudar a dar um caminho específico em vez de genérico.',
    accountContext ?? '',
    'Responda em texto corrido, pronto para ser incorporado numa mensagem final (não é um resumo interno, não é uma lista de bullets em markdown) — direto ao ponto, sem se apresentar nem assinar.',
    locale === 'en' ? 'Answer in English.' : 'Responda em português.',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildHypothesisPrompt(params: { accountContext: string | null; eventsSummary: string }): string {
  return [
    'Você é o TI interno da Alizo analisando um problema relatado por quem usa a plataforma AI Workforce OS, para preparar um relatório técnico que o time humano vai usar pra resolver — você NUNCA tenta corrigir nada, só descreve uma hipótese de causa provável.',
    params.accountContext ?? '',
    `Eventos técnicos recentes registrados para esta unidade (mais recentes primeiro):\n${params.eventsSummary}`,
    'Responda em texto corrido (não JSON), em português, com uma hipótese objetiva e curta (2-4 frases) da causa mais provável — cite os eventos acima se algum for claramente relevante, ou diga que não há evento técnico correspondente registrado se não houver nada relevante. Não invente uma causa que os dados não sustentam.',
  ]
    .filter(Boolean)
    .join(' ')
}

function acknowledgmentText(locale: 'pt' | 'en'): string {
  return locale === 'en'
    ? "I've logged this issue with all the details and already notified the technical team — they'll look into the cause and get it fixed as soon as possible."
    : 'Registrei esse problema agora com todos os detalhes e já avisei o time técnico — eles vão analisar a causa e resolver o quanto antes.'
}

async function fetchRecentUnitEvents(
  supabase: SupabaseClient,
  unit: Unit,
): Promise<{ level: string; source: string; event_type: string; message: string }[]> {
  const { data } = await supabase
    .from('system_events')
    .select('level, source, event_type, message, created_at')
    .eq('unit_id', unit.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (data as { level: string; source: string; event_type: string; message: string }[] | null) ?? []
}

async function handleErrorReport(
  supabase: SupabaseClient,
  apiKey: string,
  unit: Unit,
  reportedProblem: string,
): Promise<TechSupportOutcome> {
  const [accountContext, recentEvents] = await Promise.all([
    buildAccountContext(supabase, unit.org_id),
    fetchRecentUnitEvents(supabase, unit),
  ])

  const eventsSummary =
    recentEvents.length > 0
      ? recentEvents.map((e) => `[${e.level}/${e.source}/${e.event_type}] ${e.message}`).join('\n')
      : 'nenhum evento técnico recente registrado para esta unidade'

  const hypothesis = await generateChatReply({
    apiKey,
    systemPrompt: buildHypothesisPrompt({ accountContext, eventsSummary }),
    history: [{ role: 'user', content: `Problema relatado: ${reportedProblem}` }],
  })

  await logSystemEvent(supabase, {
    level: 'warning',
    source: 'ti',
    eventType: 'ti_incident_reported',
    message: `Problema relatado na unidade "${unit.name}": ${reportedProblem}`,
    orgId: unit.org_id,
    unitId: unit.id,
    metadata: { hypothesis },
  })

  if (unit.org_id) {
    const { data: org } = await supabase.from('organizations').select('owner_email').eq('id', unit.org_id).maybeSingle()
    const ownerEmail = (org as { owner_email: string | null } | null)?.owner_email

    if (ownerEmail) {
      const emailResult = await sendTechnicalAlertEmail({
        to: ownerEmail,
        unitName: unit.name,
        problem: `Relatado pelo cliente: "${reportedProblem}"`,
        impact: `Hipótese de causa raiz (gerada pelo TI interno): ${hypothesis}`,
      })
      if (!emailResult.ok) {
        await logSystemEvent(supabase, {
          level: 'error',
          source: 'resend',
          eventType: 'ti_incident_email_failed',
          message: `Incidente do TI interno registrado, mas o e-mail de aviso falhou: ${emailResult.error ?? 'erro desconhecido'}`,
          orgId: unit.org_id,
          unitId: unit.id,
        })
      }
    }
  }

  return { answer: acknowledgmentText(unitDefaultLocale(unit)), filedIncident: true }
}

/**
 * Responde uma pergunta/relato sobre o uso da plataforma Alizo — chamada
 * síncrona (sem fire-and-forget), pra quem chama incorporar a resposta
 * completa numa única mensagem ao cliente. Nunca executa nenhuma ação que
 * altere dado; no modo "error_report" nunca tenta corrigir nada, só
 * registra e avisa um humano por e-mail. Lança em falha real (sem
 * OPENAI_API_KEY, erro da OpenAI) — quem chama decide o fallback.
 */
export async function answerTechSupportQuestion(
  supabase: SupabaseClient,
  params: { unit: Unit; question: string },
): Promise<TechSupportOutcome> {
  const { unit, question } = params
  const apiKey = getOpenAIApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY não está configurada — o TI interno não consegue responder.')

  const classification = await generateStructuredReply<TechSupportClassification>({
    apiKey,
    systemPrompt: buildClassifierPrompt(),
    history: [{ role: 'user', content: question }],
    maxTokens: 300,
  })

  const reportedProblem = classification.reported_problem?.trim() || question

  if (classification.kind === 'error_report') {
    return handleErrorReport(supabase, apiKey, unit, reportedProblem)
  }

  const accountContext = await buildAccountContext(supabase, unit.org_id)
  const answer = await generateChatReply({
    apiKey,
    systemPrompt: buildGuidancePrompt({ accountContext, locale: unitDefaultLocale(unit) }),
    history: [{ role: 'user', content: question }],
  })

  return { answer, filedIncident: false }
}
