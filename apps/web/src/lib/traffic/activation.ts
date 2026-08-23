// Ativação automática de campanha recém-lançada (pedido do Vinicius,
// 2026-08-23: "o humano só clica autorizando e ele já inicia"). O
// launcher.ts sempre cria tudo PAUSED nas plataformas (trava de segurança
// que continua existindo) — este módulo é o passo seguinte, chamado na
// MESMA aprovação humana, que liga campanha/conjunto/anúncio de verdade,
// sem exigir um segundo clique separado.
//
// Nunca chamado para lançamentos 'mock'/'dry_run' (ids fake não existem
// numa plataforma de verdade) — quem chama já filtra isso.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetaConfig, setMetaEntityStatus } from './meta-ads'
import { getGoogleAccessToken, getGoogleAdsConfig, setGoogleCampaignStatus } from './google-ads'
import type { AdAccount, CampaignLaunchOutcome } from './types'

/**
 * Ativa (status ACTIVE) as entidades recém-criadas de uma campanha, na
 * plataforma real, e reflete o novo status em ad_entities. Lança erro se
 * qualquer chamada à plataforma falhar — quem chama decide como tratar
 * (a campanha já existe de verdade, então a falha de ativação não desfaz
 * o lançamento, só fica registrada para revisão manual).
 *
 * Meta: campanha, conjunto E anúncio precisam estar ACTIVE pra servir de
 * verdade — ativa os três níveis criados. Google: só o nível de campanha
 * nesta rodada (mesma limitação documentada em launcher.ts — só SEARCH
 * tem grupo/anúncio completos, e mesmo esses nascem sem keyword).
 */
export async function activateLaunchedCampaign(
  supabase: SupabaseClient,
  params: { account: AdAccount; outcome: CampaignLaunchOutcome },
): Promise<void> {
  const { account, outcome } = params
  const activatedExternalIds: string[] = []

  if (account.platform === 'meta') {
    const config = getMetaConfig(account)
    if (!config) throw new Error('Credenciais Meta não configuradas para a conta.')

    for (const externalId of [outcome.campaignExternalId, outcome.adSetExternalId, outcome.adExternalId]) {
      if (!externalId) continue
      await setMetaEntityStatus(config, externalId, 'ACTIVE')
      activatedExternalIds.push(externalId)
    }
  } else {
    const config = getGoogleAdsConfig(account)
    if (!config) throw new Error('Credenciais Google Ads não configuradas para a conta.')
    if (!outcome.campaignExternalId) return // nada a ativar (budget/campanha não chegaram a ser criados)

    const accessToken = await getGoogleAccessToken(config)
    await setGoogleCampaignStatus(config, accessToken, outcome.campaignExternalId, 'ACTIVE')
    activatedExternalIds.push(outcome.campaignExternalId)
  }

  if (activatedExternalIds.length > 0) {
    await supabase
      .from('ad_entities')
      .update({ status: 'ACTIVE' })
      .eq('ad_account_id', account.id)
      .in('external_id', activatedExternalIds)
  }
}
