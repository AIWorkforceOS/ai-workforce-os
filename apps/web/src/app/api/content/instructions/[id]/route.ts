import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { dateKeyIn, isValidDateKey, type ContentInstruction } from '@/lib/content/instructions'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['pause', 'resume', 'set_dates']),
  starts_on: z.string().optional(),
  ends_on: z.string().nullable().optional(),
})

/** Pausar, retomar ou ajustar o período de uma instrução. Posts já publicados nunca são tocados; os agendados só mudam se forem regerados. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })

  const { data: row } = await supabase.from('content_instructions').select('*').eq('id', id).maybeSingle()
  const current = row as ContentInstruction | null
  if (!current) return NextResponse.json({ error: 'Instrução não encontrada ou sem permissão.' }, { status: 404 })
  if (current.superseded_by) return NextResponse.json({ error: 'Esta instrução já foi substituída.' }, { status: 409 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  let action: 'paused' | 'resumed' | 'edited'
  if (body.data.action === 'pause') {
    patch.paused = true
    action = 'paused'
  } else if (body.data.action === 'resume') {
    patch.paused = false
    action = 'resumed'
  } else {
    const startsOn = body.data.starts_on ?? current.starts_on
    const endsOn = body.data.ends_on === undefined ? current.ends_on : body.data.ends_on
    if (!isValidDateKey(startsOn) || (endsOn !== null && !isValidDateKey(endsOn))) return NextResponse.json({ error: 'Data inválida.' }, { status: 422 })
    if (endsOn !== null && endsOn < startsOn) return NextResponse.json({ error: 'A data final não pode ser antes da inicial.' }, { status: 422 })
    patch.starts_on = startsOn
    patch.ends_on = endsOn
    action = 'edited'
  }

  const { data: updated, error } = await supabase.from('content_instructions').update(patch).eq('id', id).select('*').maybeSingle()
  if (error || !updated) return NextResponse.json({ error: 'Sem permissão para alterar esta instrução.' }, { status: 403 })

  await supabase.from('content_instruction_history').insert({
    instruction_id: id,
    org_id: current.org_id,
    unit_id: current.unit_id,
    action,
    actor: user.email,
    detail: { before: { paused: current.paused, starts_on: current.starts_on, ends_on: current.ends_on }, after: patch, today: dateKeyIn(new Date(), current.timezone) },
  })
  return NextResponse.json({ instruction: updated })
}
