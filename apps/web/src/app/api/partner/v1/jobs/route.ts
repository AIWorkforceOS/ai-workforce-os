import { NextResponse } from 'next/server'
import {
  authenticatePartner,
  isPartnerContext,
  listPartnerUnitIds,
  partnerError,
  resolvePartnerUnit,
} from '@/lib/partner-api/auth'
import { parseLimit } from '@/lib/partner-api/serialize'
import { serializeJob } from '@/lib/partner-api/serialize-recruiter'
import { logRecruiterEvent } from '@/lib/recruiter/log'
import type { Lead } from '@/lib/types'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/partner/v1/jobs (escopo jobs:write)
 * Body: { unit_id | unit_slug, title, lead_id?, urgency?, hiring_deadline?,
 *         target_shortlist_size? (3–5), profile? }
 *
 * Cria a vaga em 'draft'. Para o Recrutador levantar o perfil com a empresa
 * (intake por WhatsApp) é preciso informar `lead_id` — o contato da empresa,
 * criado antes em POST /leads (use first_contact=false se não quiser que o
 * Sales Rep abra a conversa). O cron do Recrutador inicia o intake no
 * próximo horário ativo. Sem lead_id a vaga fica em draft e só serve para
 * receber candidaturas pelo link público (`public_application_url`).
 */
export async function POST(request: Request) {
  const ctx = await authenticatePartner(request, 'jobs:write')
  if (!isPartnerContext(ctx)) return ctx

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return partnerError(400, 'Payload inválido.')

  const unit = await resolvePartnerUnit(ctx, { unitId: body.unit_id, unitSlug: body.unit_slug })
  if (!unit) return partnerError(404, 'Unidade não encontrada.')
  if (!unit.org_id) return partnerError(400, 'Unidade sem organização vinculada.')

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  if (!title) return partnerError(400, 'title é obrigatório.')

  let leadId: string | null = null
  if (body.lead_id !== undefined && body.lead_id !== null) {
    const { data: lead } = await ctx.supabase.from('leads').select('id, unit_id').eq('id', String(body.lead_id)).maybeSingle()
    if (!lead || (lead as Pick<Lead, 'unit_id'>).unit_id !== unit.id) {
      return partnerError(404, 'lead_id não encontrado nesta unidade.')
    }
    leadId = (lead as Pick<Lead, 'id'>).id
  }

  const size = Number(body.target_shortlist_size)
  const { data: job, error } = await ctx.supabase
    .from('job_openings')
    .insert({
      org_id: unit.org_id,
      unit_id: unit.id,
      lead_id: leadId,
      title,
      urgency: ['low', 'normal', 'high'].includes(body.urgency) ? body.urgency : 'normal',
      hiring_deadline: typeof body.hiring_deadline === 'string' ? body.hiring_deadline : null,
      target_shortlist_size: size >= 3 && size <= 5 ? size : 5,
      profile: body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile) ? body.profile : {},
      source: 'manual',
      status: 'draft',
    })
    .select('*')
    .single()

  if (error || !job) return partnerError(500, 'Não foi possível criar a vaga.')

  await logRecruiterEvent(ctx.supabase, {
    orgId: unit.org_id,
    unitId: unit.id,
    jobId: (job as JobOpening).id,
    eventType: 'job.created',
    message: `Vaga "${title}" criada via API de parceiro.`,
  })

  return NextResponse.json({ ok: true, job: serializeJob(job as JobOpening) }, { status: 201 })
}

/** GET /api/partner/v1/jobs?unit_id=&status=&limit= (escopo jobs:read) */
export async function GET(request: Request) {
  const ctx = await authenticatePartner(request, 'jobs:read')
  if (!isPartnerContext(ctx)) return ctx

  const search = new URL(request.url).searchParams
  let unitIds: string[]
  if (search.get('unit_id')) {
    const unit = await resolvePartnerUnit(ctx, { unitId: search.get('unit_id') })
    if (!unit) return partnerError(404, 'Unidade não encontrada.')
    unitIds = [unit.id]
  } else {
    unitIds = await listPartnerUnitIds(ctx)
  }
  if (unitIds.length === 0) return NextResponse.json({ jobs: [] })

  let query = ctx.supabase.from('job_openings').select('*').in('unit_id', unitIds)
  const status = search.get('status')
  if (status) query = query.eq('status', status)

  const { data } = await query.order('created_at', { ascending: false }).limit(parseLimit(search.get('limit')))
  return NextResponse.json({ jobs: ((data as JobOpening[] | null) ?? []).map(serializeJob) })
}
