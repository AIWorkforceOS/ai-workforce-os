import type { SupabaseClient } from '@supabase/supabase-js'
import { QUOTE_DEFAULT_BUDGET_USD, QUOTE_MAX_ROUNDS, type QuoteTeamMode } from '../config'
import type { JobStatus } from '../contracts'
import { buildIdempotencyKey, decidePhotoPolicy } from '../jobs'
import type { JobStore, QuoteJobRow } from '../job-store'
import type { RunnerHooks } from '../runner'
import type { AgentSnapshot, ConversationTurn } from './context'
import { persistDraftFromJob } from './draft-writer'
import { addQuoteMessage, questionMessageFromPending } from './messages'

/**
 * CICLO DE VIDA DA COTAÇÃO COM IA — UM job por WO (o teto de US$ 0,60 é da cotação inteira, somando diagnóstico, perguntas,
 * revisões e buscas). A análise começa SÓ quando o técnico clica em "Gerar Cotação com IA" (nunca por selecionar "Cotação").
 */
export type StartInput = {
  unit: { id: string; org_id: string; mode: QuoteTeamMode }
  appointmentId: string
  orderStatus: string | null | undefined
  notes: string
  /** SOMENTE mídias já registradas e presentes no Storage. */
  mediaUrls: string[]
  photoExceptionReason?: string | null
  createdBy?: string | null
  budgetUsd?: number
}

export type StartResult =
  | { status: 'started' | 'retried'; job: QuoteJobRow }
  | { status: 'already_running' | 'needs_input' | 'already_done'; job: QuoteJobRow }
  | { status: 'skipped'; reason: 'mode_off' | 'not_quote' | 'no_content' | 'budget_exhausted' }

const REOPEN_FROM_FAILED: JobStatus[] = ['failed']

export async function startQuoteAnalysis(deps: { store: JobStore }, input: StartInput): Promise<StartResult> {
  if (input.unit.mode === 'off') return { status: 'skipped', reason: 'mode_off' }
  if (input.orderStatus !== 'quote') return { status: 'skipped', reason: 'not_quote' }
  if (!input.notes.trim() && input.mediaUrls.length === 0) return { status: 'skipped', reason: 'no_content' }

  const existing = await deps.store.findByAppointment(input.appointmentId)
  const policy = decidePhotoPolicy({ photoCount: input.mediaUrls.length, exceptionReason: input.photoExceptionReason })
  const snapshotFor = (prev: AgentSnapshot | null): AgentSnapshot => ({ ...(prev ?? {}), notes: input.notes.trim(), media_urls: [...new Set([...(prev?.media_urls ?? []), ...input.mediaUrls])], photo_policy: policy, conversation: prev?.conversation ?? [] })

  if (!existing) {
    const { job } = await deps.store.insert({
      org_id: input.unit.org_id,
      unit_id: input.unit.id,
      appointment_id: input.appointmentId,
      idempotency_key: buildIdempotencyKey({ appointmentId: input.appointmentId, notes: '', mediaUrls: [] }), // uma por WO
      trigger_source: 'manual',
      mode: input.unit.mode === 'live' ? 'live' : 'shadow',
      input_snapshot: snapshotFor(null) as Record<string, unknown>,
      photo_count: policy.photoCount,
      photo_exception_reason: input.photoExceptionReason?.trim() || null,
      budget_usd: input.budgetUsd ?? QUOTE_DEFAULT_BUDGET_USD,
      created_by: input.createdBy ?? null,
    })
    return { status: 'started', job }
  }
  if (existing.status === 'queued' || existing.status === 'running') return { status: 'already_running', job: existing }
  if (existing.status === 'needs_input') return { status: 'needs_input', job: existing }
  if (existing.status === 'budget_exhausted') return { status: 'skipped', reason: 'budget_exhausted' }
  if (existing.status === 'completed') return { status: 'already_done', job: existing }
  // failed (ou cancelled): tentar de novo reaproveita o MESMO job (gasto acumulado; etapas já gravadas não são refeitas)
  const reopened = await deps.store.reopen(existing.id, [...REOPEN_FROM_FAILED, 'cancelled'], { input_snapshot: snapshotFor(existing.input_snapshot as AgentSnapshot) as Record<string, unknown>, photo_count: policy.photoCount, pending_items: [] })
  return reopened ? { status: 'retried', job: reopened } : { status: 'already_running', job: (await deps.store.get(existing.id)) ?? existing }
}

export type TechnicianInput = {
  job: QuoteJobRow
  kind: 'answer' | 'revision_request'
  body: string
  /** Fotos novas já registradas na WO e presentes no Storage. */
  newMediaUrls: string[]
  /** "Continuar sem essas informações": o agente deixa de bloquear a análise com perguntas. */
  skipQuestions?: boolean
  now?: () => Date
}

