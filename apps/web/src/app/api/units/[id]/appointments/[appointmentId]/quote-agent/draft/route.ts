import { NextResponse } from 'next/server'
import { applyDraftEdits, DraftEditError, draftEditSchema } from '@/lib/quote-team/agent/edit'
import { buildAgentState, loadAgentContext } from '@/lib/quote-team/agent/server'

export const dynamic = 'force-dynamic'

/** Edição da cotação técnica (materiais, quantidades, preços de compra, fornecedores, horas…). Só a versão em rascunho; a aprovada é imutável. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const loaded = await loadAgentContext(id, appointmentId)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { ctx } = loaded

  const parsed = draftEditSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })

  const { data: draft } = await ctx.db.from('quote_drafts').select('id, status').eq('appointment_id', ctx.appointment.id).in('status', ['draft']).order('version', { ascending: false }).limit(1).maybeSingle()
  const target = draft as { id: string } | null
  if (!target) return NextResponse.json({ error: 'Não há versão em rascunho para editar. Peça uma revisão para gerar uma nova versão.' }, { status: 409 })
  try {
    await applyDraftEdits(ctx.db, target.id, parsed.data, { id: ctx.appUser.id, role: ctx.actor })
  } catch (error) {
    if (error instanceof DraftEditError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
  return NextResponse.json(await buildAgentState(ctx))
}
