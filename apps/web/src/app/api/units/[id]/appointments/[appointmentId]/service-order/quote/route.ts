import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { composeClientQuoteDescription } from '@/lib/service-orders/quote-composer'

/**
 * Gera (ou regenera) a cotação estruturada por IA a partir do painel
 * do admin — mesma lib do Portal 360 (lib/service-orders/quote-composer.ts),
 * pedido do Vinicius (2026-09-15): "o admin precisa ter acesso a tudo
 * para que possa concluir a ordem ou a Cotação". Autorização por RLS
 * de verdade (client autenticado do próprio admin), diferente da rota
 * irmã do Portal 360 (que usa service role + client_company porque o
 * usuário 'client' não tem RLS nenhuma de propósito).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id: unitId, appointmentId } = await params

  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!appUser.isSuperAdmin && appUser.role !== 'admin') {
    return NextResponse.json({ error: 'Sem permissão para gerar cotação.' }, { status: 403 })
  }
  if (appUser.unitId && appUser.unitId !== unitId) {
    return NextResponse.json({ error: 'Sem permissão para esta unidade.' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('appointments')
    .select(
      'id, service_order_material_description, service_order_material_value, service_order_hours_needed, service_order_part_purchase_link, service_order_location_name, service_order_number',
    )
    .eq('id', appointmentId)
    .eq('unit_id', unitId)
    .maybeSingle()

  const order = data as {
    id: string
    service_order_material_description: string | null
    service_order_material_value: number | null
    service_order_hours_needed: number | null
    service_order_part_purchase_link: string | null
    service_order_location_name: string | null
    service_order_number: string | null
  } | null
  if (!order) {
    return NextResponse.json({ error: 'Ordem de serviço não encontrada.' }, { status: 404 })
  }
  if (!order.service_order_material_description?.trim()) {
    return NextResponse.json({ error: 'O técnico ainda não deixou nenhuma anotação sobre o que é necessário.' }, { status: 400 })
  }

  const quote = await composeClientQuoteDescription({
    technicianNotes: order.service_order_material_description,
    locationName: order.service_order_location_name,
    orderNumber: order.service_order_number,
    materialValue: order.service_order_material_value,
    hoursNeeded: order.service_order_hours_needed,
    partPurchaseLink: order.service_order_part_purchase_link,
  })
  if (!quote) {
    return NextResponse.json({ error: 'Não foi possível gerar a cotação agora. Tente novamente em instantes.' }, { status: 502 })
  }

  const { error: updateError } = await supabase
    .from('appointments')
    .update({ service_order_quote_description_en: quote.en, service_order_quote_description_pt: quote.pt })
    .eq('id', appointmentId)

  if (updateError) {
    return NextResponse.json({ error: 'A cotação foi gerada, mas não foi possível salvar.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, quoteEn: quote.en, quotePt: quote.pt })
}
