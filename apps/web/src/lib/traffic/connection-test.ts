// Validação em tempo real das credenciais coladas no fluxo self-service
// de conexão de contas (/dashboard/traffic/connect). Cada teste faz UMA
// chamada real e barata na API da plataforma — não escreve nada lá — só
// para confirmar que a credencial funciona antes de salvar em ad_accounts.

import { translateIntegrationError } from '@/lib/integration-errors'
import { getGoogleAccessToken, getGoogleAdsConfig, getGoogleCustomerInfo } from './google-ads'
import { getMetaAccountInfo, getMetaConfig } from './meta-ads'

export type ConnectionTestResult =
  | { ok: true; label: string }
  /** `error` é o texto seguro pra mostrar ao cliente; `rawError` (técnico, pode citar endpoint/código) é só pro log do servidor. */
  | { ok: false; error: string; rawError: string }

const META_ACTIVE_STATUS = 1

export async function testMetaConnection(input: {
  externalAccountId: string
  accessToken?: string | null
}): Promise<ConnectionTestResult> {
  const config = getMetaConfig({
    external_account_id: input.externalAccountId,
    access_token: input.accessToken ?? null,
  })
  if (!config) {
    const rawError = 'Integração Meta Ads ainda não está configurada do lado da Alizo (falta META_SYSTEM_USER_TOKEN).'
    return {
      ok: false,
      error:
        'Essa integração ainda está sendo liberada pra sua conta. Se você tiver seu próprio token, abra "Avançado" e cole-o — ou fale com o suporte.',
      rawError,
    }
  }

  try {
    const info = await getMetaAccountInfo(config)
    const statusNote = info.account_status === META_ACTIVE_STATUS ? '' : ` — atenção: status da conta não é ativo (código ${info.account_status})`
    return { ok: true, label: `${info.name} (${info.currency})${statusNote}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao validar a conta Meta.'
    // Sem token informado pelo cliente, a chamada usou o system user global —
    // qualquer falha aqui tende a ser falta de compartilhamento da conta como
    // Parceiro, não um "token inválido" (não há token nesse fluxo).
    const hint = input.accessToken
      ? ''
      : ' — provavelmente falta completar o compartilhamento da conta de anúncio como Parceiro do Business Manager da Alizo (veja o ID acima), ou a permissão concedida não inclui "Gerenciar campanhas".'
    const rawError = `${message}${hint}`
    return { ok: false, error: translateIntegrationError('meta', rawError), rawError }
  }
}

export async function testGoogleAdsConnection(input: {
  externalAccountId: string
  refreshToken?: string | null
  developerToken?: string | null
  clientId?: string | null
  clientSecret?: string | null
}): Promise<ConnectionTestResult> {
  const config = getGoogleAdsConfig({
    external_account_id: input.externalAccountId,
    refresh_token: input.refreshToken ?? null,
    google_developer_token: input.developerToken ?? null,
    google_client_id: input.clientId ?? null,
    google_client_secret: input.clientSecret ?? null,
  })
  if (!config) {
    const rawError = 'Google Ads: não foi possível montar as credenciais (faltam credenciais globais e o cliente não preencheu as avançadas).'
    return {
      ok: false,
      error:
        'Não foi possível confirmar a conexão. Confirme se sua conta já aceitou o vínculo com a Alizo no Google Ads, ou preencha as credenciais avançadas.',
      rawError,
    }
  }

  try {
    const accessToken = await getGoogleAccessToken(config)
    const info = await getGoogleCustomerInfo(config, accessToken)
    return { ok: true, label: info.descriptiveName ? `${info.descriptiveName} (${info.id})` : `Conta ${info.id}` }
  } catch (error) {
    const rawError = error instanceof Error ? error.message : 'Falha ao validar a conta Google Ads.'
    return { ok: false, error: translateIntegrationError('google', rawError), rawError }
  }
}
