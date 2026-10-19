import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUnitAdmin } from '@/lib/quote-team/agent/admin-guard'

export const dynamic = 'force-dynamic'

const schema = z.object({
  appointmentId: z.string().uuid(),
  diagnosis_verdict: z.enum(['correct', 'partial', 'incorrect']).nullable().optional(),
  diagnosis_confirmed_pt: z.string().max(2000).nullable().optional(),
  materials_correct: z.number().int().min(0).max(200).optional(),
  materials_incorrect: z.number().int().min(0).max(200).optional(),
  hours_suggested: z.number().min(0).max(500).nullable().optional(),
  hours_final: z.number().min(0).max(500).nullable().optional(),
  manual_interventions: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(4000).nullable().optional(),
})

/** Avaliação humana do piloto por cotação (diagnóstico certo/parcial/errado, materiais certos/errados, horas sugeridas × ajustadas). SOMENTE ADMIN. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireUnitAdmin(id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }, { status: 400 })
  const { db, unit, appUser } = guard.ctx
  const { appointmentId, ...fields } = parsed.data
  const { data: appt } = await db.from('appointments').select('id').eq('id', appointmentId).eq('unit_id', unit.id).maybeSingle()
  if (!appt) return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })
  const { data: draft } = await db.from('quote_drafts').select('id').eq('appointment_id', appointmentId).order('version', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await db
    .from('quote_pilot_reviews')
    .upsert({ org_id: unit.org_id, unit_id: unit.id, appointment_id: appointmentId, draft_id: (draft as { id: string } | null)?.id ?? null, created_by: appUser.id, ...fields }, { onConflict: 'appointment_id' })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ review: data })
}
