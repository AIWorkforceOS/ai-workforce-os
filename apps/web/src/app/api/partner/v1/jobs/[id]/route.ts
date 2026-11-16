import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { serializeJob } from '@/lib/partner-api/serialize-recruiter'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'

/** GET /api/partner/v1/jobs/{id} (escopo jobs:read) */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:read')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const { data } = await ctx.supabase.from('job_openings').select('*').eq('id', id).maybeSingle()
  const job = data as JobOpening | null
  if (!job) return partnerError(404, 'Vaga não encontrada.')

  const unit = await resolvePartnerUnit(ctx, { unitId: job.unit_id })
  if (!unit) return partnerError(404, 'Vaga não encontrada.')

  return NextResponse.json({ job: serializeJob(job) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const { data: current } = await ctx.supabase.from('job_openings').select('*').eq('id', id).maybeSingle()
  const job = current as JobOpening | null; if (!job || !(await resolvePartnerUnit(ctx, { unitId: job.unit_id }))) return partnerError(404, 'Vaga não encontrada.')
  const body = await request.json().catch(() => null); if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')
  const updates: Record<string, unknown> = {}
  if (body.status !== undefined) { const allowed = ['draft','profile_ready','sourcing','outreach','screening','shortlist_ready','presented','closed','cancelled','expired']; if (!allowed.includes(body.status)) return partnerError(400, 'status inválido.'); updates.status = body.status }
  if (body.title !== undefined) updates.title = String(body.title).trim().slice(0, 200)
  if (body.profile !== undefined && body.profile && typeof body.profile === 'object') updates.profile = body.profile
  const { data, error } = await ctx.supabase.from('job_openings').update(updates).eq('id', id).select('*').single(); if (error || !data) return partnerError(500, 'Não foi possível atualizar a vaga.')
  return NextResponse.json({ ok: true, job: serializeJob(data as JobOpening) })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const { data } = await ctx.supabase.from('job_openings').select('id, unit_id').eq('id', id).maybeSingle()
  const row = data as { id: string; unit_id: string } | null; if (!row || !(await resolvePartnerUnit(ctx, { unitId: row.unit_id }))) return partnerError(404, 'Vaga não encontrada.')
  const { error } = await ctx.supabase.from('job_openings').delete().eq('id', id); if (error) return partnerError(500, 'Não foi possível excluir a vaga.')
  return NextResponse.json({ ok: true, deleted: true })
}
