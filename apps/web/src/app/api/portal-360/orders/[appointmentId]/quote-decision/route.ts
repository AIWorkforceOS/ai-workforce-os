import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { clientDecisionBlock, decisionPatch } from '@/lib/clients/quote-decision'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() })

/**
 * O cliente (login role='client') aprova ou recusa a cotação da própria ordem. Mesmo padrão de autorização das outras rotas do portal:
 * service role + join `customers!inner(client_company)` do usuário logado, nunca RLS — ordem de outro cliente responde 404. Uma única
 * decisão; só o administrador desfaz (painel do cliente). Só registra a decisão: não muda status, valores nem financeiro.
 */
export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await params
  const appUser = await getAppUser()
  if (!appUser || appUser.role !== 'client' || !appUser.clientCompany) return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 503 })

  const { data } = await supabase
    .from('appointments')
    .select('id, service_order_status, quote_decision, service_order_quote_description_en, service_order_material_description, customers!inner(client_company)')
    .eq('id', appointmentId)
    .eq('customers.client_company', appUser.clientCompany)
    .maybeSingle()
  const order = data as { id: string; service_order_status: string | null; quote_decision: string | null; service_order_quote_description_en: string | null; service_order_material_description: string | null } | null
  if (!order) return NextResponse.json({ error: 'Order not found.' }, { status: 404 })

  const block = clientDecisionBlock({ status: order.service_order_status, decision: order.quote_decision, quoteDescriptionEn: order.service_order_quote_description_en, materialDescription: order.service_order_material_description })
  if (block) return NextResponse.json({ error: block }, { status: 409 })

  // .is('quote_decision', null): duas abas/duplo toque nunca sobrescrevem uma decisão já registrada
  const { data: updated, error } = await supabase
    .from('appointments')
    .update(decisionPatch(parsed.data.decision, parsed.data.note, appUser.id))
    .eq('id', appointmentId)
    .is('quote_decision', null)
    .select('id, quote_decision')
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not record your decision. Try again.' }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'A decision was already recorded for this quote.' }, { status: 409 })
  return NextResponse.json({ ok: true, decision: (updated as { quote_decision: string }).quote_decision })
}
