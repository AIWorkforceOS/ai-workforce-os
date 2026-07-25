// Link de descadastro de e-mail marketing em massa (migration 043).
// Token estável por lead/customer (unsubscribe_token) — não precisa de
// assinatura própria porque já é um uuid aleatório de baixo risco, mesmo
// princípio do public_lead_intake_token (migration 022): se vazar, o pior
// caso é aquele contato ser descadastrado de campanhas.

import type { CampaignRecipientType } from './types'

export function buildUnsubscribeUrl(params: { recipientType: CampaignRecipientType; token: string }): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://SEU-DOMINIO.vercel.app').replace(/\/+$/, '')
  return `${appUrl}/api/public/unsubscribe?type=${params.recipientType}&token=${encodeURIComponent(params.token)}`
}
