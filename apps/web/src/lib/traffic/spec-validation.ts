// Validação de NewCampaignSpec — compartilhada entre a rota de lançamento
// direto (accounts/[id]/campaigns) e a rota de rascunho com criativo/imagem
// (accounts/[id]/creative-drafts), para não duplicar as mesmas regras.

import type { NewCampaignSpec } from './types'

export function validateNewCampaignSpec(spec: Partial<NewCampaignSpec> | undefined): string | null {
  if (!spec) return 'spec é obrigatório.'
  if (!spec.name?.trim()) return 'spec.name é obrigatório.'
  if (!spec.objective?.trim()) return 'spec.objective é obrigatório.'
  if (!spec.dailyBudgetCents || spec.dailyBudgetCents <= 0) return 'spec.dailyBudgetCents deve ser > 0.'
  if (!spec.targeting?.countries?.length) return 'spec.targeting.countries é obrigatório (ao menos 1 país).'
  if (!spec.creative?.headline?.trim()) return 'spec.creative.headline é obrigatório.'
  if (!spec.creative?.body?.trim()) return 'spec.creative.body é obrigatório.'
  if (!spec.creative?.linkUrl?.trim()) return 'spec.creative.linkUrl é obrigatório.'
  return null
}
