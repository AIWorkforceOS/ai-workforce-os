import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { triggerFirstContact } from '@/lib/leads/lead-intake'
import { syncLeadToSmarterCrm } from '@/lib/sales/smarter-crm'
import type { Lead, Unit } from '@/lib/types'

/**
 * POST /api/leads — criação manual de lead pelo CRM nativo (dashboard).
 * Antes disso o modal "Novo Lead" inseria direto no client e o lead
 * ficava parado em "novo" para sempre — passando pelo servidor, o mesmo
 * primeiro contato automático do Sales Rep que já roda para leads de
 * anúncio/intake (lib/leads/lead-intake.ts) passa a disparar aqui também.
 * Escrita via sessão (RLS decide o acesso à unidade), igual /api/jobs.
 */
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
  const companyName: string | undefined = body?.company_name?.trim()

  if (!unitId || !companyName) {
    return NextResponse.json({ error: 'unit_id e company_name são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createClient()

  // RLS: só devolve a unidade se o usuário tiver acesso a ela
  const { data: unit } = await supabase.from('units').select('*').eq('id', unitId).maybeSingle()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }
  const unitRow = unit as Unit

  const phone = typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') || null : null

  const { data: insertedLead, error } = await supabase
    .from('leads')
    .insert({
      unit_id: unitRow.id,
      company_name: companyName,
      contact_name: typeof body?.contact_name === 'string' && body.contact_name.trim() ? body.contact_name.trim() : null,
      phone,
      email: typeof body?.email === 'string' && body.email.trim() ? body.email.trim() : null,
      source: typeof body?.source === 'string' && body.source.trim() ? body.source.trim() : 'manual',
      notes: typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      status: 'new',
    })
    .select()
    .single()

  if (error || !insertedLead) {
    return NextResponse.json({ error: error?.message ?? 'Erro ao criar lead.' }, { status: 500 })
  }

  const lead = insertedLead as Lead
  await syncLeadToSmarterCrm(supabase, unitRow, lead)
  await triggerFirstContact(supabase, unitRow, lead)

  const { data: finalLead } = await supabase.from('leads').select('*').eq('id', lead.id).maybeSingle()

  return NextResponse.json({ ok: true, lead: finalLead ?? lead })
}
