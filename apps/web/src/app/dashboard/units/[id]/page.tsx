import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UnitSettingsForm } from '@/components/dashboard/unit-settings-form'
import { WhatsAppConnection } from '@/components/dashboard/whatsapp-connection'
import { CopyWhatsAppLink } from '@/components/dashboard/copy-whatsapp-link'
import { ProspectingPanel } from '@/components/dashboard/prospecting-panel'
import type { AgentConfig, DashboardSummaryRow, Unit } from '@/lib/types'
import { Badge, Card } from '@/components/ui/dashboard-ui'

export default async function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: unit }, { data: summary }, { data: agentConfig }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase.from('dashboard_summary').select('*').eq('unit_id', id).maybeSingle(),
    supabase.from('agent_configs').select('*').eq('unit_id', id).eq('agent_type', 'sdr').maybeSingle(),
  ])

  if (!unit) {
    notFound()
  }

  const unitRow = unit as Unit
  const summaryRow = summary as DashboardSummaryRow | null
  const agentConfigRow = agentConfig as AgentConfig | null

  const metrics = [
    { label: 'Total de leads', value: summaryRow?.total_leads ?? 0 },
    { label: 'Conversas', value: summaryRow?.total_conversations ?? 0 },
    { label: 'Convertidos', value: summaryRow?.won_leads ?? 0 },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-white">{unitRow.name}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {unitRow.region_city ?? '—'}
            {unitRow.region_state ? `, ${unitRow.region_state}` : ''}
          </p>
        </div>
        <Badge variant={unitRow.is_active ? 'green' : 'slate'}>{unitRow.is_active ? 'Ativa' : 'Inativa'}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="p-5">
            <p className="text-sm text-slate-400">{metric.label}</p>
            <p className="mt-2 text-2xl font-black text-white">{metric.value}</p>
          </Card>
        ))}
      </div>

      <Card className="px-6 py-3 text-xs text-slate-400">
        Slug: <span className="text-white">{unitRow.slug}</span>
      </Card>

      <UnitSettingsForm unit={unitRow} />

      <div className="flex items-center justify-between">
        <WhatsAppConnection unitId={unitRow.id} />
      </div>
      <Card className="flex items-center gap-2 px-6 py-3">
        <span className="text-sm text-slate-400">Link para a unidade conectar o WhatsApp:</span>
        <CopyWhatsAppLink unitId={unitRow.id} />
      </Card>

      <ProspectingPanel
        unitId={unitRow.id}
        defaultCity={unitRow.region_city ?? ''}
        defaultState={unitRow.region_state ?? ''}
        availableSectors={agentConfigRow?.sectors ?? []}
      />

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Agente SDR</h2>
            <p className="mt-1 text-sm text-slate-400">
              Configure a persona, horários e limites do agente desta unidade.
            </p>
          </div>
          <Link
            href={`/dashboard/units/${unitRow.id}/agent`}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Configurar agente
          </Link>
        </div>
      </Card>
    </div>
  )
}
