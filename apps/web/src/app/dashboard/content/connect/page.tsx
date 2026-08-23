import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { ContentConnectForm } from '@/components/dashboard/content-connect-form'
import { ContentConnectGuide, ContentConnectKaiPanel } from '@/components/dashboard/content-connect-guide'
import { ContentOAuthPagePicker } from '@/components/dashboard/content-oauth-page-picker'
import { getMetaBusinessManagerId } from '@/lib/integrations'
import { getMetaAppCredentials } from '@/lib/content/meta-oauth'
import type { ContentOAuthSession, SocialAccount } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ContentConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_session?: string }>
}) {
  const { oauth_session: oauthSessionId } = await searchParams
  const supabase = await createClient()

  const [{ data: units }, { data: accounts }, oauthSession] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('social_accounts').select('*').order('created_at', { ascending: false }),
    oauthSessionId
      ? supabase.from('content_oauth_sessions').select('*').eq('id', oauthSessionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const businessManagerId = getMetaBusinessManagerId()
  const oauthEnabled = getMetaAppCredentials() !== null
  const pendingSession = oauthSession.data as ContentOAuthSession | null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="conteúdo/social"
        title="Conectar Instagram e Facebook"
        subtitle="Faça login com a conta do Facebook da sua empresa e escolha a Página — detectamos o Instagram vinculado automaticamente."
      />

      {pendingSession && pendingSession.pages.length > 0 && (
        <ContentOAuthPagePicker sessionId={pendingSession.id} pages={pendingSession.pages} />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Suspense fallback={null}>
          <ContentConnectForm
            units={(units ?? []) as Unit[]}
            accounts={(accounts ?? []) as SocialAccount[]}
            businessManagerId={businessManagerId}
            oauthEnabled={oauthEnabled}
          />
        </Suspense>
        <div className="flex flex-col gap-6">
          <ContentConnectKaiPanel />
          <ContentConnectGuide businessManagerId={businessManagerId} />
        </div>
      </div>
    </div>
  )
}
