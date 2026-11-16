import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { CANDIDATE_SOURCE_MANUAL, addCandidateToJobPipeline, findOrCreateCandidate } from '@/lib/recruiter/candidate-intake'
import { sendToCandidate } from '@/lib/recruiter/messaging'
import type { AgentConfig, Unit } from '@/lib/types'
import type { Candidate, JobOpening } from '@/lib/recruiter/types'

export const maxDuration = 60
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:write'); if (!isPartnerContext(ctx)) return ctx
  const { id } = await params; const { data: jobRow } = await ctx.supabase.from('job_openings').select('*').eq('id', id).maybeSingle(); const job = jobRow as JobOpening | null
  if (!job) return partnerError(404, 'Vaga não encontrada.'); const unit = await resolvePartnerUnit(ctx, { unitId: job.unit_id }); if (!unit) return partnerError(404, 'Vaga não encontrada.')
  const body = await request.json().catch(() => null); if (!body || !Array.isArray(body.candidates) || body.candidates.length === 0 || body.candidates.length > 50) return partnerError(400, 'candidates deve ter entre 1 e 50 itens.')
  const { data: cfg } = await ctx.supabase.from('agent_configs').select('*').eq('unit_id', unit.id).eq('agent_type', 'recruiter').maybeSingle(); const config = cfg as AgentConfig | null
  if (!config?.is_active) return partnerError(409, 'O Recrutador desta unidade não está ativo.')
  const results = []
  for (const raw of body.candidates as Record<string, unknown>[]) {
    const name = String(raw.name ?? '').trim(); const email = String(raw.email ?? '').trim() || null; const phone = String(raw.phone ?? '').trim() || null
    if (!name || (!email && !phone) || raw.consent !== true) { results.push({ external_id: raw.external_id ?? null, sent: false, reason: 'nome, contato e consent:true são obrigatórios' }); continue }
    try {
      const created = await findOrCreateCandidate(ctx.supabase, { orgId: job.org_id, source: CANDIDATE_SOURCE_MANUAL, name, email, phone, resumeUrl: null, notes: null })
      const pipeline = await addCandidateToJobPipeline(ctx.supabase, { job, candidateId: created.candidateId }); if (!pipeline.ok) { results.push({ external_id: raw.external_id ?? null, sent: false, reason: pipeline.error }); continue }
      const { data: candidateRow } = await ctx.supabase.from('candidates').select('*').eq('id', created.candidateId).single()
      const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 3000) : `Olá, ${name}! Temos a vaga "${job.title}". Você tem interesse?`
      const sent = await sendToCandidate({ supabase: ctx.supabase, unit: unit as Unit, config, candidate: candidateRow as Candidate, jobId: job.id, text: message, templateKey: 'partner_job_outreach' })
      results.push({ external_id: raw.external_id ?? null, candidate_id: created.candidateId, ...sent })
    } catch (error) { results.push({ external_id: raw.external_id ?? null, sent: false, reason: error instanceof Error ? error.message : 'erro interno' }) }
  }
  return NextResponse.json({ ok: true, job_id: job.id, results })
}
