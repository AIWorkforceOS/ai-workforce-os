import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { WaitlistPanel, type WaitlistRow } from '@/components/dashboard/waitlist-panel'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function UnitWaitlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) notFound()
  const unitRow = unit as Unit

  const { data: entries } = await supabase
    .from('waitlist_entries')
    .select('id, status, preferred_starts_at, preferred_notes, created_at, customer:customers(name), service:services(name)')
    .eq('unit_id', id)
    .order('created_at', { ascending: false })

  const rows = (entries ?? []) as unknown as WaitlistRow[]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="agenda inteligente"
        title={`Lista de espera — ${unitRow.name}`}
        subtitle="Clientes que não encontraram vaga e aguardam ser encaixados."
      />
      <WaitlistPanel unitId={id} initialEntries={rows} />
    </div>
  )
}
