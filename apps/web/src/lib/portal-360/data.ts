import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'
import { CLIENT_PORTAL_SOURCE } from '@/lib/portal-360/constants'

/**
 * Acesso a dados do Portal 360 (migration 061) — sempre via client de
 * service role (ver lib/supabase/service.ts), NUNCA via RLS ampla:
 * este é o primeiro login do sistema para alguém de fora da empresa,
 * então cada função aqui recebe `clientCompany` e filtra
 * explicitamente por ele (join `customers!inner(client_company)`) em
 * vez de confiar em policy de banco. O usuário 'client' tem org_id
 * NULL em public.users, então mesmo que algum código futuro use o
 * client autenticado da sessão por engano, can_access_unit()/
 * is_org_admin() já bloqueiam tudo — esta camada é a autorização de
 * verdade, não só defesa em profundidade.
 */

export type ClientPortalOrderStatus = 'pending_assignment' | 'scheduled' | 'completed' | 'quote' | 'cancelled'

export type ClientPortalOrder = {
  id: string
  unitId: string
  timezone: string
  customerName: string
  status: ClientPortalOrderStatus
  requestedDate: string | null
  startsAt: string
  endsAt: string
  address: string | null
  orderNumber: string | null
  locationName: string | null
  scopeEn: string | null
  fileUrl: string | null
  fileName: string | null
  signedBy: string | null
  signedAt: string | null
  signatureUrl: string | null
  photos: PortalServiceOrderPhoto[]
  createdAt: string
}

type ClientOrderRow = {
  id: string
  unit_id: string
  starts_at: string
  ends_at: string
  status: string
  employee_id: string | null
  source: string
  address: string | null
  service_order_requested_date: string | null
  service_order_status: string
  service_order_number: string | null
  service_order_location_name: string | null
  service_order_scope_en: string | null
  service_order_file_url: string | null
  service_order_file_name: string | null
  service_order_signed_by: string | null
  service_order_signed_at: string | null
  service_order_signature_url: string | null
  service_order_photos: PortalServiceOrderPhoto[] | null
  created_at: string
  customers: { name: string; client_company: string | null } | null
  units: { timezone: string | null } | null
}

const ORDER_SELECT_COLUMNS =
  'id, unit_id, starts_at, ends_at, status, employee_id, source, address, service_order_requested_date, service_order_status, service_order_number, service_order_location_name, service_order_scope_en, service_order_file_url, service_order_file_name, service_order_signed_by, service_order_signed_at, service_order_signature_url, service_order_photos, created_at, customers!inner(name, client_company), units(timezone)'

/** Deriva o status visível para a 360 — pura, testável sem banco. */
export function deriveClientOrderStatus(row: {
  status: string
  employee_id: string | null
  source: string
  service_order_status: string
}): ClientPortalOrderStatus {
  if (row.status === 'cancelled') return 'cancelled'
  if (!row.employee_id && row.source === CLIENT_PORTAL_SOURCE) return 'pending_assignment'
  if (row.service_order_status === 'completed') return 'completed'
  if (row.service_order_status === 'quote') return 'quote'
  return 'scheduled'
}

function toClientPortalOrder(row: ClientOrderRow): ClientPortalOrder {
  return {
    id: row.id,
    unitId: row.unit_id,
    timezone: row.units?.timezone ?? 'America/Sao_Paulo',
    customerName: row.customers?.name ?? '360 Service Provider',
    status: deriveClientOrderStatus(row),
    requestedDate: row.service_order_requested_date,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    address: row.address,
    orderNumber: row.service_order_number,
    locationName: row.service_order_location_name,
    scopeEn: row.service_order_scope_en,
    fileUrl: row.service_order_file_url,
    fileName: row.service_order_file_name,
    signedBy: row.service_order_signed_by,
    signedAt: row.service_order_signed_at,
    signatureUrl: row.service_order_signature_url,
    photos: row.service_order_photos ?? [],
    createdAt: row.created_at,
  }
}

/** Todas as ordens de todas as lojas da rede — a 360 tem UM login que enxerga tudo junto (nunca por loja). */
export async function fetchClientOrders(supabase: SupabaseClient, clientCompany: string): Promise<ClientPortalOrder[]> {
  const { data } = await supabase
    .from('appointments')
    .select(ORDER_SELECT_COLUMNS)
    .eq('customers.client_company', clientCompany)
    .order('created_at', { ascending: false })

  return ((data ?? []) as unknown as ClientOrderRow[]).map(toClientPortalOrder)
}

/** Uma ordem específica, restrita ao client_company do usuário logado — o join `customers!inner` já garante que uma ordem de outra rede nunca é devolvida (nem existência é revelada: mesmo 404 de "não existe" e "não é sua"). */
export async function fetchClientOrderById(
  supabase: SupabaseClient,
  clientCompany: string,
  appointmentId: string,
): Promise<ClientPortalOrder | null> {
  const { data } = await supabase
    .from('appointments')
    .select(ORDER_SELECT_COLUMNS)
    .eq('id', appointmentId)
    .eq('customers.client_company', clientCompany)
    .maybeSingle()

  const row = data as unknown as ClientOrderRow | null
  return row ? toClientPortalOrder(row) : null
}

export type ClientTargetCustomer = { id: string; unitId: string; orgId: string; timezone: string }

/**
 * Customer/unidade alvo para um novo pedido — reaproveita o customer
 * mais antigo já marcado com este client_company (mesmo padrão real
 * de uso hoje: um único cadastro "360 Service" concentra as ordens,
 * cada loja é só um `service_order_location_name` descritivo, nunca
 * um customer à parte — ver migration 061). Se nenhum existir ainda
 * (org nova, sem histórico), devolve null — a rota que chama pede
 * pro admin cadastrar o vínculo inicial antes, em vez de adivinhar
 * uma unidade.
 */
export async function resolveClientTargetCustomer(
  supabase: SupabaseClient,
  clientCompany: string,
): Promise<ClientTargetCustomer | null> {
  const { data } = await supabase
    .from('customers')
    .select('id, unit_id, org_id, units(timezone)')
    .eq('client_company', clientCompany)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const row = data as { id: string; unit_id: string; org_id: string; units: { timezone: string | null } | null } | null
  if (!row) return null
  return { id: row.id, unitId: row.unit_id, orgId: row.org_id, timezone: row.units?.timezone ?? 'America/Sao_Paulo' }
}
