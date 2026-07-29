// Validação em tempo real do token de Página colado no fluxo self-service
// de conexão (/dashboard/content/connect) — mesma receita de
// lib/traffic/connection-test.ts: UMA chamada real e barata na Graph API,
// sem escrever nada lá, só para confirmar a credencial antes de salvar em
// social_accounts.

import { translateIntegrationError } from '@/lib/integration-errors'
import { getPageInfo, resolveSocialConfig } from './meta-content'

export type ConnectionTestResult =
  | { ok: true; label: string; instagramBusinessAccountId: string | null; instagramUsername: string | null }
  /** `error` é o texto seguro pra mostrar ao cliente; `rawError` (técnico, pode citar endpoint/código) é só pro log do servidor. */
  | { ok: false; error: string; rawError: string }

export async function testSocialConnection(input: {
  pageId: string
  pageAccessToken?: string | null
}): Promise<ConnectionTestResult> {
  try {
    const config = await resolveSocialConfig({ page_id: input.pageId, page_access_token: input.pageAccessToken ?? null })
    if (!config) {
      const rawError = 'Integração ainda não está configurada do lado da Alizo (falta META_SYSTEM_USER_TOKEN).'
      return {
        ok: false,
        error:
          'Essa integração ainda está sendo liberada pra sua conta. Se você tiver seu próprio token de Página, abra "Avançado" e cole-o — ou fale com o suporte.',
        rawError,
      }
    }

    const info = await getPageInfo(config)
    const igNote = info.instagramBusinessAccountId
      ? ` — Instagram vinculado: @${info.instagramUsername ?? info.instagramBusinessAccountId}`
      : ' — nenhuma conta do Instagram vinculada a esta Página (por enquanto só publica no Facebook)'
    return {
      ok: true,
      label: `${info.name}${igNote}`,
      instagramBusinessAccountId: info.instagramBusinessAccountId,
      instagramUsername: info.instagramUsername,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao validar a Página.'
    // Sem token colado pelo cliente, a troca de token usou o system user
    // global — qualquer falha aqui tende a ser falta de compartilhamento
    // da Página como Parceiro, não um "token inválido" (não há token nesse fluxo).
    const hint = input.pageAccessToken
      ? ''
      : ' — provavelmente falta completar o compartilhamento da Página como Parceiro do Business Manager da Alizo (veja o ID acima), ou a permissão concedida não inclui gerenciar conteúdo.'
    const rawError = `${message}${hint}`
    return { ok: false, error: translateIntegrationError('meta', rawError), rawError }
  }
}
