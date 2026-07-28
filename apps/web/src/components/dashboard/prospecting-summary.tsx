import Link from 'next/link'
import type { ProspectingJob, ProspectingProfile } from '@/lib/types'
import { Badge, type BadgeVariant, Card } from '@/components/ui/dashboard-ui'

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  running: 'Em andamento',
  done: 'Concluído',
  failed: 'Falhou',
}

const JOB_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  running: 'amber',
  done: 'green',
  failed: 'red',
}

/**
 * Painel informativo da prospecção autônoma: mostra o perfil de
 * segmentação vigente e o histórico das rodadas automáticas. Não existe
 * mais botão de disparo manual — quem decide buscar é o próprio Sales
 * Rep, pelo cron, sempre com a config atual (migration 049).
 */
export function ProspectingSummary({
  unitId,
  profile,
  agentConfigured,
  capturedToday,
  captureLimit,
  jobs,
}: {
  unitId: string
  profile: ProspectingProfile | null
  agentConfigured: boolean
  capturedToday: number
  captureLimit: number
  jobs: ProspectingJob[]
}) {
  const isGeneral = profile?.mode === 'general'
  const businessTypes = (profile?.business_types ?? []).filter((t) => t.trim().length > 0)
  const hasProfile = isGeneral || businessTypes.length > 0

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Prospecção automática de leads</h2>
          <p className="mt-1 text-sm text-slate-400">
            O Sales Rep busca empresas sozinho ao longo do dia, no Google Maps, seguindo o perfil de
            segmentação abaixo — mudou o perfil, a próxima rodada já busca diferente.
          </p>
        </div>
        <Link
          href={agentConfigured ? `/dashboard/units/${unitId}/agent` : '/dashboard/onboarding'}
          className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          Editar segmentação
        </Link>
      </div>

      {hasProfile ? (
        <div className="flex flex-col gap-2 text-sm text-slate-300">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
              {isGeneral ? 'Empresas em geral' : 'Tipos de negócio'}
            </span>
            {isGeneral ? (
              <Badge variant="blue">{profile?.general_sector?.trim() || 'todos os setores'}</Badge>
            ) : (
              businessTypes.map((type) => (
                <Badge key={type} variant="blue">{type}</Badge>
              ))
            )}
          </div>
          {profile?.region?.trim() && (
            <p className="text-slate-400">
              Região/bairro: <span className="text-slate-200">{profile.region}</span>
            </p>
          )}
          {isGeneral && profile?.headcount_range?.trim() && (
            <p className="text-slate-400">
              Faixa de funcionários: <span className="text-slate-200">{profile.headcount_range}</span>{' '}
              <span className="text-xs text-slate-500">(aproximado — não é aplicado como filtro na busca)</span>
            </p>
          )}
          <p className="text-slate-400">
            Capturados hoje: <span className="text-slate-200">{capturedToday} de {captureLimit}</span> leads novos
          </p>
        </div>
      ) : (
        <p className="text-sm text-amber-400">
          Perfil de segmentação ainda não configurado — a prospecção automática fica parada até você
          definir os tipos de negócio (ou &quot;empresas em geral&quot;) na configuração do funcionário.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="mb-2 text-xs font-medium text-slate-500">Últimas rodadas automáticas</p>
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between rounded-xl px-3 py-2 text-xs text-slate-400"
                style={{ border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span>{job.city}, {job.state} — {job.keywords.join(', ')}</span>
                <span className="flex items-center gap-2">
                  {job.status === 'done' && <span>{job.total_new} novos</span>}
                  <Badge variant={JOB_STATUS_VARIANT[job.status] ?? 'slate'}>
                    {JOB_STATUS_LABEL[job.status] ?? job.status}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
