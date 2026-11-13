import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError } from '@/lib/partner-api/auth'

export const dynamic = 'force-dynamic'

/** DELETE /api/partner/v1/webhooks/{id} (escopo webhooks:manage) — só endpoints da própria chave. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'webhooks:manage')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const { data } = await ctx.supabase
    .from('partner_webhook_endpoints')
    .select('id')
    .eq('id', id)
    .eq('api_key_id', ctx.keyId)
    .maybeSingle()
  if (!data) return partnerError(404, 'Webhook não encontrado.')

  await ctx.supabase.from('partner_webhook_endpoints').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
