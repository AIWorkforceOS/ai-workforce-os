import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/admin/orgs/[id] — ativa/desativa uma empresa cliente
 * (apenas super_admin; a escrita passa pelo RLS da sessão).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode alterar empresas.' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (typeof body?.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) é obrigatório.' }, { status: 400 })
  }

  const supabase = await createClient()
  // Desativar = cancelamento (grava o timestamp que alimenta as métricas
  // de churn e o cálculo de reembolso da garantia de 7 dias); reativar limpa.
  const update: Record<string, unknown> = body.is_active
    ? { is_active: true, cancelled_at: null, cancellation_reason: null }
    : { is_active: false, cancelled_at: new Date().toISOString(), cancellation_reason: body.reason ?? null }
  let { error } = await supabase.from('organizations').update(update).eq('id', id)
  // cancelled_at existe a partir da migration 20260714000010; se ela ainda
  // não tiver sido aplicada, mantém o comportamento antigo (só is_active).
  if (error && /cancelled_at|cancellation_reason/.test(error.message)) {
    ;({ error } = await supabase.from('organizations').update({ is_active: body.is_active }).eq('id', id))
  }
  if (error) {
    return NextResponse.json({ error: `Erro ao atualizar: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
