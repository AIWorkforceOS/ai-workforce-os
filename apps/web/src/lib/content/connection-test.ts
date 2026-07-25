// Validação em tempo real do token de Página colado no fluxo self-service
// de conexão (/dashboard/content/connect) — mesma receita de
// lib/traffic/connection-test.ts: UMA chamada real e barata na Graph API,
// sem escrever nada lá, só para confirmar a credencial antes de salvar em
// social_accounts.

import { getPageInfo, getSocialConfig } from './meta-content'

export type ConnectionTestResult =
  | { ok: true; label: string; instagramBusinessAccountId: string | null; instagramUsername: string | null }
  | { ok: false; error: string }

export async function testSocialConnection(input: {
  pageId: string
  pageAccessToken?: string | null
}): Promise<ConnectionTestResult> {
  const config = getSocialConfig({ page_id: input.pageId, page_access_token: input.pageAccessToken ?? null })
  if (!config) {
    return { ok: false, error: 'Cole o token de acesso da Página para testar.' }
  }

  try {
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
    return { ok: false, error: error instanceof Error ? error.message : 'Falha ao validar a Página.' }
  }
}
