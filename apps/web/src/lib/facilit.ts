import { todayInTimezone } from './service-operations-month'

/**
 * Cliente da API interna da Facil-IT (tech.facilit.fm/mobileapp) — não é
 * uma API pública documentada, foi descoberta observando a sessão já
 * autenticada de um usuário real da Mawi Pro (2026-09-10), com autorização
 * do Vinicius, nunca vendo a senha em si. Login novo a cada sync em vez de
 * cachear o token: era um pedido explícito ("depois de logado e conectado,
 * não pode cair") e o token não trouxe nenhum campo de expiração visível,
 * então relogar é mais simples e mais seguro que tentar adivinhar quando
 * renovar.
 */

const FACILIT_BASE_URL = 'https://tech.facilit.fm/MobileAppApi/api'

export type FacilitCredentials = {
  clientCode: string
  username: string
  password: string
}

export type FacilitSession = {
  token: string
  clientCode: string
  username: string
}

export class FacilitAuthError extends Error {}

/**
 * Endpoint de login descoberto por engenharia reversa do app (2026-09-10):
 * o método "Login" do app na verdade faz POST pra /devices — mesmo
 * endpoint já confirmado real por GET durante a reconexão original
 * (devolvia dado, não 404). Provável login-com-registro-de-aparelho
 * combinado num só request, padrão comum em apps mobile.
 */
export async function facilitLogin(creds: FacilitCredentials): Promise<FacilitSession> {
  const res = await fetch(`${FACILIT_BASE_URL}/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
    body: JSON.stringify({ ClientCode: creds.clientCode, UserName: creds.username, Password: creds.password }),
  })
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    const detail = bodyText ? ` Resposta do servidor: ${bodyText.slice(0, 300)}` : ''
    throw new FacilitAuthError(`Login na Facil-IT falhou (status ${res.status}) — verifique Client Code/usuário/senha.${detail}`)
  }
  const data = (await res.json().catch(() => null)) as { token?: string; AuthCode?: string; authCode?: string; Token?: string } | null
  const token = data?.token ?? data?.AuthCode ?? data?.authCode ?? data?.Token
  if (!token) {
    throw new FacilitAuthError('Login na Facil-IT não retornou um token válido.')
  }
  return { token, clientCode: creds.clientCode, username: creds.username }
}

/** Payload cru de uma ordem de serviço como a API da Facil-IT devolve — só os campos que usamos. */
export type FacilitRawOrder = {
  orderNumber?: string | number
  poNumber?: string
  clientPO?: string
  clientPoNumber?: string
  company?: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  zip?: string
  phoneNumber?: string
  category?: string
  orderType?: string
  priority?: string
  status?: string
  inputDate?: string
  visitDate?: string
  latitude?: number | string
  longitude?: number | string
  scope?: string
  [key: string]: unknown
}

export async function fetchFacilitOrders(session: FacilitSession): Promise<FacilitRawOrder[]> {
  const res = await fetch(`${FACILIT_BASE_URL}/orders`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      authtoken: session.token,
      UserName: session.username,
      ClientCode: session.clientCode,
    },
  })
  if (res.status === 401 || res.status === 403) {
    throw new FacilitAuthError(`Sessão da Facil-IT rejeitada ao buscar ordens (status ${res.status}).`)
  }
  if (!res.ok) {
    throw new Error(`Falha ao buscar ordens da Facil-IT (status ${res.status}).`)
  }
  const data = (await res.json().catch(() => null)) as FacilitRawOrder[] | null
  return Array.isArray(data) ? data : []
}

/** Linha pronta pra upsert em facilit_work_orders, a partir de uma ordem crua da Facil-IT. */
export type MappedFacilitOrder = {
  facilit_order_number: string
  po_number: string | null
  client_po: string | null
  company: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  category: string | null
  order_type: string | null
  priority: string | null
  status: string | null
  requested_at: string | null
  visit_date: string | null
  latitude: number | null
  longitude: number | null
  scope: string | null
  raw: FacilitRawOrder
}

/**
 * A Facil-IT nunca confirmou o formato exato de data em produção (a
 * reconexão foi interrompida por segurança antes de inspecionar um valor
 * bruto de visitDate) — tenta ISO primeiro, senão deixa o Date nativo
 * tentar (cobre "MM/DD/YYYY hh:mm AM/PM", formato mais comum em APIs
 * americanas). Nunca lança: data não reconhecida vira null, mas o valor
 * bruto sempre fica preservado em `raw` pra investigar depois.
 */
function parseFacilitDate(value: string | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseCoordinate(value: number | string | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function mapFacilitOrder(raw: FacilitRawOrder): MappedFacilitOrder | null {
  const orderNumber = raw.orderNumber !== undefined && raw.orderNumber !== null ? String(raw.orderNumber) : null
  if (!orderNumber) return null

  return {
    facilit_order_number: orderNumber,
    po_number: raw.poNumber ?? null,
    client_po: raw.clientPO ?? raw.clientPoNumber ?? null,
    company: raw.company ?? null,
    address1: raw.address1 ?? null,
    address2: raw.address2 ?? null,
    city: raw.city ?? null,
    state: raw.state ?? null,
    zip: raw.zip ?? null,
    phone: raw.phoneNumber ?? null,
    category: raw.category ?? null,
    order_type: raw.orderType ?? null,
    priority: raw.priority ?? null,
    status: raw.status ?? null,
    requested_at: parseFacilitDate(raw.inputDate),
    visit_date: parseFacilitDate(raw.visitDate),
    latitude: parseCoordinate(raw.latitude),
    longitude: parseCoordinate(raw.longitude),
    scope: raw.scope ?? null,
    raw,
  }
}

/**
 * Só hoje + amanhã no fuso da unidade — o pedido foi "buscar as ordens do
 * dia e dia seguinte", não o histórico inteiro. Ordem sem visit_date
 * reconhecido fica de fora (não tem como saber se é "hoje").
 */
export function filterOrdersForTodayAndTomorrow(orders: MappedFacilitOrder[], timezone: string): MappedFacilitOrder[] {
  const today = todayInTimezone(timezone)
  const tomorrowDate = new Date(`${today}T12:00:00Z`)
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1)
  const tomorrowStr = tomorrowDate.toISOString().slice(0, 10)

  return orders.filter((order) => {
    if (!order.visit_date) return false
    const visitDay = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(order.visit_date))
    return visitDay === today || visitDay === tomorrowStr
  })
}
