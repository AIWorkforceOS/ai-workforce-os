import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/dashboard-ui'
import { EmailCampaignForm } from '@/components/dashboard/email-campaign-form'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NewEmailCampaignPage() {
  const supabase = await createClient()

  const [{ data: units }, { data: posts }, { data: seoItems }] = await Promise.all([
    supabase.from('units').select('*').order('created_at', { ascending: true }),
    supabase
      .from('content_posts')
      .select('id, unit_id, caption')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(20),
    supabase
      .from('seo_content_items')
      .select('id, unit_id, title, content_type')
      .eq('status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(20),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="e-mail marketing"
        title="Nova campanha"
        subtitle="Descreva o objetivo (ou aproveite um conteúdo já pronto do Conteúdo/Social ou do SEO) e escolha para quem enviar — a IA gera o rascunho, você aprova antes de qualquer envio."
      />
      <EmailCampaignForm
        units={(units ?? []) as Unit[]}
        contentPosts={(posts ?? []) as { id: string; unit_id: string; caption: string }[]}
        seoContentItems={(seoItems ?? []) as { id: string; unit_id: string; title: string; content_type: string }[]}
      />
    </div>
  )
}
