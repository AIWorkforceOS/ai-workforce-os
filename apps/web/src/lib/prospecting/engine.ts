import type { SupabaseClient } from '@supabase/supabase-js'
import { placeDetails, textSearch, type PlaceDetails } from '@/lib/google-places'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import { countSentToday } from '@/lib/conversation-engine'
import { logSystemEvent } from '@/lib/system-events'
import type { AgentConfig, Lead, ProspectingProfile, Unit } from '@/lib/types'

/**
 * Motor da prospecção autônoma do Sales Rep (migration 049): o cron de
 * prospecção decide sozinho o que buscar a cada rodada, SEMPRE lendo o
 * perfil de segmentação atual de agent_configs.prospecting_profile —
 * trocou a config hoje, a próxima rodada já busca com a config nova.
 * Não existe mais disparo manual de prospecção pela UI.
 */

/** Teto de LEADS NOVOS capturados por dia por unidade — separado do daily_limit de MENSAGENS. */
export const DAILY_CAPTURE_LIMIT = 15

export type ProspectingTarget = {
  /** termos de busca no Google Places (tipos de negócio, ou o setor do modo "empresas em geral") */
  terms: string[]
  /** "bairro, cidade, estado" — o que der pra montar com o perfil + cadastro da unidade */
  locationQuery: string
  /** cidade/estado para o registro em prospecting_jobs (colunas not null) */
  city: string
  state: string
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)
}

/**
 * Resolve o alvo de busca a partir do perfil ATUAL. Retorna null quando a
 * unidade ainda não tem perfil de segmentação utilizável (sem termos ou
 * sem nenhuma referência de região) — nesse caso o cron pula a unidade.
 */
export function resolveProspectingTarget(config: AgentConfig, unit: Unit): ProspectingTarget | null {
  const profile = (config.prospecting_profile ?? {}) as ProspectingProfile

  let terms: string[]
  if (profile.mode === 'general') {
    const sector = String(profile.general_sector ?? '').trim()
    terms = [sector ? `empresas de ${sector}` : 'empresas']
  } else {
    terms = cleanList(profile.business_types)
  }
  if (terms.length === 0) return null

  const region = String(profile.region ?? '').trim()
  const locationParts = [region, unit.region_city ?? '', unit.region_state ?? '']
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (locationParts.length === 0) return null

  return {
    terms,
    locationQuery: locationParts.join(', '),
    city: unit.region_city?.trim() || region || '—',
    state: unit.region_state?.trim() || '—',
  }
}

/** Data de hoje (YYYY-MM-DD) no fuso da operação — mesmo fuso usado em isWithinActiveHours. */
export function todayCaptureDate(timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
}

export async function countCapturedToday(supabase: SupabaseClient, unitId: string): Promise<number> {
  const { data } = await supabase
    .from('prospecting_daily_captures')
    .select('captured_count')
    .eq('unit_id', unitId)
    .eq('capture_date', todayCaptureDate())
    .maybeSingle()

  return (data as { captured_count: number } | null)?.captured_count ?? 0
}

async function addCapturedToday(supabase: SupabaseClient, unitId: string, delta: number): Promise<void> {
  if (delta <= 0) return
  const current = await countCapturedToday(supabase, unitId)
  await supabase.from('prospecting_daily_captures').upsert(
    {
      unit_id: unitId,
      capture_date: todayCaptureDate(),
      captured_count: current + delta,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'unit_id,capture_date' },
  )
}

export type UnitProspectingResult = {
  captured: number
  contacted: number
  skipped?: string
}

/**
 * Uma rodada de prospecção para uma unidade:
 *   1. Busca empresas no Google Places pelos termos/região do perfil atual,
 *      respeitando o teto de DAILY_CAPTURE_LIMIT capturas novas por dia —
 *      atingiu o teto, para na hora (inclusive de gastar chamadas à API).
 *   2. Dispara o primeiro contato (triggerFirstContact) para os leads
 *      capturados E para leads 'new' de rodadas anteriores que ficaram sem
 *      contato (ex.: daily_limit de mensagens tinha estourado) — é o que
 *      faz o Sales Rep "trabalhar o dia todo" em cima da config vigente.
 *      triggerFirstContact já respeita daily_limit e active_hours.
 *
 * `deadline` (epoch ms) corta o trabalho com folga antes do maxDuration da
 * função — o que ficar pendente é retomado na próxima rodada do dia.
 */
