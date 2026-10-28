import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { openSupportCase } from '@/lib/ti/cases'
import { analyzePartnerSupportMedia } from '@/lib/ti/partner-media'

const mediaSchema = z.object({
  kind: z.enum(['image', 'audio']),
  mimeType: z.string().min(3).max(100),
  base64: z.string().min(1).max(24_000_000),
  caption: z.string().max(1000).nullable().optional(),
  sourceMessageId: z.string().max(200).nullable().optional(),
})

const bodySchema = z.object({
  orgId: z.string().uuid(),
  unitId: z.string().uuid().nullable().optional(),
  externalReference: z.string().min(1).max(200),
  reporterName: z.string().max(160).nullable().optional(),
  reporterEmail: z.string().email().nullable().optional(),
  reporterPhone: z.string().max(40).nullable().optional(),
  category: z.enum(['guidance', 'bug', 'access', 'integration', 'billing', 'other']).default('bug'),
  title: z.string().min(3).max(180),
  description: z.string().min(3).max(10_000),
  mediaConsent: z.literal(true).optional(),
  media: z.array(mediaSchema).max(3).default([]),
})

const querySchema = z.object({
  orgId: z.string().uuid(),
  externalReference: z.string().min(1).max(200),
})

function validBearer(request: NextRequest): boolean {
  const expected = process.env.SUPPORT_PARTNER_API_TOKEN
  const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!expected || !received) return false
  const expectedBytes = Buffer.from(expected)
  const receivedBytes = Buffer.from(received)
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
}

/** Entrada neutra para um sistema parceiro abrir chamado sem acessar banco. */
export async function POST(request: NextRequest) {
  if (!validBearer(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })

  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 })

  const { data: org } = await supabase.from('organizations').select('id').eq('id', parsed.data.orgId).maybeSingle()
  if (!org) return NextResponse.json({ error: 'organization_not_found' }, { status: 404 })

  if (parsed.data.unitId) {
    const { data: unit } = await supabase
      .from('units')
      .select('id')
      .eq('id', parsed.data.unitId)
      .eq('org_id', parsed.data.orgId)
      .maybeSingle()
    if (!unit) return NextResponse.json({ error: 'unit_not_found' }, { status: 404 })
  }

  const { data: existing } = await supabase
    .from('support_cases')
    .select('id, protocol')
    .eq('source_system', 'partner')
    .eq('org_id', parsed.data.orgId)
    .eq('external_reference', parsed.data.externalReference)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ id: existing.id, protocol: existing.protocol, created: false }, { status: 200 })
  }

  if (parsed.data.media.length > 0 && parsed.data.mediaConsent !== true) {
    return NextResponse.json({ error: 'media_consent_required' }, { status: 400 })
  }

  try {
    const mediaAnalysis = await analyzePartnerSupportMedia(parsed.data.media)
    const description = [parsed.data.description, ...mediaAnalysis].join('\n\n')
    const result = await openSupportCase(supabase, {
      orgId: parsed.data.orgId,
      unitId: parsed.data.unitId,
      sourceSystem: 'partner',
      externalReference: parsed.data.externalReference,
      reporterName: parsed.data.reporterName,
      reporterEmail: parsed.data.reporterEmail,
      reporterPhone: parsed.data.reporterPhone,
      channel: 'partner_api',
      category: parsed.data.category,
      title: parsed.data.title,
      description,
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    console.error('[support partner intake]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'case_creation_failed' }, { status: 500 })
  }
}

/** Consulta server-side para o parceiro acompanhar autorização e resolução. */
export async function GET(request: NextRequest) {
  if (!validBearer(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const parsed = querySchema.safeParse({
    orgId: request.nextUrl.searchParams.get('orgId'),
    externalReference: request.nextUrl.searchParams.get('externalReference'),
  })
  if (!parsed.success) return NextResponse.json({ error: 'invalid_query' }, { status: 400 })

  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 })
  const { data, error } = await supabase
    .from('support_cases')
    .select('id, protocol, status, repair_proposal, resolution, updated_at, resolved_at')
    .eq('source_system', 'partner')
    .eq('org_id', parsed.data.orgId)
    .eq('external_reference', parsed.data.externalReference)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'status_lookup_failed' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'case_not_found' }, { status: 404 })

  return NextResponse.json({
    id: data.id,
    protocol: data.protocol,
    status: data.status,
    repairProposal: data.repair_proposal,
    resolution: data.resolution,
    updatedAt: data.updated_at,
    resolvedAt: data.resolved_at,
  })
}
