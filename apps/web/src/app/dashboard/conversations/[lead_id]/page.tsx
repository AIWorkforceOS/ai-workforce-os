import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Conversation, Lead } from '@/lib/types'
import { Badge, type BadgeVariant, Card } from '@/components/ui/dashboard-ui'

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  new: 'slate',
  contacted: 'blue',
  replied: 'amber',
  negotiating: 'purple',
  won: 'green',
  lost: 'red',
  paused: 'amber',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  replied: 'Respondeu',
  negotiating: 'Negociando',
  won: 'Convertido',
  lost: 'Perdido',
  paused: 'Pausado (humano)',
}

const MSG_DELIVERY: Record<string, { icon: string; color: string; label: string }> = {
  sent: { icon: '✓', color: 'text-slate-500', label: 'Enviado' },
  delivered: { icon: '✓✓', color: 'text-slate-500', label: 'Entregue' },
  read: { icon: '✓✓', color: 'text-cyan-400', label: 'Lido' },
  failed: { icon: '✗', color: 'text-red-400', label: 'Falhou' },
}

type LeadWithUnit = Lead & { unit: { name: string; whatsapp_phone: string | null } | null }

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ lead_id: string }>
}) {
  const { lead_id } = await params
  const supabase = await createClient()

  const [leadResult, conversationsResult] = await Promise.all([
    supabase
      .from('leads')
      .select('*, unit:units(name, whatsapp_phone)')
      .eq('id', lead_id)
      .single(),
    supabase
      .from('conversations')
      .select('*')
      .eq('lead_id', lead_id)
      .order('sent_at', { ascending: true }),
  ])

  if (leadResult.error || !leadResult.data) notFound()

  const lead = leadResult.data as LeadWithUnit
  const messages = (conversationsResult.data ?? []) as Conversation[]

  const inboundCount = messages.filter((m) => m.direction === 'inbound').length
  const outboundCount = messages.filter((m) => m.direction === 'outbound').length

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <Link href="/dashboard/conversations" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white">
          ← Voltar para Conversas
        </Link>

        <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-black tracking-tight text-white">{lead.company_name}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
              {lead.phone && <span className="font-mono">{lead.phone}</span>}
              {lead.unit?.name && (
                <span className="rounded px-2 py-0.5 text-xs text-slate-300" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {lead.unit.name}
                </span>
              )}
              {(lead.city || lead.state) && (
                <span>{lead.city ?? ''}{lead.state ? `, ${lead.state}` : ''}</span>
              )}
              {lead.sector && <span className="capitalize text-slate-500">{lead.sector}</span>}
            </div>
          </div>

          <Badge variant={STATUS_VARIANT[lead.status] ?? 'slate'}>{STATUS_LABELS[lead.status] ?? lead.status}</Badge>
        </Card>

        {/* Stats bar */}
        <div className="mt-3 flex gap-4 text-sm text-slate-400">
          <span><span className="font-semibold text-white">{messages.length}</span> mensagens</span>
          <span><span className="font-semibold text-blue-400">{outboundCount}</span> enviadas pelo agente</span>
          <span><span className="font-semibold text-amber-400">{inboundCount}</span> respostas do lead</span>
          {messages.length > 0 && (
            <span>
              Início em{' '}
              {new Date(messages[0]!.sent_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* Message thread */}
      <Card className="overflow-hidden">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <p className="text-sm font-bold text-white">Nenhuma mensagem ainda</p>
            <p className="text-sm text-slate-400">
              As mensagens aparecem aqui quando o WhatsApp estiver conectado e o agente iniciar contato.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {messages.map((msg, idx) => {
              const isInbound = msg.direction === 'inbound'
              const delivery = MSG_DELIVERY[msg.status]

              const currentDay = new Date(msg.sent_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
              const prevDay =
                idx > 0
                  ? new Date(messages[idx - 1]!.sent_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
                  : null
              const showDayDivider = currentDay !== prevDay

              return (
                <div key={msg.id}>
                  {showDayDivider && (
                    <div className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
                      <span className="text-xs font-medium text-slate-500 capitalize">{currentDay}</span>
                      <div className="flex-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
                    </div>
                  )}

                  <div
                    className="flex gap-3 px-5 py-3"
                    style={{
                      background: isInbound ? 'rgba(245,158,11,0.04)' : undefined,
                      borderBottom: idx < messages.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                    }}
                  >
                    {/* Avatar */}
                    <div
                      className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={isInbound
                        ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
                        : { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }}
                    >
                      {isInbound ? lead.company_name.slice(0, 2).toUpperCase() : 'SDR'}
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-200">
                          {isInbound ? lead.company_name : 'Agente SDR'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(msg.sent_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {!isInbound && delivery && (
                          <span className={`text-xs ${delivery.color}`} title={delivery.label}>{delivery.icon}</span>
                        )}
                        {msg.channel === 'email' && (
                          <span className="rounded px-1.5 py-0.5 text-xs text-slate-400" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            e-mail
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Notes */}
      {lead.notes && (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">Observações</p>
          <p className="mt-1 text-sm text-amber-200 whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}
    </div>
  )
}
