import Link from 'next/link'
import { Briefcase, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { JOB_STATUS_LABEL, ACTIVE_JOB_STATUSES as ACTIVE_STATUSES } from '@/lib/recruiter/ui'
import type { JobOpening, JobCandidate } from '@/lib/recruiter/types'
import {
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHeader,
  PrimaryButton,
  TableCard,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'

export const dynamic = 'force-dynamic'

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
    { label: 'Vagas abertas', value: String(openJobs.length), gradient: 'from-cyan-400 to-blue-500' },
    { label: 'Candidatos em triagem', value: String(inScreening), gradient: 'from-purple-400 to-violet-500' },
    { label: 'Shortlists com a empresa', value: String(waitingCompany.length), gradient: 'from-amber-400 to-orange-500' },
    { label: 'Tempo médio até shortlist', value: avgTimeToShortlist !== null ? `${avgTimeToShortlist}d` : '—', gradient: 'from-indigo-400 to-indigo-500' },
    { label: 'Taxa de aprovação', value: approvalRate !== null ? `${approvalRate}%` : '—', gradient: 'from-green-400 to-emerald-500' },
    { label: 'Contratações no mês', value: String(hiresThisMonth), gradient: 'from-green-400 to-emerald-500' },
  ]

  const STAGE_ORDER = ['sourced', 'ranked', 'contacted', 'in_screening', 'screened', 'shortlisted', 'presented', 'approved']

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="equipe digital"
        title="Recrutador digital"
        subtitle="Você abre a vaga; ele divulga, conversa com os candidatos, faz a triagem e te entrega os melhores."
        action={
          <PrimaryButton href="/dashboard/recruiter/jobs/new" icon={<Plus size={14} />}>
            Abrir vaga
          </PrimaryButton>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} label={kpi.label} value={kpi.value} gradient={kpi.gradient} />
        ))}
      </div>

      {/* Alertas */}
      {alerts.length > 0 && (
        <Card className="p-5">
          <CardHeader eyebrow="atenção" title="Alertas" />
          <ul className="flex flex-col gap-2">
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
        </Card>
      )}

      {/* Tabela de vagas */}
      {jobs.length === 0 ? (
        <Card className="overflow-hidden">
          <EmptyState
            icon={<Briefcase size={22} className="text-white" />}
            title="Nenhuma vaga aberta ainda"
            subtitle="Conte pro recrutador qual vaga você precisa preencher — cargo, cidade e o perfil da pessoa. Ele cuida da divulgação e da triagem, e te avisa quando tiver os melhores candidatos."
            actionHref="/dashboard/recruiter/jobs/new"
            actionLabel="Abrir minha primeira vaga"
          />
        </Card>
      ) : (
        <TableCard>
          <TableShell>
            <Th>Vaga</Th>
            <Th>Unidade</Th>
            <Th>Status</Th>
            <Th>Pipeline</Th>
            <Th>Dias em aberto</Th>
            <Th>Urgência</Th>
            <Th>Deadline</Th>
          </TableShell>
          <tbody>
            {jobs.map((job) => {
              const badge = JOB_STATUS_LABEL[job.status] ?? JOB_STATUS_LABEL.draft!
              const list = jcByJob.get(job.id) ?? []
              const funnel = STAGE_ORDER.map((stage) => list.filter((jc) => jc.stage === stage).length)
              return (
                <Tr key={job.id}>
                  <Td>
                    <Link href={`/dashboard/recruiter/jobs/${job.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                      {job.title}
                    </Link>
                  </Td>
                  <Td className="text-slate-400">{unitName.get(job.unit_id) ?? '—'}</Td>
                  <Td>
                    <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </Td>
                  <Td className="font-mono text-[11px] text-slate-400">
                    <span title="sourced → ranked → contatados → triagem → triados → shortlist → apresentados → aprovado">
                      {funnel.join(' · ')}
                    </span>
                  </Td>
                  <Td className="text-slate-400">{daysBetween(job.created_at, new Date().toISOString())}d</Td>
                  <Td>
                    <span className={job.urgency === 'high' ? 'font-bold text-red-400' : 'text-slate-400'}>
                      {job.urgency === 'high' ? 'Alta' : job.urgency === 'low' ? 'Baixa' : 'Normal'}
                    </span>
                  </Td>
                  <Td className="text-slate-400">{job.hiring_deadline ?? '—'}</Td>
                </Tr>
              )
            })}
          </tbody>
        </TableCard>
      )}
    </div>
  )
}
