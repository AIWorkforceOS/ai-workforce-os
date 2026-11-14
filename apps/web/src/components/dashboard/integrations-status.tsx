import { createClient } from '@/lib/supabase/server'
import { getIntegrationsConfigStatus } from '@/lib/integrations'
import type { SystemEvent } from '@/lib/system-events'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { IntegrationHealthButton } from './integration-health-button'

const cardStyle = {
  background: '#141a2b',
  boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)',
}

const LEVEL_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  error: { bg: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' },
  warning: { bg: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' },
  info: { bg: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)', color: '#60a5fa' },
}

function budgetLabel(name: string): string {
  const raw = process.env[name]?.trim()
  if (!raw) return 'Limite mensal não definido'
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return 'Limite mensal inválido'
  return `Limite: US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês`
}

/**
 * Indicadores críticos no topo da home do super admin. O checklist completo
 * continua no fim da página; aqui ficam os serviços que podem parar a operação.
 */
export function EssentialIntegrationsStrip() {
  const statuses = getIntegrationsConfigStatus()
  const wanted = ['openai', 'google_maps', 'meta_whatsapp', 'evolution'] as const
  const byKey = new Map(statuses.map((status) => [status.key, status]))
  const items = wanted.flatMap((key) => {
    const status = byKey.get(key)
    if (!status) return []
    const sub = key === 'openai'
      ? budgetLabel('OPENAI_MONTHLY_BUDGET_USD')
      : key === 'google_maps'
        ? budgetLabel('GOOGLE_MAPS_MONTHLY_BUDGET_USD')
        : key === 'meta_whatsapp'
          ? 'Configuração técnica; aprovação da Meta é acompanhada separadamente'
          : 'Canal alternativo do WhatsApp'
    return [{ ...status, sub }]
  })

  return (
    <section aria-labelledby="essential-integrations-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">operação crítica</p>
          <h2 id="essential-integrations-title" className="text-sm font-bold text-white">Serviços essenciais</h2>
        </div>
        <p className="text-[10px] text-slate-500">Sem exibir chaves ou dados sensíveis</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.key}
            className="rounded-2xl p-4"
            style={{
              background: item.configured ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
              border: item.configured ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(239,68,68,0.22)',
            }}
            title={item.detail}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-bold text-white">{item.label}</p>
              {item.configured
                ? <CheckCircle2 size={15} className="flex-shrink-0 text-green-400" />
                : <XCircle size={15} className="flex-shrink-0 text-red-400" />}
            </div>
            <p className={`mt-2 text-[11px] font-bold ${item.configured ? 'text-green-400' : 'text-red-400'}`}>
              {item.configured ? 'Configurado' : 'Ação necessária'}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">{item.sub}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Saúde das integrações + últimos eventos de sistema.
 * - super_admin: vê o checklist de env vars da plataforma + botão de teste ao vivo
 * - cliente: vê apenas os eventos da própria organização (RLS)
 */
export async function IntegrationsStatusCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const supabase = await createClient()

  const { data: events } = await supabase
    .from('system_events')
    .select('*')
    .in('level', ['warning', 'error'])
    .order('created_at', { ascending: false })
    .limit(6)

  const eventRows = (events ?? []) as SystemEvent[]
  const integrations = isSuperAdmin ? getIntegrationsConfigStatus() : []
  const missing = integrations.filter((i) => !i.configured)

  return (
    <div className="rounded-2xl p-5" style={cardStyle}>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">monitoramento</p>
          <h2 className="text-sm font-bold text-white">Saúde das integrações</h2>
        </div>
        {isSuperAdmin && <IntegrationHealthButton />}
      </div>

      {isSuperAdmin && (
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {integrations.map((integration) => (
            <div
              key={integration.key}
              className="flex items-start gap-2.5 rounded-xl p-3"
              style={{
                background: integration.configured ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                border: integration.configured
                  ? '1px solid rgba(34,197,94,0.15)'
                  : '1px solid rgba(239,68,68,0.18)',
              }}
              title={integration.detail}
            >
              {integration.configured ? (
                <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-green-400" />
              ) : (
                <XCircle size={14} className="mt-0.5 flex-shrink-0 text-red-400" />
              )}
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-white">{integration.label}</p>
                <p className="text-[10px]" style={{ color: integration.configured ? '#4ade80' : '#f87171' }}>
                  {integration.configured ? 'Configurada' : 'Não configurada'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {isSuperAdmin && missing.length > 0 && (
        <p className="mb-4 rounded-xl px-3 py-2 text-[11px] text-amber-300" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
          {missing.length} integração{missing.length > 1 ? 'ões' : ''} sem chave configurada — o recurso
          correspondente vai falhar de forma visível (evento registrado abaixo) até a env var ser
          adicionada na Vercel.
        </p>
      )}

      <div>
        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
          Últimos avisos e erros
        </p>
        {eventRows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <CheckCircle2 size={13} className="text-green-400" />
            <p className="text-xs text-green-300">Nenhuma falha registrada recentemente.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {eventRows.map((event) => {
              const style = LEVEL_STYLE[event.level] ?? LEVEL_STYLE.info!
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-2.5 rounded-xl px-3 py-2"
                  style={{ background: style.bg, border: style.border }}
                >
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: style.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">{event.message}</p>
                    <p className="text-[10px] text-slate-500">
                      {event.source} · {event.event_type} ·{' '}
                      {new Date(event.created_at).toLocaleString('pt-BR')}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
