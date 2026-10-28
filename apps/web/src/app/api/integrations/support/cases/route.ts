import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/service'
import { openSupportCase } from '@/lib/ti/cases'

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

  try {
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
      description: parsed.data.description,
    })
    return NextResponse.json(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    console.error('[support partner intake]', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'case_creation_failed' }, { status: 500 })
  }
}
