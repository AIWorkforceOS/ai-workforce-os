import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { syncAndOptimizeAccount } from '@/lib/traffic/sync'
import type { AdAccount } from '@/lib/traffic/types'

export const maxDuration = 120

/**
 * Sync manual de uma conta de anúncio (botão "Sincronizar agora" no painel).
 * A permissão é validada pela sessão + RLS (o select abaixo só encontra a
 * conta se o usuário puder vê-la); a execução usa o service role, como o cron.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: visibleAccount } = await supabase
    .from('ad_accounts')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!visibleAccount) {
    return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: account } = await service.from('ad_accounts').select('*').eq('id', id).single()
  if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })

  const result = await syncAndOptimizeAccount(service, account as AdAccount)
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}
