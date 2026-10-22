import { generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'

/**
 * Análise por IA da demanda de uma ordem de serviço (texto da ordem e/ou descrição colada pelo administrador): qual é a demanda de fato,
 * o que provavelmente vai precisar de material e uma ideia do escopo. É só apoio interno para o administrador — nunca vai para o PDF do cliente
 * e nunca inventa: o que o texto não permite concluir volta vazio. Qualquer falha devolve null (o administrador preenche à mão).
 */
export type OrderAnalysis = {
  demandPt: string
  materials: { item: string; note: string | null }[]
  scopeIdeaPt: string
  /** true quando a IA disse que o texto não basta para concluir — a tela avisa em vez de mostrar chute. */
  insufficient: boolean
}

const SYSTEM_PROMPT = `Você ajuda o escritório de uma empresa de manutenção geral (prédios/lojas, nos EUA) a entender uma ordem de serviço recebida de uma contratante.
Com base SOMENTE no texto fornecido, responda em JSON, em PORTUGUÊS, com exatamente estas chaves:
{
  "demand": "em 1 a 3 frases, qual é a demanda de fato (o que está quebrado/pedido e onde). Vazio se o texto não permitir saber.",
  "materials": [ { "item": "material/peça que PROVAVELMENTE será necessário", "note": "por que, ou dúvida a confirmar na visita (opcional, pode ser null)" } ],
  "scope_idea": "ideia objetiva do escopo do serviço: etapas principais, em 2 a 5 frases. Vazio se não der para saber.",
  "insufficient": true ou false (true quando o texto é curto/vago demais para concluir)
}
Regras: nunca invente fatos, medidas, marcas, valores ou prazos; liste em materials só o que é plausível pelo próprio texto (no máximo 8 itens) e deixe claro na note quando é suposição; sem preços; se o texto for insuficiente, devolva demand e scope_idea vazios, materials vazio e insufficient true. Responda só o JSON.`

type Raw = { demand?: unknown; materials?: unknown; scope_idea?: unknown; insufficient?: unknown }

const text = (v: unknown): string => (typeof v === 'string' && v.trim().toLowerCase() !== 'null' ? v.trim() : '')

/** Normaliza a resposta crua do modelo (pura, testável): limita tamanhos e descarta lixo. */
export function cleanAnalysis(raw: Raw | null | undefined): OrderAnalysis {
  const materials = (Array.isArray(raw?.materials) ? raw!.materials : [])
    .map((m) => {
      const o = (m ?? {}) as { item?: unknown; note?: unknown }
      return { item: text(o.item).slice(0, 120), note: text(o.note).slice(0, 200) || null }
    })
    .filter((m) => m.item)
    .slice(0, 8)
  const demandPt = text(raw?.demand).slice(0, 600)
  const scopeIdeaPt = text(raw?.scope_idea).slice(0, 900)
  const insufficient = raw?.insufficient === true || (!demandPt && !scopeIdeaPt && materials.length === 0)
  return { demandPt, materials, scopeIdeaPt, insufficient }
}

export async function analyzeOrderDemand(input: { description: string | null; scopeText: string | null; locationName: string | null }): Promise<OrderAnalysis | null> {
  const parts = [input.description?.trim() ? `Descrição colada pelo administrador:\n${input.description.trim()}` : '', input.scopeText?.trim() ? `Texto da ordem (Scope of Work):\n${input.scopeText.trim()}` : '', input.locationName?.trim() ? `Local: ${input.locationName.trim()}` : ''].filter(Boolean)
  if (parts.join('').length < 15) return null
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null
  try {
    const raw = await generateStructuredReply<Raw>({ apiKey, systemPrompt: SYSTEM_PROMPT, history: [{ role: 'user', content: parts.join('\n\n').slice(0, 8000) }], maxTokens: 700 })
    return cleanAnalysis(raw)
  } catch (error) {
    console.error(`[order_demand_analysis] falha: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
