import type { SupabaseClient } from '@supabase/supabase-js'

/** Endereço por unidade que recebe as ordens: ordens+{unitId}@{EMAIL_INBOUND_DOMAIN}. */
export function intakeAddress(unitId: string, inboundDomain: string): string {
  return `ordens+${unitId}@${inboundDomain}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  return (match ? match[1]! : raw).trim().toLowerCase()
}

/** Unidade de destino de um e-mail de ordem; null se nenhum destinatário é um endereço ordens+{uuid}@domínio. */
export function findIntakeUnitId(recipients: string[], inboundDomain: string): string | null {
  for (const raw of recipients) {
    const match = extractEmailAddress(raw).match(/^ordens\+(.+)@(.+)$/i)
    if (match && match[2]!.toLowerCase() === inboundDomain.toLowerCase() && UUID_RE.test(match[1]!)) return match[1]!
  }
  return null
}

export type ReceivedAttachment = { id: string; filename: string | null; content_type: string | null; content_disposition: string | null; size: number | null }

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const ACCEPTED = /^(application\/pdf|image\/(png|jpe?g|webp|heic))$/i

/** O anexo que é a ordem: PDF primeiro, depois imagem; ignora imagens embutidas na assinatura do e-mail e arquivos grandes demais. */
export function pickOrderAttachment(attachments: ReceivedAttachment[]): ReceivedAttachment | null {
  const usable = attachments.filter((a) => a.content_type && ACCEPTED.test(a.content_type) && (a.size ?? 0) <= MAX_ATTACHMENT_BYTES && a.content_disposition !== 'inline')
  return usable.find((a) => /pdf/i.test(a.content_type ?? '')) ?? usable[0] ?? null
}

export function safeFileName(name: string | null | undefined, fallback = 'ordem'): string {
  const cleaned = (name ?? '').replace(/[^\w.\-]+/g, '_').replace(/^[._]+|_+$/g, '').slice(0, 80)
  return cleaned || fallback
}

/** Teto de ordens esperando aceite por unidade — freio contra spam no endereço público. */
export const MAX_AWAITING_PER_UNIT = 100

export type IntakeOutcome =
  | { ok: true; appointmentId: string; attached: boolean }
  | { ok: false; skipped: 'duplicate' | 'too_many_pending' | 'no_customer'; appointmentId?: string }
  | { ok: false; error: string }

type Deps = {
  supabase: SupabaseClient
  fetchImpl?: typeof fetch
  apiKey: string
}

/**
 * Cria a ordem "aguardando aceite" a partir do e-mail recebido. NÃO chama IA (sem custo): o administrador abre a ordem e usa o anexo/leitura
 * já existentes se quiser. A ordem nasce sem técnico, no horário em que chegou, ligada ao cliente cadastrado com aquele e-mail ou, na falta,
 * ao cadastro "Ordens por e-mail" (o administrador vincula ao cliente depois, em "Cliente desta ordem").
 */
export async function ingestOrderEmail(
  deps: Deps,
  input: { unit: { id: string; org_id: string | null }; emailId: string; from: string; subject: string | null; receivedAt: string; attachments: ReceivedAttachment[] },
): Promise<IntakeOutcome> {
  const { supabase, apiKey } = deps
  const doFetch = deps.fetchImpl ?? fetch
  const { unit, emailId } = input
  if (!unit.org_id) return { ok: false, error: 'Unidade sem empresa.' }

  const { data: existing } = await supabase.from('appointments').select('id').eq('unit_id', unit.id).eq('intake_email_id', emailId).maybeSingle()
  if (existing) return { ok: false, skipped: 'duplicate', appointmentId: (existing as { id: string }).id }

  const { count } = await supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('unit_id', unit.id).eq('intake_status', 'awaiting_accept')
  if ((count ?? 0) >= MAX_AWAITING_PER_UNIT) return { ok: false, skipped: 'too_many_pending' }

  const sender = extractEmailAddress(input.from)
  let customerId: string | null = null
  const { data: bySender } = await supabase.from('customers').select('id, client_company').eq('unit_id', unit.id).ilike('email', sender).limit(5)
  const matches = (Array.isArray(bySender) ? bySender : []) as { id: string; client_company: string | null }[]
  customerId = (matches.find((c) => c.client_company?.trim()) ?? matches[0])?.id ?? null
  if (!customerId) {
    const { data: placeholder } = await supabase.from('customers').select('id').eq('unit_id', unit.id).eq('source', 'email_intake').limit(1).maybeSingle()
    customerId = (placeholder as { id: string } | null)?.id ?? null
    if (!customerId) {
      const { data: created } = await supabase.from('customers').insert({ org_id: unit.org_id, unit_id: unit.id, name: 'Ordens por e-mail', source: 'email_intake' }).select('id').single()
      customerId = (created as { id: string } | null)?.id ?? null
    }
  }
  if (!customerId) return { ok: false, skipped: 'no_customer' }

  const startsAt = new Date(input.receivedAt)
  const start = Number.isNaN(startsAt.getTime()) ? new Date() : startsAt
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  const { data: inserted, error } = await supabase
    .from('appointments')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      customer_id: customerId,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      status: 'scheduled',
      source: 'email_intake',
      notes: input.subject ? `E-mail: ${input.subject}`.slice(0, 300) : null,
      intake_status: 'awaiting_accept',
      intake_email_id: emailId,
      intake_from: sender,
      intake_subject: input.subject?.slice(0, 300) ?? null,
    })
    .select('id')
    .single()
  if (error || !inserted) {
    // 23505 = o mesmo e-mail chegou duas vezes ao mesmo tempo: a outra requisição já criou
    if ((error as { code?: string } | null)?.code === '23505') return { ok: false, skipped: 'duplicate' }
    return { ok: false, error: 'Não foi possível criar a ordem.' }
  }
  const appointmentId = (inserted as { id: string }).id

  // Anexo é bônus: a ordem já existe e o administrador vê o e-mail de origem mesmo se o arquivo falhar.
  let attached = false
  const picked = pickOrderAttachment(input.attachments)
  if (picked) {
    try {
      const meta = await doFetch(`https://api.resend.com/emails/receiving/${emailId}/attachments/${picked.id}`, { headers: { Authorization: `Bearer ${apiKey}` } })
      const info = meta.ok ? ((await meta.json().catch(() => null)) as { download_url?: string } | null) : null
      const file = info?.download_url ? await doFetch(info.download_url) : null
      if (file?.ok) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (bytes.byteLength > 0 && bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
          const name = safeFileName(picked.filename)
          const path = `${unit.id}/${appointmentId}/ordem-${Date.now()}-${name}`
          const up = await supabase.storage.from('service-orders').upload(path, bytes, { contentType: picked.content_type ?? 'application/pdf', upsert: true })
          if (!up.error) {
            const { data: pub } = supabase.storage.from('service-orders').getPublicUrl(path)
            const upd = await supabase.from('appointments').update({ service_order_file_url: pub.publicUrl, service_order_file_name: picked.filename ?? name }).eq('id', appointmentId)
            attached = !upd.error
          }
        }
      }
    } catch {
      attached = false
    }
  }
  return { ok: true, appointmentId, attached }
}
