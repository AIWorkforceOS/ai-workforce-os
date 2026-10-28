import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

const bodySchema = z.object({ resolution: z.string().min(10).max(5000) })

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAppUser()
  if (!user?.isSuperAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 })

  const { id } = await context.params
  const { data: supportCase } = await service
    .from('support_cases')
    .select('id, org_id, protocol, status')
    .eq('id', id)
    .maybeSingle()
  if (!supportCase) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (supportCase.status !== 'authorized' && supportCase.status !== 'repairing') {
    return NextResponse.json({ error: 'repair_not_authorized' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error } = await service
    .from('support_cases')
    .update({
      status: 'resolved',
      resolution: parsed.data.resolution,
      resolution_updated_at: now,
      resolved_at: now,
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'resolution_failed' }, { status: 500 })

  await service.from('support_case_messages').insert({
    case_id: id,
    org_id: supportCase.org_id,
    author_type: 'technician',
    author_user_id: user.id,
    content: parsed.data.resolution,
    metadata: { kind: 'resolution', resolved_at: now },
  })
  return NextResponse.json({ ok: true, protocol: supportCase.protocol, status: 'resolved' })
}
