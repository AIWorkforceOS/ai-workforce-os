import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Configura o WhatsApp do gestor/dono responsável pela unidade (migration
 * 074, pedido do Vinicius 2026-08-25) — recebe o resumo diário da agenda
 * (api/cron/manager-agenda-digest) e é reconhecido como comando
 * administrativo pela Recepcionista (ver inbound-router.ts). Client de
 * sessão normal (não service role): a policy units_update já escopa por
 * can_access_unit(id), então um admin comum consegue editar a própria
 * unidade sem privilégio extra.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const phone: string | null = typeof body?.phone === 'string' ? body.phone.trim() || null : null

  const { error } = await supabase.from('units').update({ manager_whatsapp_phone: phone }).eq('id', id)
  if (error) {
    return NextResponse.json({ error: 'Não foi possível salvar. Verifique se você tem acesso a esta unidade.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
