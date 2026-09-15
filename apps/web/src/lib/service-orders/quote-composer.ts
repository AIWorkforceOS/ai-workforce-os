import { generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'

/**
 * Transforma a anotação crua do técnico (o que precisa pra fazer o
 * serviço, em português, campo "Material necessário" do Portal do
 * Funcionário) numa cotação profissional e completa em inglês pro
 * cliente final — pedido do Vinicius (2026-09-15): "a AI estrutura
 * tudo em inglês pro office enviar a cotação pronta e muito
 * profissional", "precisa ser melhorado por IA em cima do que o
 * técnico colocou para ir um documento muito completo". Devolve
 * também a MESMA cotação traduzida em português — documento espelho,
 * não um resumo — pra quem está no escritório (Mawi Pro ou 360)
 * conferir na íntegra o que está prestes a mandar antes de enviar.
 * Tudo que aparece no inglês tem que aparecer no português, e
 * vice-versa; são dois documentos separados (idiomas diferentes) pra
 * poderem ser enviados cada um pro seu destino.
 *
 * Usado tanto pelo Portal 360 (login da 360) quanto pelo painel do
 * admin da unidade — mesma função, cada chamador tem sua própria rota
 * de API com a autorização adequada.
 *
 * Botão manual (não roda sozinho): diferente do resumo da Facil-IT
 * (lib/facilit-summary.ts), aqui o texto vira a cotação de verdade que
 * sai pro cliente, então quem pediu decide quando gerar/regenerar, não
 * um cron.
 */

const SYSTEM_PROMPT = `Você ajuda o escritório de uma rede de prestação de serviços de manutenção (360) a montar uma cotação (quote) profissional e completa em inglês, pronta pra mandar pro gerente de uma loja cliente corporativa (ex.: Walgreens, Family Dollar), a partir da anotação em português que um técnico de campo deixou sobre o que foi encontrado e o que é necessário pra concluir o serviço.

Monte um documento completo, não um resumo curto — estruture como uma cotação real:
1. Abertura breve identificando o local/ordem (se a informação foi fornecida).
2. O que foi encontrado/diagnosticado no local (baseado só na anotação do técnico).
3. O que é necessário pra concluir o serviço — material, peças, mão de obra.
4. Estimativa de custo e de tempo, SE fornecidas (nunca invente números).
5. Referência do material/peça (link), SE fornecida.
6. Fechamento profissional convidando o cliente a aprovar a cotação.

Responda em JSON com exatamente estas duas chaves:
{
  "quote_en": "documento completo EM INGLÊS, com quebras de linha entre as seções, tom formal e direto, pronto pra ser enviado a um cliente corporativo sem edição.",
  "quote_pt": "o MESMO documento, mesma estrutura e mesmas seções, traduzido pra português do Brasil — não é um resumo, é o documento espelho, pra quem está no escritório conferir exatamente o que vai ser enviado."
}

Regra mais importante: nunca invente material, valores, prazos ou informação que não está nos dados fornecidos. Se um dado (custo, prazo, link) não foi fornecido, simplesmente omita essa seção do documento em vez de inventar um número. Tudo que aparece no quote_en tem que aparecer no quote_pt, e vice-versa — são o mesmo conteúdo em dois idiomas. Responda só o JSON, nada mais.`

export type ComposedQuote = { en: string; pt: string }

export type QuoteComposerInput = {
  /** Anotação crua do técnico (português) — único campo obrigatório; sem ele não há o que estruturar. */
  technicianNotes: string
  locationName?: string | null
  orderNumber?: string | null
  materialValue?: number | null
  hoursNeeded?: number | null
  partPurchaseLink?: string | null
}

type RawQuote = { quote_en?: unknown; quote_pt?: unknown }

function buildContext(input: QuoteComposerInput): string {
  const lines = [
    `Anotação do técnico (português, original): ${input.technicianNotes.trim()}`,
    input.locationName ? `Local: ${input.locationName}` : null,
    input.orderNumber ? `Ordem/PO #: ${input.orderNumber}` : null,
    input.materialValue != null ? `Custo estimado do material: US$ ${input.materialValue.toFixed(2)}` : null,
    input.hoursNeeded != null ? `Tempo estimado: ${input.hoursNeeded}h` : null,
    input.partPurchaseLink ? `Link de referência do material: ${input.partPurchaseLink}` : null,
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

export async function composeClientQuoteDescription(input: QuoteComposerInput): Promise<ComposedQuote | null> {
  const trimmedNotes = input.technicianNotes.trim()
  if (!trimmedNotes) return null

  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReply<RawQuote>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      history: [{ role: 'user', content: buildContext({ ...input, technicianNotes: trimmedNotes }) }],
      maxTokens: 2000,
    })
    const quoteEn = typeof raw.quote_en === 'string' ? raw.quote_en.trim() : ''
    const quotePt = typeof raw.quote_pt === 'string' ? raw.quote_pt.trim() : ''
    if (!quoteEn || !quotePt) return null
    return { en: quoteEn, pt: quotePt }
  } catch (error) {
    console.error(`[quote_composer] falha ao gerar cotação estruturada: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
