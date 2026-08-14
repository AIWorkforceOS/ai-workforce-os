import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listFranquiaCrmLeads,
  getSmarterFranquiaCrmToken,
  getSmarterFranquiaCrmUnitId,
  type FranquiaCrmLead,
} from '@/lib/sales/smarter-crm'
import { logSystemEvent } from '@/lib/system-events'

/**
 * Ingestão dos leads parados no CRM de Franquias da Smarter (376 leads,
 * 375 nunca contatados — achado em 2026-08-14) pra dentro da fila de
 * trabalho do Sales Rep da Alizo.
 *
 * DELIBERADAMENTE NÃO dispara nenhum contato automático: os leads entram
 * com status 'imported_pending_review' (não 'new'), que `triggerFirstContact`
 * (lib/leads/lead-intake.ts) e o motor de prospecção (lib/prospecting/engine.ts)
 * ignoram — ambos só pegam leads com status='new'. Isso é proposital: o
 * pitch pra quem quer abrir uma franquia é bem diferente do pitch atual do
 * SDR (vender software de gestão pra empresa cliente), e essa decisão de
 * conteúdo ainda não foi tomada. Ver [[project_alizo_franquia_crm_bridge]].
 *
 * Dedup: reaproveita a coluna leads.external_lead_id (+ índice único
 * (unit_id, source, external_lead_id), migration 050 — criado originalmente
 * pra idempotência de webhook de anúncio, mas serve igual bem aqui: é
 * literalmente "id externo do lead num provedor externo") em vez de criar
 * coluna/migration nova.
 */

export const FRANQUIA_CRM_SOURCE = 'smarter_franquia_crm'

export type FranquiaCrmSyncResult = {
  ok: boolean
  imported: number
  updated: number
  skipped: number
  errors: number
  reason?: string
}

function buildNotes(lead: FranquiaCrmLead): string {
  const parts = [
    `[CRM de Franquias da Smarter] etapa: ${lead.etapa} · situação: ${lead.situacao}`,
    lead.cidade || lead.estado ? `Região: ${[lead.cidade, lead.estado].filter(Boolean).join('/')}` : null,
    lead.leadFrio ? 'Lead frio (importado com dados antigos, do lado da Smarter).' : null,
    lead.ultimaNota ? `Última nota (Smarter): ${lead.ultimaNota.texto}` : null,
  ]
  return parts.filter(Boolean).join('\n')
}

/**
 * Busca uma página de leads "parados" (?stale=true) e faz upsert na tabela
 * `leads` da Alizo, escopados à unidade configurada em
 * SMARTER_FRANQUIA_CRM_UNIT_ID. Idempotente — pode rodar todo dia sem
 * duplicar (upsert por unit_id+source+external_lead_id) nem reverter uma
 * revisão humana já feita (só faz INSERT novo; nunca sobrescreve o status
 * de um lead que já existe, ver comentário no upsert abaixo).
 */
export async function syncFranquiaCrmLeads(supabase: SupabaseClient): Promise<FranquiaCrmSyncResult> {
  const token = getSmarterFranquiaCrmToken()
  const unitId = getSmarterFranquiaCrmUnitId()

  if (!token || !unitId) {
    return { ok: true, imported: 0, updated: 0, skipped: 0, errors: 0, reason: 'não configurado (token ou unit id ausente)' }
  }

  let imported = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  let cursor: string | undefined
  let guard = 0 // corta loop caso a paginação nunca termine (defensivo)

  try {
    do {
      guard += 1
      const page = await listFranquiaCrmLeads(token, { stale: true, cursor, limit: 100 })

      for (const franquiaLead of page.leads) {
        try {
          const { data: existing } = await supabase
            .from('leads')
            .select('id, status')
            .eq('unit_id', unitId)
            .eq('source', FRANQUIA_CRM_SOURCE)
            .eq('external_lead_id', franquiaLead.id)
            .maybeSingle()

          if (existing) {
            // Já existe — só atualiza os dados de "espelho" (nome/contato/
            // notas), NUNCA o status: se um humano já mudou o status daqui
            // pra outro lugar (ex. começou a trabalhar o lead), uma nova
            // sincronização não pode reverter isso pra trás.
            await supabase
              .from('leads')
              .update({
                company_name: franquiaLead.nomeCompleto,
                phone: franquiaLead.telefone,
                email: franquiaLead.email,
                city: franquiaLead.cidade,
                state: franquiaLead.estado,
                notes: buildNotes(franquiaLead),
                updated_at: new Date().toISOString(),
              })
              .eq('id', (existing as { id: string }).id)
            updated += 1
            continue
          }

          const { error: insertError } = await supabase.from('leads').insert({
            unit_id: unitId,
            company_name: franquiaLead.nomeCompleto,
            contact_name: franquiaLead.nomeCompleto,
            phone: franquiaLead.telefone,
            email: franquiaLead.email,
            city: franquiaLead.cidade,
            state: franquiaLead.estado,
            sector: 'interesse_em_franquia',
            source: FRANQUIA_CRM_SOURCE,
            status: 'imported_pending_review',
            external_lead_id: franquiaLead.id,
            notes: buildNotes(franquiaLead),
          })

          if (insertError) {
            errors += 1
            continue
          }
          imported += 1
        } catch {
          errors += 1
        }
      }

      cursor = page.pagination.hasMore ? page.pagination.nextCursor ?? undefined : undefined
    } while (cursor && guard < 20)

    await logSystemEvent(supabase, {
      level: errors > 0 ? 'warning' : 'info',
      source: 'smarter_franquia_crm',
      eventType: 'smarter_franquia_crm_sync_run',
      message: `Sincronização do CRM de Franquias: ${imported} importado(s), ${updated} atualizado(s), ${errors} erro(s).`,
      unitId,
      metadata: { imported, updated, skipped, errors },
    })

    return { ok: true, imported, updated, skipped, errors }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido.'
    await logSystemEvent(supabase, {
      level: 'error',
      source: 'smarter_franquia_crm',
      eventType: 'smarter_franquia_crm_sync_failed',
      message: `Sincronização do CRM de Franquias falhou: ${message}`,
      unitId,
    })
    return { ok: false, imported, updated, skipped, errors: errors + 1, reason: message }
  }
}
