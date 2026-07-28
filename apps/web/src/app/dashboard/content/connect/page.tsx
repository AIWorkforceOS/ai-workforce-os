import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { ContentConnectForm } from '@/components/dashboard/content-connect-form'
import { getMetaBusinessManagerId } from '@/lib/integrations'
import type { SocialAccount } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ContentConnectPage() {
  const supabase = await createClient()

  const [{ data: units }, { data: accounts }] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase.from('social_accounts').select('*').order('created_at', { ascending: false }),
  ])
  const businessManagerId = getMetaBusinessManagerId()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="conteúdo/social"
        title="Conectar Instagram e Facebook"
        subtitle="Compartilhe a Página com a Alizo como Parceira — sem gerar token — e detectamos o Instagram vinculado automaticamente."
      />

      <div className="max-w-xl">
        <ContentConnectForm
          units={(units ?? []) as Unit[]}
          accounts={(accounts ?? []) as SocialAccount[]}
          businessManagerId={businessManagerId}
        />
      </div>
    </div>
  )
}
