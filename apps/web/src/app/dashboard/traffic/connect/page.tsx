import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { TrafficConnectForm } from '@/components/dashboard/traffic-connect-form'
import { TrafficConnectGuide, TrafficConnectKaiPanel } from '@/components/dashboard/traffic-connect-guide'
import { TrafficOAuthAccountPicker } from '@/components/dashboard/traffic-oauth-account-picker'
import { getMetaBusinessManagerId } from '@/lib/integrations'
import { getMetaAdsAppCredentials } from '@/lib/traffic/meta-ads-oauth'
import type { AdAccount, TrafficOAuthSession } from '@/lib/traffic/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function TrafficConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_session?: string }>
}) {
  const { oauth_session: oauthSessionId } = await searchParams
  const supabase = await createClient()

  const [{ data: units }, { data: accounts }, oauthSession] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('ad_accounts').select('*').order('created_at', { ascending: false }),
    oauthSessionId
      ? supabase.from('traffic_oauth_sessions').select('*').eq('id', oauthSessionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const businessManagerId = getMetaBusinessManagerId()
  const oauthEnabled = getMetaAdsAppCredentials() !== null
  const pendingSession = oauthSession.data as TrafficOAuthSession | null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="tráfego pago"
        title="Conectar contas de anúncio"
        subtitle="Faça login com a conta do Facebook da empresa e escolha a conta de anúncio Meta Ads — ou aceite o vínculo da MCC do Google Ads."
      />

      {pendingSession && pendingSession.accounts.length > 0 && (
        <TrafficOAuthAccountPicker sessionId={pendingSession.id} accounts={pendingSession.accounts} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Suspense fallback={null}>
          <TrafficConnectForm
            units={(units ?? []) as Unit[]}
            accounts={(accounts ?? []) as AdAccount[]}
            businessManagerId={businessManagerId}
            oauthEnabled={oauthEnabled}
          />
        </Suspense>
        <div className="flex flex-col gap-6">
          <TrafficConnectKaiPanel />
          <TrafficConnectGuide businessManagerId={businessManagerId} />
        </div>
      </div>
    </div>
  )
}
