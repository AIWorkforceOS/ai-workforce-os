import { createServiceClient } from '@/lib/supabase/service'
import { CLOSED_FOR_APPLICATION_STATUSES } from '@/lib/recruiter/candidate-intake'
import { JobApplicationForm } from '@/components/public/job-application-form'
import type { JobOpening } from '@/lib/recruiter/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

const COPY = {
  pt: {
    notFound: 'Vaga não encontrada.',
    closed: 'Esta vaga não está mais recebendo candidaturas.',
    apply: 'Candidatar-se',
  },
  en: {
    notFound: 'Job not found.',
    closed: 'This job is no longer accepting applications.',
    apply: 'Apply now',
  },
}

/**
 * Página pública de candidatura por vaga (sem login) — auditoria,
 * gap fase 3/3: única alternativa hoje era a API da Smarter. Token
 * escopado à vaga (job_openings.public_application_token, migration 046).
 */
export default async function JobApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()

  const job = supabase
    ? ((await supabase.from('job_openings').select('*').eq('public_application_token', token).maybeSingle()).data as JobOpening | null)
    : null

  const unit =
    job && supabase
      ? ((await supabase.from('units').select('*').eq('id', job.unit_id).maybeSingle()).data as Unit | null)
      : null

  const locale = unit?.default_conversation_language === 'en' ? 'en' : 'pt'
  const t = COPY[locale]

  if (!job || !unit || !unit.is_active) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-slate-400">{t.notFound}</p>
      </div>
    )
  }

  const closed = CLOSED_FOR_APPLICATION_STATUSES.includes(job.status)

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div
        className="w-full max-w-lg rounded-2xl p-6 sm:p-8"
        style={{ background: '#141a2b', boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
      >
        <p className="text-xs font-bold uppercase tracking-wide text-cyan-400">{unit.name}</p>
        <h1 className="mt-1 text-xl font-black tracking-tight text-white">{job.title}</h1>

        <div className="mt-6">
          {closed ? (
            <p className="text-sm text-slate-400">{t.closed}</p>
          ) : (
            <JobApplicationForm token={token} locale={locale} />
          )}
        </div>
      </div>
    </div>
  )
}
