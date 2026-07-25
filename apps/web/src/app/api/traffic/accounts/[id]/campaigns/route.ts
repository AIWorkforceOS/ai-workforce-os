import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { launchCampaign } from '@/lib/traffic/launcher'
import { validateNewCampaignSpec } from '@/lib/traffic/spec-validation'
import type { AdAccount, NewCampaignSpec } from '@/lib/traffic/types'

export const maxDuration = 60

type Body = { spec?: Partial<NewCampaignSpec> }

/**
 * Cria uma campanha nova do zero (campanha + conjunto/grupo + anúncio,
 * na medida do que cada plataforma permite nesta rodada — ver
 * lib/traffic/launcher.ts). Ponto de entrada real: o funcionário de
 * Tráfego Pago (ou o usuário através dele) chama este endpoint quando
 * decide lançar uma campanha; não é mais só leitura/ajuste de campanha
 * existente.
 *
 * Lançamento DIRETO, sem passar pela aprovação de imagem — use quando o
 * criativo não precisa de imagem (ex.: Google Search) ou quando a
 * imagem já foi decidida por outro caminho. Para campanhas com imagem
 * gerada por IA aguardando aprovação humana, ver
 * accounts/[id]/creative-drafts (POST) + creative-drafts/[id] (PATCH).
 *
 * Permissão: mesma receita do sync manual — o select abaixo só encontra
 * a conta se a sessão puder vê-la (RLS); a execução em si usa o service
 * role porque grava em ad_entities/ad_actions_log.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: visibleAccount } = await supabase.from('ad_accounts').select('id').eq('id', id).maybeSingle()
  if (!visibleAccount) {
    return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })
  }

  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const validationError = validateNewCampaignSpec(body.spec)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: account } = await service.from('ad_accounts').select('*').eq('id', id).single()
  if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 })

  const outcome = await launchCampaign(service, {
    account: account as AdAccount,
    spec: body.spec as NewCampaignSpec,
    executedBy: `human_approved:${user.email}`,
  })

  const status = outcome.result === 'failed' ? 502 : 200
  return NextResponse.json({ outcome }, { status })
}