export async function runProspectingForUnit(params: {
  supabase: SupabaseClient
  unit: Unit
  config: AgentConfig
  apiKey: string
  deadline: number
}): Promise<UnitProspectingResult> {
  const { supabase, unit, config, apiKey, deadline } = params

  const target = resolveProspectingTarget(config, unit)
  if (!target) {
    return { captured: 0, contacted: 0, skipped: 'perfil de segmentação não configurado' }
  }

  const capturedToday = await countCapturedToday(supabase, unit.id)
  let remaining = Math.max(0, DAILY_CAPTURE_LIMIT - capturedToday)
  let captured = 0

  if (remaining > 0) {
    const { data: job } = await supabase
      .from('prospecting_jobs')
      .insert({
        unit_id: unit.id,
        city: target.city,
        state: target.state,
        keywords: target.terms,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    const jobId = (job as { id: string } | null)?.id
    let totalFound = 0

    try {
      for (const term of target.terms) {
        if (remaining <= 0 || Date.now() > deadline) break

        const results = await textSearch(`${term} em ${target.locationQuery}`, apiKey)
        totalFound += results.length
        if (results.length === 0) continue

        const byPlaceId = new Map(results.map((r) => [r.place_id, r]))
        const placeIds = Array.from(byPlaceId.keys())

        const { data: existingLeads } = await supabase
          .from('leads')
          .select('google_place_id')
          .eq('unit_id', unit.id)
          .in('google_place_id', placeIds)

        const existingPlaceIds = new Set(
          ((existingLeads as Pick<Lead, 'google_place_id'>[] | null) ?? []).map((l) => l.google_place_id),
        )

        // Só busca detalhes (telefone) do que cabe no teto do dia — o resto
        // fica para as próximas rodadas, sem gastar chamadas à toa.
        const newItems = Array.from(byPlaceId.values())
          .filter((item) => !existingPlaceIds.has(item.place_id))
          .slice(0, remaining)
        if (newItems.length === 0) continue

        const details = await Promise.all(
          newItems.map((item): Promise<PlaceDetails> => placeDetails(item.place_id, apiKey).catch(() => ({}))),
        )

        const rows = newItems.map((item, index) => ({
          unit_id: unit.id,
          company_name: item.name,
          phone: details[index]?.international_phone_number ?? details[index]?.formatted_phone_number ?? null,
          sector: term,
          city: target.city,
          state: target.state,
          source: 'google_maps',
          status: 'new',
          google_place_id: item.place_id,
        }))

        const { error: insertError } = await supabase.from('leads').insert(rows)
        if (insertError) throw new Error(insertError.message)

        captured += rows.length
        remaining -= rows.length
      }

      await addCapturedToday(supabase, unit.id, captured)

      if (jobId) {
        await supabase
          .from('prospecting_jobs')
          .update({
            status: 'done',
            total_found: totalFound,
            total_new: captured,
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido na prospecção.'
      await addCapturedToday(supabase, unit.id, captured)
      if (jobId) {
        await supabase
          .from('prospecting_jobs')
          .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
          .eq('id', jobId)
      }
      await logSystemEvent(supabase, {
        level: 'error',
        source: 'google_maps',
        eventType: 'prospecting_failed',
        message: `Prospecção automática falhou na unidade "${unit.name}": ${message}`,
        orgId: unit.org_id,
        unitId: unit.id,
        metadata: { job_id: jobId, terms: target.terms, location: target.locationQuery },
      })
    }
  }

  // ── Primeiro contato dos leads capturados (desta e de rodadas anteriores) ──
  const sentToday = await countSentToday(supabase, unit.id)
  const messageBudget = Math.max(0, config.daily_limit - sentToday)
  let contacted = 0

  if (messageBudget > 0) {
    const { data: pendingLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('unit_id', unit.id)
      .eq('source', 'google_maps')
      .eq('status', 'new')
      .or('phone.not.is.null,email.not.is.null')
      .order('created_at', { ascending: true })
      .limit(Math.min(messageBudget, DAILY_CAPTURE_LIMIT))

    let consecutiveFailures = 0
    for (const lead of (pendingLeads as Lead[] | null) ?? []) {
      if (Date.now() > deadline) break

      const ok = await triggerFirstContact(supabase, unit, lead as Lead)
      if (ok) {
        contacted += 1
        consecutiveFailures = 0
      } else {
        // triggerFirstContact devolve false tanto para "limite diário
        // estourou" quanto para falha pontual — depois de algumas seguidas,
        // não adianta insistir nesta rodada.
        consecutiveFailures += 1
        if (consecutiveFailures >= 3) break
      }
    }
  }

  return { captured, contacted }
}
