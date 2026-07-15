// Relatórios executivos do Traffic Specialist — linguagem de negócio,
// não números crus. Usa OpenAI quando disponível; sem OPENAI_API_KEY,
// gera um resumo determinístico decente (degradação graciosa).

import { generateChatReply, getOpenAIApiKey } from '@/lib/openai'
import { IDENTITY_RULES } from '@/lib/agent-identity'
import { formatCentsBRL } from './metrics'
import type { AggregatedMetrics, DecisionProposal } from './types'

export type ReportInput = {
  accountName: string
  platformLabel: string
  periodLabel: string
  totals: AggregatedMetrics
  previousTotals: AggregatedMetrics | null
  decisions: DecisionProposal[]
}

export function buildHighlights(input: ReportInput): Record<string, unknown> {
  const { totals, previousTotals } = input
  return {
    spend_cents: totals.spend_cents,
    conversions: totals.conversions,
    conversion_value_cents: totals.conversion_value_cents,
    roas: totals.roas,
    cpa_cents: totals.cpa_cents,
    ctr: totals.ctr,
    cpm_cents: totals.cpm_cents,
    previous_spend_cents: previousTotals?.spend_cents ?? null,
    previous_roas: previousTotals?.roas ?? null,
    decisions_count: input.decisions.length,
    critical_count: input.decisions.filter((d) => d.severity === 'critical').length,
  }
}

/** Resumo determinístico usado quando não há OPENAI_API_KEY. */
export function buildFallbackSummary(input: ReportInput): string {
  const { totals, decisions } = input
  const lines = [
    `${input.accountName} (${input.platformLabel}) — ${input.periodLabel}:`,
    `investimento de ${formatCentsBRL(totals.spend_cents)}, ${Math.round(totals.conversions)} conversões` +
      (totals.roas !== null ? `, ROAS ${totals.roas.toFixed(2)}` : '') +
      (totals.cpa_cents !== null ? `, CPA ${formatCentsBRL(totals.cpa_cents)}` : '') +
      '.',
  ]
  if (decisions.length > 0) {
    lines.push(
      `O agente identificou ${decisions.length} ação(ões) recomendada(s)` +
        `${decisions.some((d) => d.severity === 'critical') ? ', incluindo pontos críticos que pedem atenção imediata' : ''}.`,
    )
  } else {
    lines.push('Nenhuma ação necessária — a conta está dentro dos alvos configurados.')
  }
  return lines.join(' ')
}

/** Prompt do resumo executivo — exportado para os testes de identidade. */
export function buildReportSystemPrompt(): string {
  return [
    'Você é o gestor de tráfego pago digital da plataforma, com o repertório de um gestor sênior (20+ anos), escrevendo um resumo executivo curto para o dono do negócio.',
    'Linguagem de negócio, PT-BR, sem jargão técnico não explicado, sem markdown, no máximo 5 frases.',
    'Diga o que aconteceu, por que importa e o que será feito. Valores monetários em reais.',
    IDENTITY_RULES,
  ].join(' ')
}

/**
 * Gera o resumo executivo em PT-BR. Nunca lança: em erro ou sem API key,
 * cai no resumo determinístico.
 */
export async function generateExecutiveSummary(input: ReportInput): Promise<string> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return buildFallbackSummary(input)

  const { totals, previousTotals, decisions } = input
  try {
    const summary = await generateChatReply({
      apiKey,
      systemPrompt: buildReportSystemPrompt(),
      history: [
        {
          role: 'user',
          content: JSON.stringify({
            conta: input.accountName,
            plataforma: input.platformLabel,
            periodo: input.periodLabel,
            metricas: {
              investimento: formatCentsBRL(totals.spend_cents),
              conversoes: Math.round(totals.conversions),
              receita_atribuida: formatCentsBRL(totals.conversion_value_cents),
              roas: totals.roas,
              cpa: formatCentsBRL(totals.cpa_cents),
              ctr_pct: totals.ctr,
            },
            periodo_anterior: previousTotals
              ? {
                  investimento: formatCentsBRL(previousTotals.spend_cents),
                  roas: previousTotals.roas,
                  cpa: formatCentsBRL(previousTotals.cpa_cents),
                }
              : null,
            acoes_recomendadas: decisions.map((d) => ({
              tipo: d.decision_type,
              severidade: d.severity,
              resumo: d.reasoning.slice(0, 200),
            })),
          }),
        },
      ],
    })
    return summary || buildFallbackSummary(input)
  } catch {
    return buildFallbackSummary(input)
  }
}
