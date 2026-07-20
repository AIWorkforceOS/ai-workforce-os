import type { TrainingCorrectionEntry } from '@/lib/types'

// Correções ensinadas pelo dono ao testar o funcionário na tela "Testar
// Funcionário" (agent_configs.training_corrections, migration 025,
// sub-etapa 5/7) — no mesmo espírito de business_profile/interview_transcript:
// um jsonb que vira um bloco de contexto adicional no prompt de sistema real,
// só quando não vazio (lista vazia = comportamento idêntico ao de hoje).

export function buildTrainingCorrectionsContext(
  corrections: TrainingCorrectionEntry[] | null | undefined,
): string | null {
  if (!corrections || corrections.length === 0) return null
  const items = corrections
    .map((c) => `- Situação: ${c.context || 'não informada'}. Ajuste pedido: ${c.correction}`)
    .join(' ')
  return [
    'CORREÇÕES DE TREINAMENTO — o dono da empresa já pediu estes ajustes ao testar suas respostas antes; aplique-os sempre que a situação real se parecer com a descrita, mesmo que o cliente use outras palavras:',
    items,
  ].join(' ')
}
