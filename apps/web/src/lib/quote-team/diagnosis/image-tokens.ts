/**
 * Tokens de imagem nos modelos atuais da OpenAI (documentação oficial, 17/10/2026): a imagem é dividida em retalhos de
 * 32×32; se passar do orçamento de retalhos do nível de detalhe ela é reduzida; tokens = retalhos × multiplicador (1,2 na maioria).
 * Exemplos oficiais (gpt-6-astra, detail high, 2.500 retalhos): 1024×1024 → 1.229 · 2048×2048 → 3.000 · 4096×512 → 2.458.
 * Usado para calcular o PIOR CASO antes de reservar orçamento — por isso há uma margem de segurança sobre o valor da tabela.
 */
export const PATCH_SIZE = 32
export const DEFAULT_PATCH_BUDGET = 2500
export const DEFAULT_PATCH_MULTIPLIER = 1.2
/** Margem para o orçamento nunca ser furado por imagem maior que a estimada (modelo diferente, arredondamento). */
export const IMAGE_TOKEN_SAFETY_MARGIN = 1.25

export function patchCount(width: number, height: number): number {
  return Math.ceil(width / PATCH_SIZE) * Math.ceil(height / PATCH_SIZE)
}

export function estimateImageTokens(input: { width: number; height: number; patchBudget?: number; multiplier?: number }): number {
  const budget = input.patchBudget ?? DEFAULT_PATCH_BUDGET
  const multiplier = input.multiplier ?? DEFAULT_PATCH_MULTIPLIER
  let width = input.width
  let height = input.height
  let patches = patchCount(width, height)
  if (patches > budget) {
    const scale = Math.sqrt(budget / patches)
    width = Math.floor(width * scale)
    height = Math.floor(height * scale)
    patches = Math.min(patchCount(width, height), budget)
  }
  return Math.ceil(patches * multiplier)
}

/** Pior caso para reserva de orçamento (tabela + margem). */
export function conservativeImageTokens(input: { width: number; height: number }): number {
  return Math.ceil(estimateImageTokens(input) * IMAGE_TOKEN_SAFETY_MARGIN)
}

/** Estimativa conservadora de tokens de texto (≈ 1 token a cada 3 caracteres — português gasta mais que inglês). */
export function conservativeTextTokens(text: string): number {
  return Math.ceil(text.length / 3) + 16
}
