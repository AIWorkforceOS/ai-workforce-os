import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { TrafficConnectForm } from '@/components/dashboard/traffic-connect-form'
import { TrafficConnectGuide, TrafficConnectKaiPanel } from '@/components/dashboard/traffic-connect-guide'
import type { AdAccount } from '@/lib/traffic/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function TrafficConnectPage() {
  const supabase = await createClient()

  const [{ data: units }, { data: accounts }] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('ad_accounts').select('*').order('created_at', { ascending: false }),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="tráfego pago"
        title="Conectar contas de anúncio"
        subtitle="Cole as credenciais da sua conta Meta Ads ou Google Ads — testamos na hora e confirmamos se funcionou."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <TrafficConnectForm units={(units ?? []) as Unit[]} accounts={(accounts ?? []) as AdAccount[]} />
        <div className="flex flex-col gap-6">
          <TrafficConnectKaiPanel />
          <TrafficConnectGuide />
        </div>
      </div>
    </div>
  )
}
