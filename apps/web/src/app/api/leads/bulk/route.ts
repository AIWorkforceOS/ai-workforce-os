import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import type { Lead, Unit } from '@/lib/types'

export const maxDuration = 60

// POST /api/leads/bulk — importação em massa (CSV colado no CRM) e
// DELETE /api/leads/bulk — exclusão em massa (limpar o pipeline pra
// recomeçar do zero) — pedido real de dono de conta com várias unidades
// que queria zerar os leads de teste e subir uma lista nova pro Sales
// Rep trabalhar. Mesmo motor de primeiro contato de /api/leads (POST
// único) — dispara pra cada lead novo, mas quem decide se manda mesmo é
// triggerFirstContact (respeita agente ativo, horário e daily_limit), então
// uma importação grande não vira um disparo em massa fora do limite diário.

const MAX_ROWS_PER_REQUEST = 300

type BulkLeadRow = {
  company_name?: unknown
  contact_name?: unknown
  phone?: unknown
  email?: unknown
  source?: unknown
  notes?: unknown
}

export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para criar leads.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const unitId: string | undefined = body?.unit_id
  const rows: BulkLeadRow[] | undefined = Array.isArray(body?.leads) ? body.leads : undefined
  const shouldTriggerFirstContact = body?.trigger_first_contact !== false

  if (!unitId || !rows || rows.length === 0) {
    return NextResponse.json({ error: 'unit_id e leads (lista) são obrigatórios.' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_ROWS_PER_REQUEST} leads por importação — divida a lista em partes.` },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: unit } = await supabase.from('units').select('*').eq('id', unitId).maybeSingle()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }
  const unitRow = unit as Unit

  let imported = 0
  let skippedDuplicates = 0
  let skippedInvalid = 0
  let contacted = 0

  for (const row of rows) {
    const companyName = typeof row.company_name === 'string' ? row.company_name.trim() : ''
    if (!companyName) {
      skippedInvalid += 1
      continue
    }
    const phone = typeof row.phone === 'string' ? row.phone.replace(/\D/g, '') || null : null

    if (phone) {
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('unit_id', unitRow.id)
        .eq('phone', phone)
        .maybeSingle()
      if (existing) {
        skippedDuplicates += 1
        continue
      }
    }

    const { data: insertedLead, error } = await supabase
      .from('leads')
      .insert({
        unit_id: unitRow.id,
        company_name: companyName,
        contact_name: typeof row.contact_name === 'string' && row.contact_name.trim() ? row.contact_name.trim() : null,
        phone,
        email: typeof row.email === 'string' && row.email.trim() ? row.email.trim() : null,
        source: typeof row.source === 'string' && row.source.trim() ? row.source.trim() : 'manual',
        notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : null,
        status: 'new',
      })
      .select()
      .single()

    if (error || !insertedLead) {
      skippedInvalid += 1
      continue
    }

    imported += 1
    const lead = insertedLead as Lead
    await syncLeadToSmarterCrm(supabase, unitRow, lead)
    if (shouldTriggerFirstContact) {
      const wasContacted = await triggerFirstContact(supabase, unitRow, lead)
      if (wasContacted) contacted += 1
    }
  }

  return NextResponse.json({ ok: true, imported, skipped_duplicates: skippedDuplicates, skipped_invalid: skippedInvalid, contacted })
}

// DELETE /api/leads/bulk — { lead_ids: string[] } exclui só os informados;
// { unit_id: string, delete_all: true } exclui TODOS os leads da unidade
// (confirmação em duas etapas fica na UI — aqui é só a execução).
export async function DELETE(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para excluir leads.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const leadIds: string[] | undefined = Array.isArray(body?.lead_ids) ? body.lead_ids : undefined
  const unitId: string | undefined = body?.unit_id
  const deleteAll: boolean = body?.delete_all === true

  const supabase = await createClient()

  if (deleteAll && unitId) {
    const { data, error } = await supabase.from('leads').delete().eq('unit_id', unitId).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: data?.length ?? 0 })
  }

  if (leadIds && leadIds.length > 0) {
    const { data, error } = await supabase.from('leads').delete().in('id', leadIds).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: data?.length ?? 0 })
  }

  return NextResponse.json({ error: 'Informe lead_ids ou (unit_id + delete_all).' }, { status: 400 })
}
