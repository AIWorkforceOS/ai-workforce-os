import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { JOB_STATUS_LABEL, ACTIVE_JOB_STATUSES as ACTIVE_STATUSES } from '@/lib/recruiter/ui'
import type { JobOpening, JobCandidate } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'

const cardStyle = {
  background: '#141a2b',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)',
} as const

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000))
}

export default async function RecruiterDashboardPage() {
  const supabase = await createClient()

  const [{ data: jobsData }, { data: jcData }, { data: unitsData }] = await Promise.all([
    supabase.from('job_openings').select('*').order('created_at', { ascending: false }),
    supabase.from('job_candidates').select('id, job_id, stage, ai_score, presented_at, screened_at'),
    supabase.from('units').select('id, name'),
  ])

  const jobs = ((jobsData as JobOpening[] | null) ?? [])
  const jcs = ((jcData as Pick<JobCandidate, 'id' | 'job_id' | 'stage' | 'ai_score' | 'presented_at' | 'screened_at'>[] | null) ?? [])
  const unitName = new Map(((unitsData as { id: string; name: string }[] | null) ?? []).map((u) => [u.id, u.name]))

  const jcByJob = new Map<string, typeof jcs>()
  for (const jc of jcs) {
    jcByJob.set(jc.job_id, [...(jcByJob.get(jc.job_id) ?? []), jc])
  }

  // ── KPIs (§13.1) ──
  const openJobs = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status))
  const inScreening = jcs.filter((jc) => jc.stage === 'in_screening').length
  const waitingCompany = jobs.filter((j) => j.status === 'company_review')

  const presentedJobs = jobs.filter((j) => {
    const list = jcByJob.get(j.id) ?? []
    return list.some((jc) => jc.presented_at)
  })
  const avgTimeToShortlist = presentedJobs.length
    ? Math.round(
        presentedJobs.reduce((acc, j) => {
          const first = (jcByJob.get(j.id) ?? [])
            .filter((jc) => jc.presented_at)
            .sort((a, b) => (a.presented_at! < b.presented_at! ? -1 : 1))[0]
          return acc + daysBetween(j.created_at, first!.presented_at!)
        }, 0) / presentedJobs.length,
      )
    : null

  const decidedJobs = jobs.filter((j) => ['candidate_selected', 'handed_off', 'closed'].includes(j.status))
  const approvalRate = presentedJobs.length
    ? Math.round((decidedJobs.length / presentedJobs.length) * 100)
    : null

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const hiresThisMonth = jobs.filter(
    (j) => ['handed_off', 'closed'].includes(j.status) && new Date(j.updated_at) >= monthStart,
  ).length

  // ── Alertas (§13.3) ──
  const alerts: { text: string; jobId: string; severity: 'red' | 'yellow' }[] = []
  for (const job of jobs) {
    if (job.status === 'stalled') {
      alerts.push({ text: `Vaga "${job.title}" parada${job.stalled_since ? ` há ${daysBetween(job.stalled_since, new Date().toISOString())} dia(s)` : ''}`, jobId: job.id, severity: 'red' })
    }
    if (job.status === 'escalated_human') {
      alerts.push({ text: `Vaga "${job.title}" escalada — aguardando ação humana`, jobId: job.id, severity: 'red' })
    }
    if (job.status === 'company_review') {
      const list = (jcByJob.get(job.id) ?? []).filter((jc) => jc.presented_at)
      const first = list.sort((a, b) => (a.presented_at! < b.presented_at! ? -1 : 1))[0]
      if (first) {
        const days = daysBetween(first.presented_at!, new Date().toISOString())
        if (days > 3) {
          alerts.push({
            text: `Empresa sem responder a shortlist de "${job.title}" há ${days} dias (follow-up ${job.follow_up_count}/3)`,
            jobId: job.id,
            severity: days > 7 ? 'red' : 'yellow',
          })
        }
      }
    }
    if (job.status === 'candidate_selected') {
      alerts.push({ text: `"${job.title}": candidato escolhido aguardando handoff`, jobId: job.id, severity: 'yellow' })
    }
    if (job.hiring_deadline && ACTIVE_STATUSES.includes(job.status)) {
      const daysLeft = daysBetween(new Date().toISOString(), job.hiring_deadline)
      if (daysLeft >= 0 && daysLeft < 7) {
        alerts.push({ text: `Deadline de "${job.title}" em ${daysLeft} dia(s)`, jobId: job.id, severity: 'yellow' })
      }
    }
  }

  const kpis = [
    { label: 'Vagas abertas', value: String(openJobs.length) },
    { label: 'Candidatos em triagem', value: String(inScreening) },
    { label: 'Shortlists com a empresa', value: String(waitingCompany.length) },
    { label: 'Tempo médio até shortlist', value: avgTimeToShortlist !== null ? `${avgTimeToShortlist}d` : '—' },
    { label: 'Taxa de aprovação', value: approvalRate !== null ? `${approvalRate}%` : '—' },
    { label: 'Contratações no mês', value: String(hiresThisMonth) },
  ]

  const STAGE_ORDER = ['sourced', 'ranked', 'contacted', 'in_screening', 'screened', 'shortlisted', 'presented', 'approved']

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white">Recrutador digital</h1>
          <p className="mt-1 text-sm text-slate-400">
            Você abre a vaga; ele divulga, conversa com os candidatos, faz a triagem e te entrega os melhores.
          </p>
        </div>
        <Link
          href="/dashboard/recruiter/jobs/new"
          className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          + Abrir vaga
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl p-4" style={cardStyle}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{kpi.label}</p>
            <p className="mt-2 text-2xl font-black text-white">{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Alertas */}
      {alerts.length > 0 && (
        <div className="rounded-2xl p-5" style={cardStyle}>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">Alertas</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {alerts.map((alert, i) => (
              <li key={i}>
                <Link
                  href={`/dashboard/recruiter/jobs/${alert.jobId}`}
                  className="flex items-center gap-2 text-sm hover:underline"
                  style={{ color: alert.severity === 'red' ? '#f87171' : '#fbbf24' }}
                >
                  <span className="inline-block h-2 w-2 flex-shrink-0 rounded-full" style={{ background: alert.severity === 'red' ? '#f87171' : '#fbbf24' }} />
                  {alert.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabela de vagas */}
      <div className="overflow-x-auto rounded-2xl" style={cardStyle}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <th className="px-5 py-3">Vaga</th>
              <th className="px-5 py-3">Unidade</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Pipeline</th>
              <th className="px-5 py-3">Dias em aberto</th>
              <th className="px-5 py-3">Urgência</th>
              <th className="px-5 py-3">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center">
                  <p className="text-sm font-bold text-white">Nenhuma vaga aberta ainda</p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                    Conte pro recrutador qual vaga você precisa preencher — cargo, cidade e o perfil
                    da pessoa. Ele cuida da divulgação e da triagem, e te avisa quando tiver os
                    melhores candidatos.
                  </p>
                  <Link
                    href="/dashboard/recruiter/jobs/new"
                    className="mt-4 inline-block rounded-xl px-5 py-2.5 text-sm font-black text-white"
                    style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}
                  >
                    Abrir minha primeira vaga
                  </Link>
                </td>
              </tr>
            )}
            {jobs.map((job) => {
              const badge = JOB_STATUS_LABEL[job.status] ?? JOB_STATUS_LABEL.draft!
              const list = jcByJob.get(job.id) ?? []
              const funnel = STAGE_ORDER.map((stage) => list.filter((jc) => jc.stage === stage).length)
              return (
                <tr key={job.id} className="border-t transition-colors hover:bg-white/[0.02]" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/recruiter/jobs/${job.id}`} className="font-semibold text-white hover:text-cyan-400">
                      {job.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-400">{unitName.get(job.unit_id) ?? '—'}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-slate-400" title="sourced → ranked → contatados → triagem → triados → shortlist → apresentados → aprovado">
                    {funnel.join(' · ')}
                  </td>
                  <td className="px-5 py-3 text-slate-400">{daysBetween(job.created_at, new Date().toISOString())}d</td>
                  <td className="px-5 py-3">
                    <span className={job.urgency === 'high' ? 'font-bold text-red-400' : 'text-slate-400'}>
                      {job.urgency === 'high' ? 'Alta' : job.urgency === 'low' ? 'Baixa' : 'Normal'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-400">{job.hiring_deadline ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
