import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveQuoteTeamMode, type QuoteTeamMode } from './config'
import { QUOTE_STAGE_HANDLERS } from './handlers'
import { enqueueQuoteJob, type EnqueueResult } from './jobs'
import { SupabaseJobStore } from './job-store'
import { isPipelineReady } from './runner'

/** Mídias usadas no diagnóstico: só fotos já REGISTRADAS no servidor (antes/depois/atendimento). Vídeo e nota fiscal ficam de fora na v1. */
export function diagnosisMediaUrls(photos: { url: string; kind?: string }[] | null | undefined): string[] {
  return (photos ?? []).filter((p) => !p.kind || p.kind === 'before' || p.kind === 'after' || p.kind === 'service').map((p) => p.url)
}

/**
 * Chamado DEPOIS de a ordem ser salva (descrição + mídias já no servidor). Jamais lança e jamais atrasa o salvamento:
 * qualquer problema aqui só significa "sem análise automática" — a cotação manual segue como hoje.
 * Fase 2: enquanto o pipeline não tiver etapas registradas, retorna na hora, sem consultar o banco.
 */
export async function maybeEnqueueQuoteAnalysis(
  db: SupabaseClient,
  input: {
    unitId: string
    appointmentId: string
    orderStatus: string | null | undefined
    notes: string | null | undefined
    photos: { url: string; kind?: string }[] | null | undefined
    photoExceptionReason?: string | null
    createdBy?: string | null
  },
): Promise<EnqueueResult | { status: 'skipped'; reason: 'error' }> {
  try {
    if (!isPipelineReady(QUOTE_STAGE_HANDLERS)) return { status: 'skipped', reason: 'pipeline_not_ready' }
    if (input.orderStatus !== 'quote') return { status: 'skipped', reason: 'not_quote' }

    const { data: unit } = await db.from('units').select('id, org_id, quote_ai_team_mode').eq('id', input.unitId).maybeSingle()
    const row = unit as { id: string; org_id: string | null; quote_ai_team_mode?: string | null } | null
    // coluna ainda inexistente (migration 093 não aplicada) ou unidade sem empresa ⇒ desligado
    const mode: QuoteTeamMode = row?.org_id ? effectiveQuoteTeamMode(row.quote_ai_team_mode) : 'off'
    if (!row || !row.org_id || mode === 'off') return { status: 'skipped', reason: 'mode_off' }

    return await enqueueQuoteJob(
      { store: new SupabaseJobStore(db), pipelineReady: true },
      {
        unit: { id: row.id, org_id: row.org_id, mode },
        appointmentId: input.appointmentId,
        orderStatus: input.orderStatus,
        notes: input.notes ?? '',
        mediaUrls: diagnosisMediaUrls(input.photos),
        photoExceptionReason: input.photoExceptionReason ?? null,
        createdBy: input.createdBy ?? null,
      },
    )
  } catch (error) {
    console.error(`[quote-team] não foi possível enfileirar a análise: ${error instanceof Error ? error.message : String(error)}`)
    return { status: 'skipped', reason: 'error' }
  }
}
