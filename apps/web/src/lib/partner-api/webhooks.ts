import { createHmac, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Eventos para parceiros: cada evento é gravado em partner_events (também
// consultável por polling) e entregue por POST assinado aos endpoints
// ativos da organização que assinam aquele tipo.
//
// Assinatura: header `Alizo-Signature: t=<unix>,v1=<hex>` onde
// v1 = HMAC-SHA256(secret, `${t}.${corpo}`). O parceiro deve recusar
// entregas com t muito antigo (sugestão: > 5 min) para evitar replay.

export const PARTNER_EVENT_TYPES = [
  'lead.created',
  'lead.message.received',
  'lead.message.sent',
  'lead.deal_won',
] as const

export type PartnerEventType = (typeof PARTNER_EVENT_TYPES)[number]

const DELIVERY_TIMEOUT_MS = 5000

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`
}

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/**
 * Bloqueia URLs que não sejam https público (anti-SSRF básico). Não resolve
 * DNS: um hostname público que aponte para IP interno ainda passaria — o
 * risco residual é aceito porque as entregas só vão para URLs que o próprio
 * admin da org cadastrou, e a resposta nunca é devolvida ao chamador.
 */
export function validateWebhookUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'url é obrigatória.' }
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, error: 'url inválida.' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'A URL do webhook precisa ser https.' }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const privateHost =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^0\./.test(host)
  if (privateHost) return { ok: false, error: 'A URL do webhook não pode apontar para endereço interno.' }
  if (parsed.username || parsed.password) return { ok: false, error: 'A URL do webhook não pode conter credenciais.' }
  return { ok: true, url: parsed.toString() }
}

type EndpointRow = {
  id: string
  api_key_id: string
  url: string
  secret: string
  events: string[] | null
  is_active: boolean
}

/**
 * Registra o evento e entrega aos endpoints inscritos. Nunca lança: um
 * parceiro fora do ar não pode quebrar o fluxo de atendimento do lead.
 */
export async function emitPartnerEvent(
  supabase: SupabaseClient,
  params: { orgId: string | null | undefined; unitId?: string | null; type: PartnerEventType; data: Record<string, unknown> },
): Promise<void> {
  try {
    if (!params.orgId) return

    const { data: endpointRows } = await supabase
      .from('partner_webhook_endpoints')
      .select('id, api_key_id, url, secret, events, is_active')
      .eq('org_id', params.orgId)
      .eq('is_active', true)
    const endpoints = ((endpointRows as EndpointRow[] | null) ?? []).filter((e) => {
      const events = e.events ?? []
      return events.includes('*') || events.includes(params.type)
    })

    // Sem nenhum endpoint, o evento ainda fica gravado para polling —
    // mas só vale a pena guardar se existir alguma chave de parceiro na org.
    const { data: keyRows } = await supabase
      .from('partner_api_keys')
      .select('id, unit_id, revoked_at')
      .eq('org_id', params.orgId)
    const keys = ((keyRows as { id: string; unit_id: string | null; revoked_at: string | null }[] | null) ?? []).filter(
      (k) => !k.revoked_at,
    )
    if (keys.length === 0) return

    const { data: eventRow } = await supabase
      .from('partner_events')
      .insert({
        org_id: params.orgId,
        unit_id: params.unitId ?? null,
        type: params.type,
        data: params.data,
      })
      .select('id, created_at')
      .single()
    const event = eventRow as { id: string; created_at: string } | null
    if (!event) return

    // Chave restrita a uma unidade só recebe eventos dessa unidade.
    const keyUnit = new Map(keys.map((k) => [k.id, k.unit_id]))
    const targets = endpoints.filter((e) => {
      if (!keyUnit.has(e.api_key_id)) return false // chave revogada
      const restricted = keyUnit.get(e.api_key_id)
      return !restricted || restricted === params.unitId
    })

    await Promise.all(
      targets.map((endpoint) =>
        deliver(supabase, endpoint, {
          id: event.id,
          type: params.type,
          created_at: event.created_at,
          org_id: params.orgId as string,
          unit_id: params.unitId ?? null,
          data: params.data,
        }),
      ),
    )
  } catch (error) {
    console.error(`[partner_api] falha ao emitir evento: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function deliver(
  supabase: SupabaseClient,
  endpoint: EndpointRow,
  event: Record<string, unknown> & { id: string },
): Promise<void> {
  const body = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signWebhookPayload(endpoint.secret, timestamp, body)

  let ok = false
  let statusCode: number | null = null
  let error: string | null = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS)
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AlizoAI-Webhooks/1.0',
        'Alizo-Event': String(event.type),
        'Alizo-Event-Id': event.id,
        'Alizo-Signature': `t=${timestamp},v1=${signature}`,
      },
      body,
      signal: controller.signal,
      redirect: 'manual', // não segue redirecionamentos (evita desvio para host interno)
      cache: 'no-store',
    })
    statusCode = response.status
    ok = response.status >= 200 && response.status < 300
    if (!ok) error = `Resposta HTTP ${response.status}`
  } catch (err) {
    error = err instanceof Error && err.name === 'AbortError' ? 'Timeout (5s)' : 'Erro de conexão'
  } finally {
    clearTimeout(timer)
  }

  await supabase.from('partner_webhook_deliveries').insert({
    endpoint_id: endpoint.id,
    event_id: event.id,
    ok,
    status_code: statusCode,
    error,
  })
}
