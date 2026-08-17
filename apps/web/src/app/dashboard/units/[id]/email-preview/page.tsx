import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { buildBrandedEmailHtml } from '@/lib/email'
import { EmailBrandingForm } from '@/components/dashboard/email-branding-form'
import { Card } from '@/components/ui/dashboard-ui'
import type { AgentConfig, Unit } from '@/lib/types'

const SAMPLE_BODY_TEXT = [
  'Olá! Sou o Sales Rep aqui da unidade — vi que sua empresa pode se encaixar bem no que a gente oferece.',
  'Essa é uma prévia com texto de exemplo: na prática, cada e-mail é escrito pela IA na hora, personalizado para a empresa do lead — não existe um texto fixo para editar aqui.',
  'O que dá para ajustar abaixo é só o visual ao redor (cor e rodapé). Qualquer dúvida, é só responder este e-mail.',
].join('\n')

/**
 * Preview de como o lead recebe de fato o e-mail de prospecção do Sales
 * Rep (item pedido em 2026-08-17) + edição do layout fixo (cor, rodapé —
 * ver EmailBrandingForm). Mostra o texto do envio real mais recente
 * quando existe um (mesmo HTML, mesma função buildBrandedEmailHtml usada
 * no envio de verdade — nunca um mockup separado que pode ficar
 * desatualizado); cai num texto de exemplo só quando a unidade ainda não
 * mandou nenhum.
 */
export default async function EmailPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: unit }, { data: agentConfig }, { data: lastEmail }] = await Promise.all([
    supabase.from('units').select('*').eq('id', id).single(),
    supabase.from('agent_configs').select('*').eq('unit_id', id).eq('agent_type', 'sdr').maybeSingle(),
    supabase
      .from('conversations')
      .select('content, sent_at')
      .eq('unit_id', id)
      .eq('channel', 'email')
      .eq('direction', 'outbound')
      .eq('template_key', 'primeiro_contato')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!unit) notFound()
  const unitRow = unit as Unit
  const config = agentConfig as AgentConfig | null
  const lastEmailRow = lastEmail as { content: string; sent_at: string } | null

  const bodyText = lastEmailRow?.content?.trim() || SAMPLE_BODY_TEXT
  const isRealSample = Boolean(lastEmailRow?.content?.trim())

  const html = buildBrandedEmailHtml({
    unitName: unitRow.name,
    logoUrl: unitRow.logo_url,
    bodyText,
    accentColor: unitRow.email_accent_color,
    footerNote: unitRow.email_footer_note,
    whatsappCta: unitRow.whatsapp_phone
      ? { phone: unitRow.whatsapp_phone, text: `Olá! Recebi o e-mail de ${unitRow.name} e quero saber mais.` }
      : null,
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/dashboard/units/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white">
          <ArrowLeft size={14} /> Voltar para a unidade
        </Link>
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">prospecção · e-mail</p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">Como o lead vê o e-mail — {unitRow.name}</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          {config?.persona_name ?? 'O Sales Rep'} gera o texto de cada e-mail na hora do envio, personalizado por lead — não é
          um texto fixo. {isRealSample
            ? 'Abaixo está o texto do último e-mail de fato enviado por esta unidade.'
            : 'Esta unidade ainda não enviou nenhum e-mail de prospecção, então o texto abaixo é só um exemplo de layout.'}
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 bg-white/[0.02] px-5 py-3">
          <p className="text-xs font-semibold text-slate-300">
            Preview {isRealSample ? `(e-mail real de ${new Date(lastEmailRow!.sent_at).toLocaleDateString('pt-BR')})` : '(texto de exemplo)'}
          </p>
        </div>
        <iframe
          title="Preview do e-mail de prospecção"
          srcDoc={html}
          className="h-[640px] w-full bg-white"
          sandbox=""
        />
      </Card>

      <Card>
        <EmailBrandingForm unit={unitRow} />
      </Card>
    </div>
  )
}
