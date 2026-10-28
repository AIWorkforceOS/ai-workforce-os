import { NextResponse, type NextRequest } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getAppUser()
  if (!user || (user.role !== 'admin' && !user.isSuperAdmin)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'service_unavailable' }, { status: 503 })
  const { id } = await context.params
  const { data: supportCase } = await service
    .from('support_cases')
    .select('id, org_id, protocol, status, repair_proposal')
    .eq('id', id)
    .maybeSingle()

  if (!supportCase || (!user.isSuperAdmin && supportCase.org_id !== user.orgId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (supportCase.status !== 'awaiting_authorization' || !supportCase.repair_proposal) {
    return NextResponse.json({ error: 'not_awaiting_authorization' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error } = await service
    .from('support_cases')
    .update({ status: 'authorized', authorization_granted_at: now, authorization_granted_by: user.id })
    .eq('id', id)
    .eq('status', 'awaiting_authorization')
  if (error) return NextResponse.json({ error: 'authorization_failed' }, { status: 500 })

  await service.from('support_case_messages').insert({
    case_id: id,
    org_id: supportCase.org_id,
    author_type: 'user',
    author_user_id: user.id,
    content: `Reparo autorizado explicitamente por ${user.email}.`,
    metadata: { kind: 'repair_authorization', authorized_at: now },
  })
  return NextResponse.json({ ok: true, protocol: supportCase.protocol })
}
