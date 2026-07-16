import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { MessagingConnectForm } from '@/components/dashboard/messaging-connect-form'
import { MessagingConnectGuide, MessagingConnectKaiPanel } from '@/components/dashboard/messaging-connect-guide'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function MessagingConnectPage() {
  const supabase = await createClient()

  const { data: units } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: true })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="canal de mensagens"
        title="Conectar SMS (Twilio)"
        subtitle="Fora do Brasil o WhatsApp nem sempre é o canal principal — conecte sua conta Twilio para atender por SMS."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <MessagingConnectForm units={(units ?? []) as Unit[]} />
        <div className="flex flex-col gap-6">
          <MessagingConnectKaiPanel />
          <MessagingConnectGuide />
        </div>
      </div>
    </div>
  )
}
