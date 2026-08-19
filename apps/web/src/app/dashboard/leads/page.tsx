import Link from 'next/link'
import { Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Lead, LeadEnrichmentStatus, Unit } from '@/lib/types'
import { Badge, type BadgeVariant, Card, EmptyState, Label, PageHeader, Select, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import { LeadRetryEnrichmentButton } from '@/components/dashboard/lead-retry-enrichment-button'

const PAGE_SIZE = 20

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'contacted', label: 'Contatado' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'negotiating', label: 'Negociando' },
  { value: 'won', label: 'Convertido' },
  { value: 'lost', label: 'Perdido' },
  { value: 'paused', label: 'Pausado' },
  { value: 'imported_pending_review', label: 'Importado — aguardando revisão' },
]

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  new: 'slate',
  contacted: 'blue',
  replied: 'amber',
  negotiating: 'purple',
  won: 'green',
  lost: 'red',
  paused: 'slate',
  imported_pending_review: 'amber',
}

// Setores agora são texto livre (perfil de segmentação, migration 049) —
// os rótulos fixos ficam só para exibir bonito os valores legados.
const SECTOR_LABELS: Record<string, string> = {
  tecnologia: 'Tecnologia',
  industria: 'Indústria',
  comercio: 'Comércio',
  servicos: 'Serviços',
  saude: 'Saúde',
  educacao: 'Educação',
}

type LeadWithUnit = Lead & { unit: { name: string } | null }

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const ms = Date.now() - new Date(dateStr).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function DaysBadge({ days }: { days: number | null }) {
  if (days === null) return <span className="text-slate-500">—</span>
  const variant: BadgeVariant = days > 7 ? 'red' : days > 3 ? 'amber' : 'green'
  return <Badge variant={variant}>{days === 0 ? 'hoje' : `${days}d`}</Badge>
}

// Achado P1.1 da auditoria (18-19/08/2026): antes, um lead sem e-mail
// encontrado ficava travado pra sempre sem qualquer sinal na UI. Agora o
// estado de enrichment fica visível, com retry automático (cron de
// prospecção, que já reprocessa leads 'new' periodicamente) e um botão
// manual pra forçar agora.
const ENRICHMENT_LABEL: Record<LeadEnrichmentStatus, string> = {
  enrichment_pending: 'Ainda não pesquisado',
  enrichment_processing: 'Pesquisando…',
  email_found: 'E-mail encontrado',
  email_not_found: 'Sem e-mail (esgotou tentativas)',
  retry_scheduled: 'Sem e-mail — retry agendado',
  enrichment_failed: 'Erro na pesquisa',
}

function EnrichmentCell({ lead }: { lead: Lead }) {
  if (lead.email) {
    return <span className="text-slate-300">{lead.email}</span>
  }
  const status = lead.enrichment_status ?? 'enrichment_pending'
  const showRetry = status === 'email_not_found' || status === 'retry_scheduled' || status === 'enrichment_failed'
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-xs text-slate-500">{ENRICHMENT_LABEL[status]}</span>
      {showRetry && <LeadRetryEnrichmentButton leadId={lead.id} />}
    </div>
  )
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; status?: string; sector?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()

  const { data: units } = await supabase.from('units').select('id, name').order('name')
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'name'>[]

  // Opções do filtro de setor a partir dos setores que existem de fato nos
  // leads (texto livre desde a migration 049 — não há mais lista fixa).
  const { data: sectorRows } = await supabase.from('leads').select('sector').not('sector', 'is', null).limit(1000)
  const sectorOptions = Array.from(
    new Set(((sectorRows as Pick<Lead, 'sector'>[] | null) ?? []).map((row) => row.sector as string)),
  ).sort((a, b) => a.localeCompare(b, 'pt'))

  let query = supabase
    .from('leads')
    .select('*, unit:units(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (params.unit) query = query.eq('unit_id', params.unit)
  if (params.status) query = query.eq('status', params.status)
  if (params.sector) query = query.eq('sector', params.sector)

  const { data: leads, count } = await query

  const leadRows = (leads ?? []) as unknown as LeadWithUnit[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function pageHref(targetPage: number) {
    const q = new URLSearchParams()
    if (params.unit) q.set('unit', params.unit)
    if (params.status) q.set('status', params.status)
    if (params.sector) q.set('sector', params.sector)
    q.set('page', String(targetPage))
    return `/dashboard/leads?${q.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="prospecção"
        title="Leads"
        subtitle={`Leads prospectados pelo AI Sales Representative em todas as unidades.${total > 0 ? ` ${total} no total.` : ''}`}
      />

      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unit">Unidade</Label>
            <Select id="unit" name="unit" defaultValue={params.unit ?? ''}>
              <option value="">Todas</option>
              {unitRows.map((unit) => (
                <option key={unit.id} value={unit.id}>{unit.name}</option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={params.status ?? ''}>
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sector">Setor</Label>
            <Select id="sector" name="sector" defaultValue={params.sector ?? ''}>
              <option value="">Todos</option>
              {sectorOptions.map((sector) => (
                <option key={sector} value={sector}>{SECTOR_LABELS[sector] ?? sector}</option>
              ))}
            </Select>
          </div>

          <button
            type="submit"
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Filtrar
          </button>
          {(params.unit || params.status || params.sector) && (
            <Link
              href="/dashboard/leads"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Limpar filtros
            </Link>
          )}
        </form>
      </Card>

      <Card className="overflow-hidden">
        {leadRows.length === 0 ? (
          <EmptyState
            icon={<Users size={22} className="text-white" />}
            title="Nenhum lead encontrado"
            subtitle="Ajuste os filtros ou prospecte novos leads em uma unidade."
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <TableShell>
              <Th>Empresa</Th>
              <Th>Telefone</Th>
              <Th>E-mail</Th>
              <Th>Cidade</Th>
              <Th>Unidade</Th>
              <Th>Status</Th>
              <Th>Último contato</Th>
              <Th>Sem resposta</Th>
            </TableShell>
            <tbody>
              {leadRows.map((lead) => {
                const days = daysSince(lead.last_contacted_at ?? lead.created_at)
                return (
                  <Tr key={lead.id}>
                    <Td>
                      <Link href={`/dashboard/conversations/${lead.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                        {lead.company_name}
                      </Link>
                    </Td>
                    <Td className="text-slate-400">{lead.phone ?? '—'}</Td>
                    <Td>
                      <EnrichmentCell lead={lead} />
                    </Td>
                    <Td className="text-slate-400">
                      {lead.city ?? '—'}
                      {lead.state ? `, ${lead.state}` : ''}
                    </Td>
                    <Td className="text-slate-400">{lead.unit?.name ?? '—'}</Td>
                    <Td>
                      <Badge variant={STATUS_VARIANT[lead.status] ?? 'slate'}>
                        {STATUS_OPTIONS.find((s) => s.value === lead.status)?.label ?? lead.status}
                      </Badge>
                    </Td>
                    <Td className="text-slate-400">
                      {lead.last_contacted_at
                        ? new Date(lead.last_contacted_at).toLocaleDateString('pt-BR')
                        : new Date(lead.created_at).toLocaleDateString('pt-BR')}
                    </Td>
                    <Td>
                      <DaysBadge days={days} />
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>Página {page} de {totalPages} — {total} leads</span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="rounded-xl px-3 py-1.5 transition-colors hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Anterior
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="rounded-xl px-3 py-1.5 transition-colors hover:bg-white/5"
                style={{ border: '1px solid rgba(255,255,255,0.08)' }}
              >
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
