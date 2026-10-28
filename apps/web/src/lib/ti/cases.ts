import type { SupabaseClient } from '@supabase/supabase-js'

export type SupportChannel = 'dashboard' | 'whatsapp' | 'sms' | 'email' | 'partner_api'
export type SupportCategory = 'guidance' | 'bug' | 'access' | 'integration' | 'billing' | 'other'

export type OpenSupportCaseInput = {
  orgId: string
  unitId?: string | null
  reporterUserId?: string | null
  reporterName?: string | null
  reporterEmail?: string | null
  reporterPhone?: string | null
  channel: SupportChannel
  category: SupportCategory
  title: string
  description: string
  diagnosis?: string | null
  sourceSystem?: 'ai_workforce' | 'partner'
  externalReference?: string | null
}

export type OpenSupportCaseResult = { id: string; protocol: string; created: boolean }

/**
 * Abre um chamado ou reaproveita o mesmo relato ainda aberto nas últimas
 * 24 horas. A deduplicação evita gerar um protocolo a cada mensagem do
 * mesmo atendimento de WhatsApp.
 */
export async function openSupportCase(
  supabase: SupabaseClient,
  input: OpenSupportCaseInput,
): Promise<OpenSupportCaseResult> {
  if (input.externalReference) {
    const { data: externalCase } = await supabase
      .from('support_cases')
      .select('id, protocol')
      .eq('source_system', input.sourceSystem ?? 'partner')
      .eq('external_reference', input.externalReference)
      .maybeSingle()
    if (externalCase) {
      return { id: externalCase.id as string, protocol: externalCase.protocol as string, created: false }
    }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  let existingQuery = supabase
    .from('support_cases')
    .select('id, protocol')
    .eq('org_id', input.orgId)
    .eq('description', input.description)
    .not('status', 'in', '(resolved,closed)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)

  existingQuery = input.unitId ? existingQuery.eq('unit_id', input.unitId) : existingQuery.is('unit_id', null)
  const { data: existing } = await existingQuery.maybeSingle()
  if (existing) return { id: existing.id as string, protocol: existing.protocol as string, created: false }

  const protocol = `TI-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`

  const { data, error } = await supabase
    .from('support_cases')
    .insert({
      protocol,
      org_id: input.orgId,
      unit_id: input.unitId ?? null,
      source_system: input.sourceSystem ?? 'ai_workforce',
      external_reference: input.externalReference ?? null,
      reporter_user_id: input.reporterUserId ?? null,
      reporter_name: input.reporterName ?? null,
      reporter_email: input.reporterEmail ?? null,
      reporter_phone: input.reporterPhone ?? null,
      channel: input.channel,
      category: input.category,
      title: input.title.slice(0, 180),
      description: input.description,
      diagnosis: input.diagnosis ?? null,
    })
    .select('id, protocol')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Não foi possível criar o chamado TI.')

  await supabase.from('support_case_messages').insert([
    {
      case_id: data.id,
      org_id: input.orgId,
      author_type: 'user',
      author_user_id: input.reporterUserId ?? null,
      content: input.description,
      metadata: { channel: input.channel },
    },
    ...(input.diagnosis
      ? [{
          case_id: data.id,
          org_id: input.orgId,
          author_type: 'agent',
          author_user_id: null,
          content: input.diagnosis,
          metadata: { kind: 'read_only_diagnosis' },
        }]
      : []),
  ])

  return { id: data.id as string, protocol: (data.protocol as string | undefined) ?? protocol, created: true }
}
