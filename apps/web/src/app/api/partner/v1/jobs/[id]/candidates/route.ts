import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { CANDIDATE_SOURCE_MANUAL, addCandidateToJobPipeline, findOrCreateCandidate } from '@/lib/recruiter/candidate-intake'
import { logRecruiterEvent } from '@/lib/recruiter/log'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function loadJob(ctx: Parameters<typeof resolvePartnerUnit>[0], id: string) {
  const { data } = await ctx.supabase.from('job_openings').select('*').eq('id', id).maybeSingle()
  const job = data as JobOpening | null
  if (!job) return null
  const unit = await resolvePartnerUnit(ctx, { unitId: job.unit_id })
  return unit ? job : null
}

type PipelineRow = {
  id: string
  stage: string
  stage_reason: string | null
  ai_score: number | null
  match_score: number | null
  rank: number | null
  contacted_at: string | null
  screened_at: string | null
  presented_at: string | null
  candidates: { id: string; name: string; email: string | null; phone: string | null; city: string | null; state: string | null; course: string | null } | null
}

/** GET /api/partner/v1/jobs/{id}/candidates (escopo jobs:read) — pipeline da vaga, melhores primeiro. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:read')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const job = await loadJob(ctx, id)
  if (!job) return partnerError(404, 'Vaga não encontrada.')

  const { data } = await ctx.supabase
    .from('job_candidates')
    .select('id, stage, stage_reason, ai_score, match_score, rank, contacted_at, screened_at, presented_at, candidates(id, name, email, phone, city, state, course)')
    .eq('job_id', job.id)
    .order('rank', { ascending: true })
    .limit(200)

  const rows = (data as unknown as PipelineRow[] | null) ?? []
  return NextResponse.json({
    candidates: rows.map((row) => ({
      pipeline_id: row.id,
      candidate_id: row.candidates?.id ?? null,
      name: row.candidates?.name ?? null,
      email: row.candidates?.email ?? null,
      phone: row.candidates?.phone ?? null,
      city: row.candidates?.city ?? null,
      state: row.candidates?.state ?? null,
      course: row.candidates?.course ?? null,
      stage: row.stage,
      stage_reason: row.stage_reason,
      match_score: row.match_score,
      ai_score: row.ai_score,
      rank: row.rank,
      contacted_at: row.contacted_at,
      screened_at: row.screened_at,
      presented_at: row.presented_at,
    })),
  })
}

/**
 * POST /api/partner/v1/jobs/{id}/candidates (escopo jobs:write)
 * Body JSON: { name, email?, phone?, notes?, resume_url? (https), consent: true }
 *
 * Entra no mesmo pipeline e na mesma pontuação do sourcing/candidatura
 * pública. `consent: true` é obrigatório: o parceiro declara que tem
 * consentimento (LGPD) do candidato para ser contatado pelo Recrutador.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:write')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const job = await loadJob(ctx, id)
  if (!job) return partnerError(404, 'Vaga não encontrada.')

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')
  if (body.consent !== true) {
    return partnerError(400, 'consent: true é obrigatório — informe que o candidato autorizou o contato.')
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null
  if (!name) return partnerError(400, 'name é obrigatório.')
  if (!email && !phone) return partnerError(400, 'Informe email ou phone.')

  let resumeUrl: string | null = null
  if (typeof body.resume_url === 'string' && body.resume_url.trim()) {
    try {
      const parsed = new URL(body.resume_url)
      if (parsed.protocol !== 'https:') throw new Error('not https')
      resumeUrl = parsed.toString()
    } catch {
      return partnerError(400, 'resume_url deve ser uma URL https válida.')
    }
  }

  try {
    const { candidateId, created } = await findOrCreateCandidate(ctx.supabase, {
      orgId: job.org_id,
      source: CANDIDATE_SOURCE_MANUAL,
      name,
      email,
      phone,
      resumeUrl,
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null,
    })

    const result = await addCandidateToJobPipeline(ctx.supabase, { job, candidateId })
    if (!result.ok) return partnerError(409, result.error)

    await logRecruiterEvent(ctx.supabase, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      candidateId,
      eventType: 'candidate.added_via_partner_api',
      message: `Candidato "${name}" adicionado via API de parceiro.`,
    })

    return NextResponse.json(
      { ok: true, candidate_id: candidateId, created, stage: result.stage, match_score: result.matchScore },
      { status: 201 },
    )
  } catch (error) {
    return partnerError(500, error instanceof Error ? error.message : 'Erro ao cadastrar candidato.')
  }
}
