import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isHumanInterventionActive, recordHumanIntervention, releaseHumanIntervention } from '@/lib/human-intervention'
import type { Unit } from '@/lib/types'

type LeadWithUnit = { id: string; unit_id: string; unit: Pick<Unit, 'id' | 'org_id' | 'name'> | null }

/**
 * POST /api/conversations/[lead_id]/intervention — botões "Assumir
 * atendimento" / "Devolver à automação" da Caixa de Entrada (Fase 4 do
 * redesign, docs/ux-audit-fase1-2026-08-19.md). Reusa a trava de 40min já
 * existente (lib/human-intervention.ts): "assumir" grava o mesmo evento
 * que a detecção automática via WhatsApp já gravava; "devolver" é a ação
 * nova que faltava (antes só expirava sozinha).
 *
 * Sessão de usuário (não service client): RLS de `leads`/`system_events`
 * já garante que só quem tem acesso à unidade do lead consegue disparar
 * isto (is_org_member(org_id) na policy de insert de system_events).
 */
export async function POST(request: Request, { params }: { params: Promise<{ lead_id: string }> }) {
  const { lead_id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const action = body?.action
  if (action !== 'assume' && action !== 'release') {
    return NextResponse.json({ error: 'action precisa ser "assume" ou "release".' }, { status: 400 })
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('id, unit_id, unit:units(id, org_id, name)')
    .eq('id', lead_id)
    .maybeSingle()

  const leadRow = lead as unknown as LeadWithUnit | null
  if (!leadRow?.unit) {
    return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 })
  }

  const unit = leadRow.unit as Unit

  if (action === 'assume') {
    await recordHumanIntervention(supabase, { unit, contactId: lead_id })
  } else {
    await releaseHumanIntervention(supabase, { unit, contactId: lead_id })
  }

  const active = await isHumanInterventionActive(supabase, { unitId: leadRow.unit_id, contactId: lead_id })
  return NextResponse.json({ ok: true, active })
}
