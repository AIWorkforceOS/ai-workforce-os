import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_SMARTER_TEMPLATE_VERSION = 1

export function slugBase(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'unidade'
}

export async function uniqueUnitSlug(db: SupabaseClient, name: string, externalId: string): Promise<string> {
  const base = slugBase(name)
  const suffix = slugBase(externalId).slice(-8) || crypto.randomUUID().slice(0, 8)
  const candidate = `${base}-${suffix}`.slice(0, 60)
  const { data } = await db.from('units').select('id').eq('slug', candidate).maybeSingle()
  return data ? `${base}-${crypto.randomUUID().slice(0, 8)}`.slice(0, 60) : candidate
}

export async function provisionPartnerUnit(db: SupabaseClient, params: { orgId: string; unitId: string }) {
  const { data: templateRow } = await db.from('partner_org_templates').select('version, template').eq('org_id', params.orgId).maybeSingle()
  const row = templateRow as { version: number; template: Record<string, unknown> } | null
  const template = row?.template ?? {}
  const activeHours = template.active_hours ?? { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] }
  const dailyLimit = Number(template.daily_limit ?? 15)
  const sales = (template.sales ?? {}) as Record<string, unknown>
  const recruiter = (template.recruiter ?? {}) as Record<string, unknown>
  const configs = [
    { unit_id: params.unitId, agent_type: 'sdr', persona_name: String(sales.persona_name ?? 'Victor'), persona_tone: String(sales.persona_tone ?? 'professional'), daily_limit: dailyLimit, active_hours: activeHours, is_active: true, business_profile: sales.business_profile ?? {} },
    { unit_id: params.unitId, agent_type: 'recruiter', persona_name: String(recruiter.persona_name ?? 'Recrutador'), persona_tone: String(recruiter.persona_tone ?? 'professional'), daily_limit: dailyLimit, active_hours: activeHours, is_active: true, business_profile: recruiter.business_profile ?? {} },
  ]
  for (const config of configs) {
    const { data: existing } = await db.from('agent_configs').select('id').eq('unit_id', params.unitId).eq('agent_type', config.agent_type).maybeSingle()
    if (existing) await db.from('agent_configs').update(config).eq('id', (existing as { id: string }).id)
    else await db.from('agent_configs').insert(config)
  }
  const version = row?.version ?? DEFAULT_SMARTER_TEMPLATE_VERSION
  await db.from('units').update({ template_version: version }).eq('id', params.unitId)
  return version
}
