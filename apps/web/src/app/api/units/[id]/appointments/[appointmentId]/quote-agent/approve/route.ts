import { NextResponse } from 'next/server'
import { buildAgentState, loadAgentContext } from '@/lib/quote-team/agent/server'
import { assertNoCommercialFields, toTechnicianDraftView } from '@/lib/quote-team/visibility'

export const dynamic = 'force-dynamic'

/**
 * Aprovar e salvar a cotação TÉCNICA. Congela a versão (096: nunca mais é sobrescrita) e guarda o retrato aprovado. Aprovar NÃO conclui o
 * serviço: não muda o status da WO, não gera assinatura de execução e NADA é enviado ao cliente (a aprovação comercial é separada, do admin).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const loaded = await loadAgentContext(id, appointmentId)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { ctx } = loaded

  const { data: draftRow } = await ctx.db.from('quote_drafts').select('*').eq('appointment_id', ctx.appointment.id).eq('status', 'draft').order('version', { ascending: false }).limit(1).maybeSingle()
  const draft = draftRow as Record<string, unknown> | null
  if (!draft) return NextResponse.json({ error: 'Não há versão em rascunho para aprovar.' }, { status: 409 })
  if (draft.technical_check === 'blocked') return NextResponse.json({ error: 'Cotação bloqueada por informação crítica: corrija ou peça uma revisão antes de aprovar.' }, { status: 409 })

  const [items, options, labor, media] = await Promise.all([
    ctx.db.from('quote_items').select('*').eq('draft_id', String(draft.id)).order('position', { ascending: true }),
    ctx.db.from('quote_item_options').select('*').eq('draft_id', String(draft.id)),
    ctx.db.from('quote_labor_plan').select('*').eq('draft_id', String(draft.id)).maybeSingle(),
    ctx.db.from('quote_draft_media').select('*').eq('draft_id', String(draft.id)),
  ])
  // retrato aprovado = exatamente a visão do técnico (sem camada comercial) + quem aprovou
  const snapshot = { ...toTechnicianDraftView({ draft, items: (items.data as Record<string, unknown>[] | null) ?? [], options: (options.data as Record<string, unknown>[] | null) ?? [], labor: (labor.data as Record<string, unknown> | null) ?? null, media: (media.data as Record<string, unknown>[] | null) ?? [] }), approved_by_role: ctx.actor, approved_at: new Date().toISOString() }
  assertNoCommercialFields(snapshot)

  const { error } = await ctx.db.rpc('approve_quote_draft', { p_draft_id: String(draft.id), p_approved_by: ctx.appUser.id, p_snapshot: snapshot })
  if (error) return NextResponse.json({ error: error.message || 'Não foi possível aprovar.' }, { status: 409 })

  await ctx.db.from('quote_events').insert({ org_id: ctx.unit.org_id, unit_id: ctx.unit.id, appointment_id: ctx.appointment.id, draft_id: String(draft.id), job_id: (draft.job_id as string | null) ?? null, actor_id: ctx.appUser.id, actor_role: ctx.actor, type: 'technical_approved', diff: { version: draft.version }, visibility: 'technician' })
  return NextResponse.json(await buildAgentState(ctx))
}
