import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireClientProfileAdmin } from '@/lib/client-profiles/auth'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ decision: z.enum(['accept', 'refuse']), reason: z.string().trim().max(300).optional() })

/** Administrador aceita ou recusa uma ordem recebida por e-mail. Aceitar vira ordem normal; recusar cancela (fica registrada como recusada). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const auth = await requireClientProfileAdmin()
  if (!auth.ok) return auth.response
  const { id, appointmentId } = await params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const now = new Date().toISOString()
  const patch =
    parsed.data.decision === 'accept'
      ? { intake_status: null, intake_decided_at: now, intake_decided_by: auth.appUser.id }
      : { intake_status: 'refused', status: 'cancelled', cancelled_at: now, cancellation_reason: parsed.data.reason?.trim() || 'Ordem por e-mail recusada', intake_decided_at: now, intake_decided_by: auth.appUser.id }

  const supabase = await createClient()
  // .eq('intake_status','awaiting_accept'): só decide uma ordem que ainda espera aceite (duplo clique/duas abas não reabrem nada)
  const { data, error } = await supabase.from('appointments').update(patch).eq('id', appointmentId).eq('unit_id', id).eq('intake_status', 'awaiting_accept').select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível registrar a decisão.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Esta ordem não está aguardando aceite.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
