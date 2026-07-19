import Link from 'next/link'
import { UserPlus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import type { Customer, Unit } from '@/lib/types'
import { getAppUser } from '@/lib/app-user'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import { getCustomerTerm } from '@/lib/verticals/terminology'
import {
  Badge,
  type BadgeVariant,
  Card,
  EmptyState,
  Label,
  PageHeader,
  PrimaryButton,
  Select,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativo' },
  { value: 'inactive', label: 'Inativo' },
]

const STATUS_VARIANT: Record<string, BadgeVariant> = { active: 'green', inactive: 'slate' }

function sourceLabel(source: string): string {
  if (source === 'sales') return 'AI Sales Rep'
  if (source === 'manual') return 'Manual'
  return source
}

type CustomerWithUnit = Customer & { unit: { name: string } | null }

export default async function ReceptionistCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; status?: string; source?: string; page?: string }>
}) {
  const params = await searchParams
  const page = Math.max(1, Number(params.page) || 1)
  const offset = (page - 1) * PAGE_SIZE

  const supabase = await createClient()
  const appUser = await getAppUser()
  const verticalKey = await fetchOrganizationVerticalKey(supabase, appUser?.orgId)
  const term = getCustomerTerm(verticalKey, 'pt')
  const termPlural = getCustomerTerm(verticalKey, 'pt', { plural: true })

  const { data: units } = await supabase.from('units').select('id, name').order('name')
  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'name'>[]

  let query = supabase
    .from('customers')
    .select('*, unit:units(name)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (params.unit) query = query.eq('unit_id', params.unit)
  if (params.status) query = query.eq('status', params.status)
  if (params.source) query = query.eq('source', params.source)

  const { data: customers, count } = await query

  const rows = (customers ?? []) as unknown as CustomerWithUnit[]
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = !!(params.unit || params.status || params.source)

  function pageHref(targetPage: number) {
    const q = new URLSearchParams()
    if (params.unit) q.set('unit', params.unit)
    if (params.status) q.set('status', params.status)
    if (params.source) q.set('source', params.source)
    q.set('page', String(targetPage))
    return `/dashboard/receptionist/customers?${q.toString()}`
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="ai receptionist"
        title={termPlural}
        subtitle={`Cadastro de ${termPlural.toLowerCase()} de todas as unidades.${total > 0 ? ` ${total} no total.` : ''}`}
        action={<PrimaryButton href="/dashboard/receptionist/customers/new" icon={<UserPlus size={14} />}>Novo {term.toLowerCase()}</PrimaryButton>}
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
            <Label htmlFor="source">Origem</Label>
            <Select id="source" name="source" defaultValue={params.source ?? ''}>
              <option value="">Todas</option>
              <option value="sales">AI Sales Rep</option>
              <option value="manual">Manual</option>
            </Select>
          </div>

          <button
            type="submit"
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            Filtrar
          </button>
          {hasFilters && (
            <Link
              href="/dashboard/receptionist/customers"
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Limpar filtros
            </Link>
          )}
        </form>
      </Card>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<UserPlus size={22} className="text-white" />}
            title={`Nenhum ${term.toLowerCase()} encontrado`}
            subtitle={hasFilters ? `Ajuste os filtros ou cadastre um novo ${term.toLowerCase()}.` : `${termPlural} aparecem aqui automaticamente quando um negócio fecha, ou cadastre um manualmente.`}
            actionHref="/dashboard/receptionist/customers/new"
            actionLabel={`Cadastrar ${term.toLowerCase()}`}
          />
        ) : (
          <table className="w-full text-left text-sm">
            <TableShell>
              <Th>Nome</Th>
              <Th>Telefone</Th>
              <Th>Cidade</Th>
              <Th>Unidade</Th>
              <Th>Origem</Th>
              <Th>Status</Th>
              <Th>Cadastrado em</Th>
            </TableShell>
            <tbody>
              {rows.map((customer) => (
                <Tr key={customer.id}>
                  <Td>
                    <Link href={`/dashboard/receptionist/customers/${customer.id}`} className="font-semibold text-white transition-colors hover:text-cyan-400">
                      {customer.name}
                    </Link>
                  </Td>
                  <Td className="text-slate-400">{customer.phone ?? '—'}</Td>
                  <Td className="text-slate-400">{customer.city ?? '—'}</Td>
                  <Td className="text-slate-400">{customer.unit?.name ?? '—'}</Td>
                  <Td className="text-slate-400">{sourceLabel(customer.source)}</Td>
                  <Td>
                    <Badge variant={STATUS_VARIANT[customer.status] ?? 'slate'}>
                      {STATUS_OPTIONS.find((s) => s.value === customer.status)?.label ?? customer.status}
                    </Badge>
                  </Td>
                  <Td className="text-slate-400">{new Date(customer.created_at).toLocaleDateString('pt-BR')}</Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>Página {page} de {totalPages} — {total} clientes</span>
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
