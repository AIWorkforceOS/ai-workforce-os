import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { UnitSettingsForm } from '@/components/dashboard/unit-settings-form'
import { WhatsAppConnection } from '@/components/dashboard/whatsapp-connection'
import { CopyWhatsAppLink } from '@/components/dashboard/copy-whatsapp-link'
import { ProspectingPanel } from '@/components/dashboard/prospecting-panel'
import { UnitOwnerPanel } from '@/components/dashboard/unit-owner-panel'
import type { AgentConfig, DashboardSummaryRow, Unit } from '@/lib/types'
import { Badge, Card, KpiCard, PageHeader } from '@/components/ui/dashboard-ui'

const CLOSED_JOB_STATUSES = ['closed', 'cancelled', 'expired', 'handed_off']
const TERMINAL_CANDIDATE_STAGES = ['approved', 'not_selected', 'unreachable', 'withdrew', 'disqualified']

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ welcome?: string }>
}) {
  const { id } = await params
  const { welcome } = await searchParams
  const supabase = await createClient()
  const appUser = await getAppUser()
  const isSuperAdmin = appUser?.isSuperAdmin ?? false
  const isOrgAdmin = isSuperAdmin || appUser?.role === 'admin'

  const [{ data: unit }, { data: summary }, { data: agentConfig }, { count: openJobsCount }, { count: activeCandidatesCount }, { data: ownerUser }] =
    await Promise.all([
      supabase.from('units').select('*').eq('id', id).single(),
      supabase.from('dashboard_summary').select('*').eq('unit_id', id).maybeSingle(),
      supabase.from('agent_configs').select('*').eq('unit_id', id).eq('agent_type', 'sdr').maybeSingle(),
      supabase
        .from('job_openings')
        .select('id', { count: 'exact', head: true })
        .eq('unit_id', id)
        .not('status', 'in', `(${CLOSED_JOB_STATUSES.join(',')})`),
      supabase
        .from('job_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('unit_id', id)
        .not('stage', 'in', `(${TERMINAL_CANDIDATE_STAGES.join(',')})`),
      isOrgAdmin
        ? supabase.from('users').select('email, name').eq('unit_id', id).eq('is_active', true).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  if (!unit) {
    notFound()
  }

  const unitRow = unit as Unit
  const summaryRow = summary as DashboardSummaryRow | null
  const agentConfigRow = agentConfig as AgentConfig | null

  const metrics = [
    { label: 'Contatos (leads)', value: summaryRow?.total_leads ?? 0 },
    { label: 'Conversas', value: summaryRow?.total_conversations ?? 0 },
    { label: 'Negócios fechados', value: summaryRow?.won_leads ?? 0 },
    { label: 'Vagas abertas', value: openJobsCount ?? 0 },
    { label: 'Processos seletivos em andamento', value: activeCandidatesCount ?? 0 },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="unidade"
        title={unitRow.name}
        subtitle={`${unitRow.region_city ?? '—'}${unitRow.region_state ? `, ${unitRow.region_state}` : ''}`}
        action={<Badge variant={unitRow.is_active ? 'green' : 'slate'}>{unitRow.is_active ? 'Ativa' : 'Inativa'}</Badge>}
      />

      {welcome && (
        <Card className={`px-6 py-3 text-sm ${welcome === 'sent' ? 'text-emerald-400' : 'text-amber-400'}`}>
          {welcome === 'sent'
            ? 'Acesso criado e e-mail de boas-vindas enviado ao responsável desta unidade.'
            : 'Unidade criada, mas não foi possível enviar o e-mail de boas-vindas automaticamente. Use o painel abaixo para tentar novamente.'}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map((metric) => (
          <KpiCard key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </div>

      {/* WhatsApp primeiro: é a configuração que destrava o atendimento */}
      <WhatsAppConnection unitId={unitRow.id} />

      <Card className="flex flex-wrap items-center gap-2 px-6 py-3">
        <span className="text-sm text-slate-400">
          Prefere que outra pessoa conecte o WhatsApp? Mande esse link pra ela:
        </span>
        <CopyWhatsAppLink unitId={unitRow.id} />
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Funcionário digital (vendedor)</h2>
            <p className="mt-1 text-sm text-slate-400">
              {agentConfigRow
                ? `${agentConfigRow.persona_name} atende por esta unidade — ajuste nome, jeito de falar e horários.`
                : 'Monte o funcionário que vai atender os clientes desta unidade.'}
            </p>
          </div>
          <Link
            href={agentConfigRow ? `/dashboard/units/${unitRow.id}/agent` : '/dashboard/onboarding'}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {agentConfigRow ? 'Ajustar funcionário' : 'Configurar agora'}
          </Link>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Agenda inteligente</h2>
            <p className="mt-1 text-sm text-slate-400">
              Horário de funcionamento, serviços, salas/equipamentos e profissionais que atendem agenda.
            </p>
          </div>
          <Link
            href={`/dashboard/units/${unitRow.id}/agenda`}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Configurar agenda
          </Link>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Operação de serviços</h2>
            <p className="mt-1 text-sm text-slate-400">
              Serviços executados, valores a pagar por profissional e faturas por e-mail para seus clientes.
            </p>
          </div>
          <Link
            href={`/dashboard/units/${unitRow.id}/operacao`}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Abrir operação
          </Link>
        </div>
      </Card>

      {isOrgAdmin && unitRow.org_id && (
        <Card className="p-6">
          <h2 className="text-sm font-bold text-white">Acesso do responsável pela unidade</h2>
          <p className="mt-1 text-sm text-slate-400">
            Login restrito só aos dados desta unidade (não enxerga as outras unidades da empresa).
          </p>
          <div className="mt-4">
            <UnitOwnerPanel orgId={unitRow.org_id} unitId={unitRow.id} initialOwner={ownerUser ?? null} />
          </div>
        </Card>
      )}

      <UnitSettingsForm unit={unitRow} showAdvanced={isSuperAdmin} />

      <ProspectingPanel
        unitId={unitRow.id}
        defaultCity={unitRow.region_city ?? ''}
        defaultState={unitRow.region_state ?? ''}
        availableSectors={agentConfigRow?.sectors ?? []}
      />

      {isSuperAdmin && (
        <Card className="px-6 py-3 text-xs text-slate-400">
          Slug: <span className="text-white">{unitRow.slug}</span>
          {unitRow.evolution_instance_name && (
            <>
              {' '}· Instância: <span className="text-white">{unitRow.evolution_instance_name}</span>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
