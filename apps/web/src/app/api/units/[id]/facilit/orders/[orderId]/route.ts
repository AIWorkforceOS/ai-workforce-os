import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Atribui (ou remove) o técnico responsável por uma ordem importada da
 * Facil-IT — "o cliente seleciona para qual técnico enviar para ser
 * atendido" (pedido original, 2026-09-10). `employeeId: null` limpa a
 * atribuição.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; orderId: string }> },
) {
  const { id, orderId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const employeeId = typeof body?.employeeId === 'string' ? body.employeeId : null

  const { data, error } = await supabase
    .from('facilit_work_orders')
    .update({
      assigned_employee_id: employeeId,
      assigned_at: employeeId ? new Date().toISOString() : null,
      assigned_by: employeeId ? user.id : null,
    })
    .eq('id', orderId)
    .eq('unit_id', id)
    .select('id')
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ error: 'Não foi possível atribuir o técnico. Verifique se você tem acesso a esta unidade.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
