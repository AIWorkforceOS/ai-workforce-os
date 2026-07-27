import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getAppUser } from '@/lib/app-user'
import { CANDIDATE_SOURCE_MANUAL, addCandidateToJobPipeline, findOrCreateCandidate } from '@/lib/recruiter/candidate-intake'
import { logRecruiterEvent } from '@/lib/recruiter/log'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RESUME_MAX_BYTES = 15 * 1024 * 1024

/**
 * POST /api/jobs/[id]/candidates — cadastro manual de candidato pelo
 * dono/RH (§ auditoria, gap fase 3/3): para quando o currículo já
 * chegou por fora (WhatsApp, e-mail, indicação) e a única fonte
 * automática de candidatos (API da Smarter) não se aplica. Entra no
 * MESMO pipeline job_candidates da vaga, pela mesma rubrica de
 * pontuação (lib/recruiter/candidate-intake.ts).
 *
 * multipart/form-data: name, email?, phone?, notes?, resume? (PDF)
 * Acesso validado pela sessão (RLS em job_openings); upload e escrita
 * do pipeline via service role, mesmo padrão de /api/jobs/[id].
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (appUser.role === 'viewer') {
    return NextResponse.json({ error: 'Sem permissão para adicionar candidatos.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data: jobData } = await supabase.from('job_openings').select('*').eq('id', id).maybeSingle()
  if (!jobData) return NextResponse.json({ error: 'Vaga não encontrada ou sem acesso.' }, { status: 404 })
  const job = jobData as JobOpening

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada.' }, { status: 500 })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 })

  const name = String(form.get('name') ?? '').trim()
  const email = String(form.get('email') ?? '').trim() || null
  const phone = String(form.get('phone') ?? '').trim() || null
  const notes = String(form.get('notes') ?? '').trim() || null
  const resume = form.get('resume')

  if (!name) return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 })
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
    const { error: uploadError } = await service.storage
      .from('candidate-resumes')
      .upload(path, resume, { contentType: 'application/pdf' })
    if (uploadError) {
      return NextResponse.json({ error: 'Não foi possível enviar o currículo.' }, { status: 500 })
    }
    const { data: signed } = await service.storage
      .from('candidate-resumes')
      .createSignedUrl(path, 60 * 60 * 24 * 365 * 10)
    resumeUrl = signed?.signedUrl ?? path
  }

  try {
    const { candidateId } = await findOrCreateCandidate(service, {
      orgId: job.org_id,
      source: CANDIDATE_SOURCE_MANUAL,
      name,
      email,
      phone,
      resumeUrl,
      notes,
    })

    const pipelineResult = await addCandidateToJobPipeline(service, { job, candidateId })
    if (!pipelineResult.ok) {
      return NextResponse.json({ error: pipelineResult.error }, { status: 400 })
    }

    await logRecruiterEvent(service, {
      orgId: job.org_id,
      unitId: job.unit_id,
      jobId: job.id,
      candidateId,
      eventType: 'candidate.added_manually',
      message: `Candidato "${name}" cadastrado manualmente por ${appUser.email}.`,
    })

    return NextResponse.json({ ok: true, stage: pipelineResult.stage, matchScore: pipelineResult.matchScore })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao cadastrar candidato.' },
      { status: 500 },
    )
  }
}
