import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UnitSettingsForm } from '@/components/dashboard/unit-settings-form'
import { WhatsAppConnection } from '@/components/dashboard/whatsapp-connection'
import { CopyWhatsAppLink } from '@/components/dashboard/copy-whatsapp-link'
import { ProspectingPanel } from '@/components/dashboard/prospecting-panel'
import type { AgentConfig, DashboardSummaryRow, Unit } from '@/lib/types'

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
          <h1 className="text-xl font-semibold text-gray-900">{unitRow.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {unitRow.region_city ?? '—'}
            {unitRow.region_state ? `, ${unitRow.region_state}` : ''}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            unitRow.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {unitRow.is_active ? 'Ativa' : 'Inativa'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-gray-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{metric.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white px-6 py-3 text-xs text-gray-500 shadow-sm">
        Slug: <span className="text-gray-900">{unitRow.slug}</span>
      </div>

      <UnitSettingsForm unit={unitRow} />

      <div className="flex items-center justify-between">
        <WhatsAppConnection unitId={unitRow.id} />
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-6 py-3 shadow-sm">
        <span className="text-sm text-gray-500">Link para a unidade conectar o WhatsApp:</span>
        <CopyWhatsAppLink unitId={unitRow.id} />
      </div>

      <ProspectingPanel
        unitId={unitRow.id}
        defaultCity={unitRow.region_city ?? ''}
        defaultState={unitRow.region_state ?? ''}
        availableSectors={agentConfigRow?.sectors ?? []}
      />

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Agente SDR</h2>
            <p className="mt-1 text-sm text-gray-500">
              Configure a persona, horários e limites do agente desta unidade.
            </p>
          </div>
          <Link
            href={`/dashboard/units/${unitRow.id}/agent`}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Configurar agente
          </Link>
        </div>
      </div>
    </div>
  )
}
