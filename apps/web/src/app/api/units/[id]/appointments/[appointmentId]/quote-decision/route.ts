import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'
import { decisionPatch, quoteDecisionSchema } from '@/lib/clients/quote-decision'

export const dynamic = 'force-dynamic'

/**
 * Registra a decisão do cliente sobre a cotação da ordem (aprovada/recusada) ou volta para "aguardando". Só administrador; só ordem em status
 * Cotação. Não altera valores, status da ordem, financeiro nem PDF — é apenas o registro da decisão.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id, appointmentId } = await params
  const parsed = quoteDecisionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })

  const supabase = await createClient()
  const { data: appt } = await supabase.from('appointments').select('id, service_order_status').eq('id', appointmentId).eq('unit_id', id).maybeSingle()
  if (!appt) return NextResponse.json({ error: 'Ordem não encontrada.' }, { status: 404 })
  if ((appt as { service_order_status: string | null }).service_order_status !== 'quote') return NextResponse.json({ error: 'Só ordens em status Cotação têm decisão do cliente.' }, { status: 409 })

  const { data, error } = await supabase
    .from('appointments')
    .update(decisionPatch(parsed.data.decision, parsed.data.note, auth.appUser.id))
    .eq('id', appointmentId)
    .eq('unit_id', id)
    .select('id, quote_decision, quote_decided_at')
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Não foi possível registrar a decisão.' }, { status: 500 })
  return NextResponse.json({ ok: true, appointment: data })
}
