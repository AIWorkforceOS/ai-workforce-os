import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  CANDIDATE_SOURCE_PUBLIC_APPLICATION,
  CLOSED_FOR_APPLICATION_STATUSES,
  addCandidateToJobPipeline,
  findOrCreateCandidate,
} from '@/lib/recruiter/candidate-intake'
import type { JobOpening } from '@/lib/recruiter/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Intake público de candidatura por vaga (candidato externo → pipeline
 * do Recruiter), aditivo à integração Smarter (units.
 * smarter_recruiting_partner_token) — mesma família de risco de
 * /api/public/lead-intake (migration 022), mas escopado por vaga via
 * job_openings.public_application_token (migration 046) em vez de por
 * unidade: o pior caso de vazamento é uma candidatura indevida nesta
 * vaga específica.
 *
 * GET  /api/public/job-application/[token]  — dados p/ renderizar a página pública
 * POST /api/public/job-application/[token]  — multipart/form-data: name, email?, phone?, resume? (PDF)
 */

const RESUME_MAX_BYTES = 15 * 1024 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 10
const rateLimitHits = new Map<string, number[]>()

function isRateLimited(token: string): boolean {
  const now = Date.now()
  const hits = (rateLimitHits.get(token) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  hits.push(now)
  rateLimitHits.set(token, hits)
  return hits.length > RATE_LIMIT_MAX_REQUESTS
}

async function loadJobByToken(token: string) {
  const supabase = createServiceClient()
  if (!supabase) return { error: 'Serviço não configurado.', status: 500 } as const

  const { data: jobData } = await supabase
    .from('job_openings')
    .select('*')
    .eq('public_application_token', token)
    .maybeSingle()

  if (!jobData) return { error: 'Vaga não encontrada.', status: 404 } as const

  const job = jobData as JobOpening
  const { data: unitData } = await supabase.from('units').select('*').eq('id', job.unit_id).maybeSingle()
  if (!unitData || !(unitData as Unit).is_active) return { error: 'Vaga não encontrada.', status: 404 } as const

  return { supabase, job, unit: unitData as Unit } as const
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await loadJobByToken(token)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  const { job, unit } = result
  const closed = CLOSED_FOR_APPLICATION_STATUSES.includes(job.status)

  return NextResponse.json({
    job: { id: job.id, title: job.title },
    company: unit.name,
    accepting_applications: !closed,
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (isRateLimited(token)) {
    return NextResponse.json({ error: 'Muitas requisições. Tente novamente em instantes.' }, { status: 429 })
  }

  const result = await loadJobByToken(token)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  const { supabase, job } = result

  if (CLOSED_FOR_APPLICATION_STATUSES.includes(job.status)) {
    return NextResponse.json({ error: 'Esta vaga não está mais recebendo candidaturas.' }, { status: 400 })
  }

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })

  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim() || null
  const phone = String(form.get('phone') ?? '').trim() || null
  const resume = form.get('resume')

  if (!name) {
    return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 })
  }
  if (!email && !phone) {
    return NextResponse.json({ error: 'Informe e-mail ou telefone para contato.' }, { status: 400 })
  }

  let resumeUrl: string | null = null
  if (resume instanceof File && resume.size > 0) {
    if (resume.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Currículo deve ser um arquivo PDF.' }, { status: 400 })
    }
    if (resume.size > RESUME_MAX_BYTES) {
      return NextResponse.json({ error: 'Currículo deve ter no máximo 15MB.' }, { status: 400 })
    }
    const path = `${job.org_id}/${Date.now()}-${resume.name}`
    const { error: uploadError } = await supabase.storage
      .from('candidate-resumes')
      .upload(path, resume, { contentType: 'application/pdf' })
    if (uploadError) {
      return NextResponse.json({ error: 'Não foi possível enviar o currículo.' }, { status: 500 })
    }
    const { data: signed } = await supabase.storage
      .from('candidate-resumes')
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10)
    resumeUrl = signed?.signedUrl ?? path
  }

  try {
    const { candidateId } = await findOrCreateCandidate(supabase, {
      orgId: job.org_id,
      source: CANDIDATE_SOURCE_PUBLIC_APPLICATION,
      name,
      email,
      phone,
      resumeUrl,
    })

    const pipelineResult = await addCandidateToJobPipeline(supabase, { job, candidateId })
    if (!pipelineResult.ok) {
      return NextResponse.json({ error: pipelineResult.error }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao registrar candidatura.' },
      { status: 500 },
    )
  }
}