export type TechnicianInputResult = { status: 'reopened'; job: QuoteJobRow } | { status: 'rejected'; reason: 'max_rounds' | 'budget_exhausted' | 'busy' | 'not_reopenable' | 'empty' }

/** Resposta ao agente ou pedido de revisão: reabre o MESMO job (orçamento acumulado), reanalisa com a conversa e gera uma nova versão. */
export async function submitTechnicianInput(deps: { store: JobStore }, input: TechnicianInput): Promise<TechnicianInputResult> {
  const { job } = input
  if (!input.body.trim() && input.newMediaUrls.length === 0 && !input.skipQuestions) return { status: 'rejected', reason: 'empty' }
  if (job.status === 'queued' || job.status === 'running') return { status: 'rejected', reason: 'busy' }
  if (job.status === 'budget_exhausted') return { status: 'rejected', reason: 'budget_exhausted' }
  if (job.status !== 'needs_input' && job.status !== 'completed' && job.status !== 'failed') return { status: 'rejected', reason: 'not_reopenable' }
  if (job.rounds >= QUOTE_MAX_ROUNDS) return { status: 'rejected', reason: 'max_rounds' }

  const prev = (job.input_snapshot ?? {}) as AgentSnapshot
  const turn: ConversationTurn = {
    role: 'technician',
    kind: input.kind,
    body: input.body.trim() || (input.skipQuestions ? 'Não tenho essas informações. Continue sem elas.' : '(somente fotos)'),
    at: (input.now ?? (() => new Date()))().toISOString(),
    media_count: input.newMediaUrls.length,
  }
  const snapshot: AgentSnapshot = {
    ...prev,
    conversation: [...(prev.conversation ?? []), turn],
    media_urls: [...new Set([...(prev.media_urls ?? []), ...input.newMediaUrls])],
    no_more_questions: Boolean(prev.no_more_questions || input.skipQuestions),
  }
  const reopened = await deps.store.reopen(job.id, ['needs_input', 'completed', 'failed'], {
    input_snapshot: snapshot as Record<string, unknown>,
    step_results: {}, // reanalisa tudo com a conversa e as fotos novas (cada chamada continua dentro do MESMO teto da cotação)
    pending_items: [],
    rounds: job.rounds + 1,
    stage: 'queued',
    photo_count: snapshot.media_urls?.length ?? job.photo_count,
  })
  return reopened ? { status: 'reopened', job: reopened } : { status: 'rejected', reason: 'busy' }
}

/**
 * Ganchos do runner: ao terminar, grava a nova versão da cotação (concluído / sem orçamento), ou a pergunta do agente (esperando
 * informação). Se gravar falhar, o job vai para "failed" (retomável: as etapas ficam guardadas e "Tentar de novo" só regrava).
 */
export function createRunnerHooks(deps: { db: SupabaseClient; store: JobStore }): RunnerHooks {
  return {
    async onUsage(job, e) {
      await deps.db.from('api_usage_events').insert({
        org_id: job.org_id,
        unit_id: job.unit_id,
        provider: 'openai',
        endpoint: `quote-agent:${e.label.split(':')[0]}`,
        model: null,
        input_tokens: e.tokensIn,
        output_tokens: e.tokensOut,
        total_tokens: e.tokensIn + e.tokensOut,
        request_count: 1,
        estimated_cost_usd: e.actualUsd,
        metadata: { quote_job_id: job.id, appointment_id: job.appointment_id, label: e.label },
      })
    },
    async onFinish(job, kind) {
      try {
        if (kind === 'needs_input') {
          const q = questionMessageFromPending(job.pending_items)
          await addQuoteMessage(deps.db, {
            org_id: job.org_id,
            unit_id: job.unit_id,
            appointment_id: job.appointment_id,
            job_id: job.id,
            role: 'agent',
            kind: 'question',
            body: q?.body ?? 'Preciso de mais informações para continuar.',
            questions: q?.questions ?? [],
            round: job.rounds,
          })
          return
        }
        if (kind === 'completed' || kind === 'budget_exhausted') {
          const { draftId, version } = await persistDraftFromJob(deps.db, job)
          await addQuoteMessage(deps.db, {
            org_id: job.org_id,
            unit_id: job.unit_id,
            appointment_id: job.appointment_id,
            job_id: job.id,
            draft_id: draftId,
            role: 'system',
            kind: 'status',
            body: kind === 'budget_exhausted' ? `Versão ${version} gerada com o que foi possível: o orçamento de IA desta cotação acabou. Complete manualmente o que faltar.` : `Versão ${version} da cotação pronta para sua revisão.`,
            round: job.rounds,
          })
        }
      } catch (error) {
        await deps.store.update(job.id, { status: 'failed', error_code: 'draft_write_failed', error_message: (error instanceof Error ? error.message : String(error)).slice(0, 500), finished_at: new Date().toISOString() })
        throw error
      }
    },
  }
}
