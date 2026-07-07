import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Conversation, Lead } from '@/lib/types'

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700',
  contacted: 'bg-blue-100 text-blue-700',
  replied: 'bg-amber-100 text-amber-700',
  negotiating: 'bg-purple-100 text-purple-700',
  won: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
  paused: 'bg-orange-100 text-orange-700',
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
  sent: { icon: '✓', color: 'text-gray-400', label: 'Enviado' },
  delivered: { icon: '✓✓', color: 'text-gray-400', label: 'Entregue' },
  read: { icon: '✓✓', color: 'text-blue-500', label: 'Lido' },
  failed: { icon: '✗', color: 'text-red-500', label: 'Falhou' },
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
        <Link
          href="/dashboard/conversations"
          className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          ← Voltar para Conversas
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-gray-900">{lead.company_name}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
              {lead.phone && (
                <span className="font-mono">{lead.phone}</span>
              )}
              {lead.unit?.name && (
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {lead.unit.name}
                </span>
              )}
              {(lead.city || lead.state) && (
                <span>
                  {lead.city ?? ''}
                  {lead.state ? `, ${lead.state}` : ''}
                </span>
              )}
              {lead.sector && (
                <span className="capitalize text-gray-400">{lead.sector}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                STATUS_COLOR[lead.status] ?? 'bg-gray-100 text-gray-700'
              }`}
            >
              {STATUS_LABELS[lead.status] ?? lead.status}
            </span>
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-3 flex gap-4 text-sm text-gray-500">
          <span>
            <span className="font-semibold text-gray-800">{messages.length}</span> mensagens
          </span>
          <span>
            <span className="font-semibold text-blue-600">{outboundCount}</span> enviadas pelo agente
          </span>
          <span>
            <span className="font-semibold text-amber-600">{inboundCount}</span> respostas do lead
          </span>
          {messages.length > 0 && (
            <span>
              Início em{' '}
              {new Date(messages[0].sent_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </div>

      {/* Message thread */}
      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <p className="text-sm font-medium text-gray-900">Nenhuma mensagem ainda</p>
            <p className="text-sm text-gray-400">
              As mensagens aparecem aqui quando o WhatsApp estiver conectado e o agente iniciar contato.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {messages.map((msg, idx) => {
              const isInbound = msg.direction === 'inbound'
              const delivery = MSG_DELIVERY[msg.status]

              // Date separator
              const currentDay = new Date(msg.sent_at).toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
              })
              const prevDay =
                idx > 0
                  ? new Date(messages[idx - 1].sent_at).toLocaleDateString('pt-BR', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'long',
                    })
                  : null
              const showDayDivider = currentDay !== prevDay

              return (
                <div key={msg.id}>
                  {showDayDivider && (
                    <div className="flex items-center gap-3 px-5 py-3">
                      <div className="flex-1 border-t border-gray-100" />
                      <span className="text-xs font-medium text-gray-400 capitalize">{currentDay}</span>
                      <div className="flex-1 border-t border-gray-100" />
                    </div>
                  )}

                  <div
                    className={`flex gap-3 px-5 py-3 ${
                      isInbound ? 'bg-amber-50/40' : ''
                    } ${idx < messages.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    {/* Avatar */}
                    <div
                      className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        isInbound
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {isInbound
                        ? lead.company_name.slice(0, 2).toUpperCase()
                        : 'SDR'}
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-gray-700">
                          {isInbound ? lead.company_name : 'Agente SDR'}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(msg.sent_at).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {!isInbound && delivery && (
                          <span
                            className={`text-xs ${delivery.color}`}
                            title={delivery.label}
                          >
                            {delivery.icon}
                          </span>
                        )}
                        {msg.channel === 'email' && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                            e-mail
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      {lead.notes && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Observações</p>
          <p className="mt-1 text-sm text-amber-900 whitespace-pre-wrap">{lead.notes}</p>
        </div>
      )}
    </div>
  )
}
