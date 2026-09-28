/**
 * Variação percentual entre o valor do mês atual e do mês anterior —
 * pedido do Vinicius (2026-09-27), aba "Relatório geral do mês": "o
 * quanto cresceu referente ao último mês". Mesma fórmula/guarda de
 * `pctChange` em `lib/traffic/metrics.ts` (não importado de lá de
 * propósito — domínio diferente, tráfego vs financeiro de serviço — só
 * espelha a fórmula já validada: `((atual-anterior)/anterior)*100`, null
 * quando não é computável (mês anterior zero ou sem dado), nunca divide
 * por zero.
 */
export function growthPercent(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return ((current - previous) / previous) * 100
}
