import { generateStructuredReply, getOpenAIApiKey } from './openai'
import type { MappedFacilitOrder } from './facilit'

/**
 * Resumo em português + dicas práticas pro técnico, gerado por IA a
 * partir do escopo em inglês que a Facil-IT manda (pedido do Vinicius,
 * 2026-09-15: "a AI faz um resumo em português para o técnico ver o
 * que pede a ordem além de dicas"). O texto ORIGINAL em inglês nunca é
 * alterado — vai intacto pra service_order_scope_en (é o que o cliente
 * vê na loja); este resumo é só um apoio a mais pro técnico em
 * português, guardado em service_order_summary_pt.
 *
 * Bônus, não bloqueante: sem OPENAI_API_KEY ou qualquer falha da API,
 * devolve null — o sync continua normalmente, o appointment é criado
 * do mesmo jeito, só sem o resumo (o técnico sempre tem o texto
 * original em inglês disponível de qualquer forma).
 */

const SYSTEM_PROMPT = `Você ajuda um técnico de campo brasileiro que vai atender uma ordem de serviço de manutenção nos EUA, escrita em inglês por uma rede de lojas (Facil-IT/360).

Leia a ordem e responda em JSON com exatamente esta chave:
{
  "summary_pt": "um resumo curto e prático EM PORTUGUÊS do que a ordem pede, seguido de dicas úteis pro técnico se preparar (ex.: ferramentas prováveis, cuidados, o que perguntar no local) — não é uma tradução literal, é um resumo que ajuda o técnico a entender rápido o que fazer. 3-6 frases. Se não houver escopo suficiente pra resumir com confiança, devolva null."
}

Nunca invente detalhes que não estão na ordem. Responda só o JSON, nada mais.`

function buildOrderContext(order: MappedFacilitOrder): string {
  const lines = [
    order.scope ? `Escopo (inglês, original): ${order.scope}` : null,
    order.category ? `Categoria: ${order.category}` : null,
    order.order_type ? `Tipo de ordem: ${order.order_type}` : null,
    order.priority ? `Prioridade: ${order.priority}` : null,
    order.company ? `Local: ${order.company}` : null,
  ].filter(Boolean)
  return lines.join('\n')
}

type RawSummary = { summary_pt?: unknown }

export async function summarizeFacilitOrderForTechnician(order: MappedFacilitOrder): Promise<string | null> {
  if (!order.scope) return null

  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReply<RawSummary>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      history: [{ role: 'user', content: buildOrderContext(order) }],
    })
    const summary = typeof raw.summary_pt === 'string' ? raw.summary_pt.trim() : ''
    return summary && summary.toLowerCase() !== 'null' ? summary : null
  } catch (error) {
    console.error(
      `[facilit_summary] falha ao gerar resumo em português da ordem "${order.facilit_order_number}": ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
