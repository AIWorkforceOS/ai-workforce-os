import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  dateKeyIn,
  detectConflicts,
  guardInstruction,
  parseInterpretation,
  postsNeedingReview,
  type ContentInstruction,
  type ReviewablePost,
} from '@/lib/content/instructions'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  unit_id: z.string().uuid(),
  original_text: z.string().min(3).max(4000),
  /** Interpretação mostrada ao dono e confirmada por ele. É revalidada aqui — o servidor nunca confia no que o navegador manda. */
  proposal: z.record(z.string(), z.unknown()),
  /** Instruções em conflito que o dono mandou substituir; as demais convivem (a de maior prioridade/mais nova vence). */
  replace_ids: z.array(z.string().uuid()).max(20).default([]),
})

/** Grava a instrução já confirmada pelo dono. Permissão: RLS (can_access_unit + is_org_admin) — sem permissão, o insert falha. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const { unit_id, original_text, proposal, replace_ids } = body.data

  const guard = guardInstruction(original_text)
  if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 422 })

  const { data: unit } = await supabase.from('units').select('*').eq('id', unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })
  const timeZone = (unit as Unit).timezone || 'America/Phoenix'
  const today = dateKeyIn(new Date(), timeZone)

  const parsed = parseInterpretation(proposal, today)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 })
  const { interpretation, starts_on, ends_on, priority } = parsed.value

  const { data: existingRows } = await supabase.from('content_instructions').select('*').eq('unit_id', unit_id).is('superseded_by', null)
  const existing = (existingRows ?? []) as ContentInstruction[]
  const conflicts = detectConflicts({ starts_on, ends_on, interpretation }, existing, today)
  const replaceable = new Set(conflicts.map((c) => c.instructionId))
  if (replace_ids.some((id) => !replaceable.has(id))) return NextResponse.json({ error: 'Só dá para substituir instruções em conflito.' }, { status: 422 })

  const { data: created, error } = await supabase
    .from('content_instructions')
    .insert({
      org_id: (unit as Unit).org_id,
      unit_id,
      original_text: original_text.trim(),
      interpretation,
      objective: interpretation.objective,
      priority,
      starts_on,
      ends_on,
      timezone: timeZone,
      conflict_notes: conflicts.filter((c) => !replace_ids.includes(c.instructionId)).map((c) => c.message),
      created_by: user.email,
    })
    .select('*')
    .single()
  if (error || !created) return NextResponse.json({ error: 'Sem permissão ou não foi possível salvar a instrução.' }, { status: 403 })
  const instruction = created as ContentInstruction

  await supabase.from('content_instruction_history').insert({
    instruction_id: instruction.id,
    org_id: instruction.org_id,
    unit_id,
    action: 'created',
    actor: user.email,
    detail: { original_text: instruction.original_text, interpretation, starts_on, ends_on, priority },
  })
  for (const id of replace_ids) {
    await supabase.from('content_instructions').update({ superseded_by: instruction.id, updated_at: new Date().toISOString() }).eq('id', id)
    await supabase.from('content_instruction_history').insert({
      instruction_id: id,
      org_id: instruction.org_id,
      unit_id,
      action: 'superseded',
      actor: user.email,
      detail: { by: instruction.id },
    })
  }

  const { data: posts } = await supabase
    .from('content_posts')
    .select('id, status, scheduled_for, instruction_id, caption, platform')
    .eq('unit_id', unit_id)
    .in('status', ['draft', 'pending_approval', 'approved', 'scheduled'])
    .not('scheduled_for', 'is', null)
  const toReview = postsNeedingReview((posts ?? []) as ReviewablePost[], instruction, timeZone)
  return NextResponse.json({ instruction, reviewPosts: toReview })
}
