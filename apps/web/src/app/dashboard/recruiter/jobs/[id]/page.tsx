import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JOB_STATUS_LABEL, CANDIDATE_STAGE_LABEL, PROFILE_FIELD_LABEL } from '@/lib/recruiter/ui'
import { JobActions, SelectCandidateButton } from '@/components/dashboard/job-actions'
import type { Candidate, JobCandidate, JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'

const cardStyle = {
  background: '#141a2b',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)',
} as const

type JcRow = JobCandidate & { candidates: Candidate | null }
type DecisionRow = {
  id: string
  decision_type: string
  reasoning: string
  candidate_id: string | null
  created_at: string
}
type EventRow = { id: string; event_type: string; message: string | null; created_at: string }

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default async function RecruiterJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: jobData }, { data: jcData }, { data: decisionsData }, { data: eventsData }] =
    await Promise.all([
      supabase.from('job_openings').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('job_candidates')
        .select('*, candidates(*)')
        .eq('job_id', id)
        .order('rank', { ascending: true, nullsFirst: false }),
      supabase
        .from('recruiter_decisions')
        .select('id, decision_type, reasoning, candidate_id, created_at')
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('recruiter_events')
        .select('id, event_type, message, created_at')
        .eq('job_id', id)
        .order('created_at', { ascending: false })
        .limit(80),
    ])

  if (!jobData) notFound()
  const job = jobData as JobOpening
  const rows = ((jcData as JcRow[] | null) ?? []).filter((row) => row.candidates)
  const decisions = (decisionsData as DecisionRow[] | null) ?? []
  const events = (eventsData as EventRow[] | null) ?? []
  const badge = JOB_STATUS_LABEL[job.status] ?? JOB_STATUS_LABEL.draft!

  const candidateName = new Map(rows.map((row) => [row.candidates!.id, row.candidates!.name]))

  const STAGE_GROUPS: { label: string; stages: string[] }[] = [
    { label: 'Ranqueados (aguardando contato)', stages: ['sourced', 'ranked'] },
    { label: 'Contatados / em triagem', stages: ['contacted', 'in_screening'] },
    { label: 'Triados', stages: ['screened'] },
    { label: 'Shortlist / apresentados', stages: ['shortlisted', 'presented'] },
    { label: 'Definidos', stages: ['approved', 'not_selected'] },
    { label: 'Fora do processo', stages: ['unreachable', 'withdrew', 'disqualified'] },
  ]

  const profileEntries = Object.entries(job.profile).filter(
    ([key, value]) =>
      PROFILE_FIELD_LABEL[key] &&
      value !== null &&
      value !== undefined &&
      String(value).length > 0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/recruiter" className="text-xs font-bold text-slate-500 hover:text-cyan-400">
            ← Recrutador IA
          </Link>
          <h1 className="mt-1 text-xl font-black tracking-tight text-white">{job.title}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
            {job.urgency === 'high' && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                Urgente
              </span>
            )}
            {job.hiring_deadline && <span className="text-xs text-slate-400">Deadline: {job.hiring_deadline}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <JobActions jobId={job.id} status={job.status} />
          <Link
            href={`/dashboard/recruiter/jobs/${job.id}/shortlist`}
            className="text-xs font-bold text-cyan-400 hover:underline"
          >
            Ver apresentação da shortlist →
          </Link>
        </div>
      </div>

      {/* Perfil ideal */}
      <div className="rounded-2xl p-5" style={cardStyle}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">Perfil ideal</h2>
        {job.profile.ideal_profile_summary && (
          <p className="mt-2 text-sm text-slate-300">{job.profile.ideal_profile_summary}</p>
        )}
        {profileEntries.length === 0 && !job.profile.ideal_profile_summary && (
          <p className="mt-2 text-sm text-slate-500">
            Ainda em levantamento com a empresa{job.profile_missing_fields.length > 0 ? ` — faltam ${job.profile_missing_fields.length} campos` : ''}.
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
          {profileEntries.map(([key, value]) => (
            <div key={key}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{PROFILE_FIELD_LABEL[key]}</p>
              <p className="text-sm text-slate-200">{Array.isArray(value) ? value.join(', ') : String(value)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Pipeline de candidatos */}
      <div className="rounded-2xl p-5" style={cardStyle}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">
          Pipeline de candidatos ({rows.length})
        </h2>
        {rows.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">Nenhum candidato ainda — o sourcing roda quando o perfil é confirmado.</p>
        )}
        <div className="mt-3 flex flex-col gap-4">
          {STAGE_GROUPS.map((group) => {
            const groupRows = rows.filter((row) => group.stages.includes(row.stage))
            if (groupRows.length === 0) return null
            return (
              <div key={group.label}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {group.label} · {groupRows.length}
                </p>
                <div className="flex flex-col gap-2">
                  {groupRows.map((row) => {
                    const candidate = row.candidates!
                    return (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
                        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-white">
                            {row.rank ? `${row.rank}. ` : ''}{candidate.name}
                            {row.stage === 'approved' && <span className="ml-2 text-emerald-400">✓ escolhido</span>}
                          </p>
                          <p className="truncate text-xs text-slate-400">
                            {[candidate.course, candidate.institution, candidate.city].filter(Boolean).join(' · ') || '—'}
                            {candidate.disc_profile ? ` · DISC ${candidate.disc_profile}` : ''}
                          </p>
                          {row.stage_reason && <p className="mt-0.5 text-[11px] text-slate-500">{row.stage_reason}</p>}
                        </div>
                        <div className="flex items-center gap-3 text-right">
                          <div>
                            <p className="text-[10px] font-bold uppercase text-slate-500">Match / Nota</p>
                            <p className="text-sm font-black text-white">
                              {row.match_score ?? '—'} / {row.ai_score ?? '—'}
                            </p>
                          </div>
                          <span
                            className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                            style={{ background: 'rgba(255,255,255,0.06)', color: '#cbd5e1' }}
                          >
                            {CANDIDATE_STAGE_LABEL[row.stage] ?? row.stage}
                          </span>
                          {['shortlisted', 'presented'].includes(row.stage) && (
                            <SelectCandidateButton jobId={job.id} jobCandidateId={row.id} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Decision log */}
        <div className="rounded-2xl p-5" style={cardStyle}>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">
            Decision log — por que a IA fez cada coisa
          </h2>
          <div className="mt-3 flex max-h-[480px] flex-col gap-3 overflow-y-auto pr-1">
            {decisions.length === 0 && <p className="text-sm text-slate-500">Nenhuma decisão registrada ainda.</p>}
            {decisions.map((decision) => (
              <div key={decision.id} className="rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold" style={{ background: 'rgba(6,182,212,0.12)', color: '#22d3ee' }}>
                    {decision.decision_type}
                  </span>
                  <span className="text-[10px] text-slate-500">{formatDate(decision.created_at)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-300">{decision.reasoning}</p>
                {decision.candidate_id && candidateName.get(decision.candidate_id) && (
                  <p className="mt-0.5 text-[10px] text-slate-500">Candidato: {candidateName.get(decision.candidate_id)}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Eventos do processo */}
        <div className="rounded-2xl p-5" style={cardStyle}>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">Linha do tempo do processo</h2>
          <div className="mt-3 flex max-h-[480px] flex-col gap-2 overflow-y-auto pr-1">
            {events.length === 0 && <p className="text-sm text-slate-500">Nenhum evento ainda.</p>}
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-2 text-xs">
                <span className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400" />
                <div>
                  <p className="text-slate-300">
                    <span className="font-mono font-bold text-slate-400">{event.event_type}</span>
                    {event.message ? ` — ${event.message}` : ''}
                  </p>
                  <p className="text-[10px] text-slate-600">{formatDate(event.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
