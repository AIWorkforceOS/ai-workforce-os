import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Lista as ordens importadas da Facil-IT pra essa unidade, mais recentes primeiro. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data } = await supabase
    .from('facilit_work_orders')
    .select(
      'id, facilit_order_number, po_number, company, address1, city, state, category, order_type, priority, status, visit_date, assigned_employee_id',
    )
    .eq('unit_id', id)
    .order('visit_date', { ascending: true })

  return NextResponse.json({ orders: data ?? [] })
}
