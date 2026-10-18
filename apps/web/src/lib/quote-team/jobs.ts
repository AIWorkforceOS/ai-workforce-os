import { createHash } from 'node:crypto'
import { MAX_JOBS_PER_APPOINTMENT_PER_DAY, QUOTE_DEFAULT_BUDGET_USD, STANDARD_PHOTO_TARGET, type QuoteTeamMode } from './config'
import type { JobStore, QuoteJobRow } from './job-store'

/** Chave de idempotência: mesma ordem + mesmas notas + mesmas mídias registradas + mesma regra comercial ⇒ mesmo job (nunca análise duplicada). `nonce` só para reanálise pedida de propósito. */
export function buildIdempotencyKey(input: { appointmentId: string; notes: string; mediaUrls: string[]; rateCardId?: string | null; nonce?: string | null }): string {
  const normalized = JSON.stringify({
    a: input.appointmentId,
    n: input.notes.trim().replace(/\s+/g, ' '),
    m: [...new Set(input.mediaUrls)].sort(),
    r: input.rateCardId ?? null,
    x: input.nonce ?? null,
  })
  return createHash('sha256').update(normalized).digest('hex')
}

export type PhotoPolicy = {
  photoCount: number
  /** Só há análise visual com foto; sem foto a IA só organiza o texto e NÃO alega diagnóstico visual. */
  visualAnalysis: boolean
  belowStandard: boolean
  missing: number
  exceptionAccepted: boolean
  notes_pt: string[]
}

/** Padrão de 5 fotos, exceção justificada; NUNCA bloqueia (só orienta). */
export function decidePhotoPolicy(input: { photoCount: number; exceptionReason?: string | null }): PhotoPolicy {
  const photoCount = Math.max(0, Math.floor(input.photoCount))
  const missing = Math.max(0, STANDARD_PHOTO_TARGET - photoCount)
  const exceptionAccepted = Boolean(input.exceptionReason?.trim())
  const notes: string[] = []
  if (photoCount === 0) notes.push('Sem fotografias: a análise organiza apenas o texto e não faz diagnóstico visual.')
  else if (missing > 0 && !exceptionAccepted) notes.push(`Faltam ${missing} foto(s) para o padrão de ${STANDARD_PHOTO_TARGET}: visão geral, problema de perto, etiqueta/modelo, contexto/acesso e medida/escala — ou informe o motivo.`)
  else if (missing > 0 && exceptionAccepted) notes.push(`Menos de ${STANDARD_PHOTO_TARGET} fotos, com justificativa do técnico.`)
  return { photoCount, visualAnalysis: photoCount > 0, belowStandard: missing > 0, missing, exceptionAccepted, notes_pt: notes }
}

export type EnqueueInput = {
  unit: { id: string; org_id: string; mode: QuoteTeamMode }
  appointmentId: string
  /** service_order_status da ordem salva — só 'quote' dispara. */
  orderStatus: string | null | undefined
  notes: string
  /** SOMENTE mídias já registradas no servidor (service_order_photos). */
  mediaUrls: string[]
  photoExceptionReason?: string | null
  rateCardId?: string | null
  createdBy?: string | null
  trigger?: 'save' | 'manual' | 'reanalyze'
  nonce?: string | null
  parentJobId?: string | null
  budgetUsd?: number
}

export type EnqueueResult =
  | { status: 'skipped'; reason: 'mode_off' | 'not_quote' | 'no_content' | 'pipeline_not_ready' | 'rate_limited' }
  | { status: 'enqueued' | 'existing'; job: QuoteJobRow }

export async function enqueueQuoteJob(deps: { store: JobStore; pipelineReady: boolean }, input: EnqueueInput): Promise<EnqueueResult> {
  if (input.unit.mode === 'off') return { status: 'skipped', reason: 'mode_off' }
  if (input.orderStatus !== 'quote') return { status: 'skipped', reason: 'not_quote' }
  if (!deps.pipelineReady) return { status: 'skipped', reason: 'pipeline_not_ready' }
  if (!input.notes.trim() && input.mediaUrls.length === 0) return { status: 'skipped', reason: 'no_content' }

  const policy = decidePhotoPolicy({ photoCount: input.mediaUrls.length, exceptionReason: input.photoExceptionReason })
  const key = buildIdempotencyKey({ appointmentId: input.appointmentId, notes: input.notes, mediaUrls: input.mediaUrls, rateCardId: input.rateCardId, nonce: input.nonce })
  // Já existe análise com exatamente esta entrada? devolve a mesma (reenvio/salvar duas vezes nunca duplica nem gasta de novo).
  const existing = await deps.store.findByIdempotencyKey(key)
  if (existing) return { status: 'existing', job: existing }
  // Trava contra reanálise em loop: no máximo N análises novas por ordem por dia.
  if ((await deps.store.countForAppointmentSince(input.appointmentId, Date.now() - 24 * 3600 * 1000)) >= MAX_JOBS_PER_APPOINTMENT_PER_DAY) return { status: 'skipped', reason: 'rate_limited' }

  const { job, created } = await deps.store.insert({
    org_id: input.unit.org_id,
    unit_id: input.unit.id,
    appointment_id: input.appointmentId,
    idempotency_key: key,
    trigger_source: input.trigger ?? 'save',
    mode: input.unit.mode === 'live' ? 'live' : 'shadow',
    // só ids/URLs/textos da ordem — NUNCA valores comerciais (tarifas, markup…)
    input_snapshot: { notes: input.notes.trim(), media_urls: input.mediaUrls, rate_card_id: input.rateCardId ?? null, photo_policy: policy },
    photo_count: policy.photoCount,
    photo_exception_reason: input.photoExceptionReason?.trim() || null,
    budget_usd: input.budgetUsd ?? QUOTE_DEFAULT_BUDGET_USD,
    created_by: input.createdBy ?? null,
    parent_job_id: input.parentJobId ?? null,
  })
  return { status: created ? 'enqueued' : 'existing', job }
}
