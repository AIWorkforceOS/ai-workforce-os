import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getAppUser } from '@/lib/app-user'
import { sendSupportAuthorizationEmail } from '@/lib/email'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveWhatsappChannel } from '@/lib/evolution'
import { getMessagingChannel } from '@/lib/channels/messaging-channel'
import type { Unit } from '@/lib/types'

const bodySchema = z.object({ proposal: z.string().min(10).max(5000), scope: z.record(z.string(), z.unknown()).default({}) })

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
    .select('id, org_id, unit_id, protocol, reporter_email, reporter_phone, status')
    .eq('id', id)
    .maybeSingle()
  if (!supportCase) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (supportCase.status === 'resolved' || supportCase.status === 'closed') {
    return NextResponse.json({ error: 'case_closed' }, { status: 409 })
  }

  const { error } = await service
    .from('support_cases')
    .update({
      status: 'awaiting_authorization',
      repair_proposal: parsed.data.proposal,
      repair_scope: parsed.data.scope,
      authorization_granted_at: null,
      authorization_granted_by: null,
    })
    .eq('id', id)
  if (error) return NextResponse.json({ error: 'proposal_failed' }, { status: 500 })

  await service.from('support_case_messages').insert({
    case_id: id,
    org_id: supportCase.org_id,
    author_type: 'technician',
    author_user_id: user.id,
    content: parsed.data.proposal,
    metadata: { kind: 'repair_proposal', scope: parsed.data.scope },
  })

  if (supportCase.reporter_email) {
    await sendSupportAuthorizationEmail({
      to: supportCase.reporter_email,
      protocol: supportCase.protocol,
      proposal: parsed.data.proposal,
    })
  }

  if (supportCase.reporter_phone && supportCase.unit_id) {
    const { data: unit } = await service.from('units').select('*').eq('id', supportCase.unit_id).maybeSingle()
    if (unit) {
      const resolved = await resolveWhatsappChannel(service, unit as Unit, 'receptionist')
      const channel = getMessagingChannel(unit as Unit, service, resolved?.config ?? null)
      if (channel?.type === 'whatsapp') {
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://www.alizoai.com').replace(/\/+$/, '')
        await channel.sendMessage(
          supportCase.reporter_phone,
          `Chamado ${supportCase.protocol}: o diagnóstico foi concluído. Reparo proposto: ${parsed.data.proposal}\n\nNada será alterado sem sua autorização. Revise em ${appUrl}/dashboard/support`,
        ).catch((error) => console.error('[support authorization whatsapp]', error instanceof Error ? error.message : error))
      }
    }
  }
  return NextResponse.json({ ok: true, protocol: supportCase.protocol })
}
