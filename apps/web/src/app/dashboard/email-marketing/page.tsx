import { createClient } from '@/lib/supabase/server'
import {
  Badge,
  type BadgeVariant,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  PrimaryButton,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'
import { EmailCampaignActions } from '@/components/dashboard/email-campaign-actions'
import type { MarketingCampaign } from '@/lib/marketing-email/types'
import type { Unit } from '@/lib/types'
import { Mail, Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending_approval: 'amber',
  approved: 'blue',
  sending: 'blue',
  sent: 'green',
  rejected: 'slate',
  failed: 'red',
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovada',
  sending: 'Enviando…',
  sent: 'Enviada',
  rejected: 'Rejeitada',
  failed: 'Falhou',
}

const AUDIENCE_LABEL: Record<string, string> = {
  leads: 'Leads',
  customers: 'Clientes',
  both: 'Leads e clientes',
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  )
}

export default async function EmailMarketingPage() {
  const supabase = await createClient()

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: units }, { data: campaignRows }] = await Promise.all([
    supabase.from('units').select('*'),
    supabase
      .from('marketing_campaigns')
      .select('*')
      .gte('created_at', ninetyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  const unitById = new Map(((units ?? []) as Unit[]).map((unit) => [unit.id, unit]))
  const campaigns = (campaignRows ?? []) as MarketingCampaign[]

  const pending = campaigns.filter((c) => c.status === 'pending_approval')
  const sent = campaigns.filter((c) => c.status === 'sent')
  const failed = campaigns.filter((c) => c.status === 'failed')
  const reached = sent.reduce((sum, c) => sum + c.recipients_sent, 0)
  const history = campaigns.filter((c) => c.status !== 'pending_approval')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="e-mail marketing"
        title="Campanhas por e-mail"
        subtitle="Newsletter/campanha em massa para leads e clientes — desenhada uma vez, com a marca da unidade, e enviada só depois da sua aprovação."
        action={
          <PrimaryButton href="/dashboard/email-marketing/new" icon={<Plus size={14} />}>
            Nova campanha
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Aguardando aprovação" value={String(pending.length)} hint="rascunhos prontos, esperando sua decisão" />
        <KpiCard label="Campanhas enviadas (90d)" value={String(sent.length)} hint="aprovadas e disparadas no período" />
        <KpiCard label="Destinatários alcançados (90d)" value={String(reached)} hint="soma de envios com sucesso" />
        <KpiCard label="Falhas (90d)" value={String(failed.length)} hint={failed.length > 0 ? 'confira o motivo no histórico' : undefined} />
      </div>

      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="fila de aprovação" title="Campanhas aguardando sua decisão" />
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={<Mail size={22} className="text-white" />}
            title="Nada pendente agora"
            subtitle="Crie uma nova campanha — a IA gera assunto e corpo prontos, você só decide se edita, rejeita ou aprova (e o envio real acontece na aprovação)."
          />
        ) : (
          <div className="flex flex-col">
            {pending.map((campaign) => {
              const unit = unitById.get(campaign.unit_id)
              return (
                <div
                  key={campaign.id}
                  className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="cyan">{unit?.name ?? 'Unidade'}</Badge>
                      <Badge variant="purple">{AUDIENCE_LABEL[campaign.audience_type] ?? campaign.audience_type}</Badge>
                      <span className="text-xs text-slate-500">{new Date(campaign.created_at).toLocaleString('pt-BR')}</span>
                    </div>
                    <p className="mt-2 text-sm font-bold text-white">{campaign.subject}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{campaign.body_text}</p>
                    {campaign.reasoning && <p className="mt-1.5 text-[11px] text-slate-500">{campaign.reasoning}</p>}
                  </div>
                  <div className="flex-shrink-0">
                    <EmailCampaignActions campaignId={campaign.id} initialSubject={campaign.subject} initialBodyText={campaign.body_text} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="histórico" title="Campanhas decididas" />
        </div>
        {history.length === 0 ? (
          <EmptyState
            icon={<Mail size={22} className="text-white" />}
            title="Nenhuma campanha decidida ainda"
            subtitle="Assim que você aprovar, editar ou rejeitar uma campanha, ela aparece aqui com o resultado do envio."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <TableShell>
                <Th>Quando</Th>
                <Th>Unidade</Th>
                <Th>Assunto</Th>
                <Th>Público</Th>
                <Th>Status</Th>
                <Th>Resultado</Th>
              </TableShell>
              <tbody>
                {history.map((campaign) => {
                  const unit = unitById.get(campaign.unit_id)
                  return (
                    <Tr key={campaign.id}>
                      <Td className="text-slate-400">{new Date(campaign.created_at).toLocaleString('pt-BR')}</Td>
                      <Td className="text-slate-400">{unit?.name ?? '—'}</Td>
                      <Td className="max-w-xs truncate text-slate-300">{campaign.subject}</Td>
                      <Td className="text-slate-400">{AUDIENCE_LABEL[campaign.audience_type] ?? campaign.audience_type}</Td>
                      <Td>
                        <Badge variant={STATUS_VARIANT[campaign.status] ?? 'slate'}>{STATUS_LABEL[campaign.status] ?? campaign.status}</Badge>
                        {campaign.error_message && <p className="mt-1 max-w-md text-[11px] text-red-400">{campaign.error_message}</p>}
                      </Td>
                      <Td className="text-slate-400">
                        {campaign.status === 'sent' || campaign.recipients_total > 0
                          ? `${campaign.recipients_sent} enviado(s) · ${campaign.recipients_failed} falha(s) · ${campaign.recipients_skipped} pulado(s)`
                          : '—'}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
