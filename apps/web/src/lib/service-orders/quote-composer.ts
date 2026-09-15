import { generateStructuredReply, getOpenAIApiKey } from '@/lib/openai'

/**
 * Transforma a anotação crua do técnico (o que precisa pra fazer o
 * serviço, em português, campo "Material necessário" do Portal do
 * Funcionário) numa cotação profissional em inglês pro cliente final —
 * pedido do Vinicius (2026-09-15): "o técnico coloca o que precisa, a
 * AI estrutura tudo em inglês pro office enviar a cotação pronta e
 * muito profissional". Devolve também uma tradução em português do
 * MESMO texto gerado (não da anotação original) — é o que quem está no
 * escritório da 360 usa pra conferir na íntegra o que está prestes a
 * mandar, nunca enviado ao cliente.
 *
 * Botão manual no Portal 360 (não roda sozinho): diferente do resumo
 * da Facil-IT (lib/facilit-summary.ts), aqui o texto vira a cotação de
 * verdade que sai pro cliente, então quem pediu decide quando gerar/
 * regenerar, não um cron.
 */

const SYSTEM_PROMPT = `Você ajuda o escritório de uma rede de prestação de serviços (360) a montar uma cotação profissional em inglês pra mandar pro gerente de uma loja cliente (ex.: Walgreens, Family Dollar), a partir da anotação em português que um técnico de campo deixou sobre o que é necessário pra concluir o serviço.

Responda em JSON com exatamente estas duas chaves:
{
  "quote_en": "texto profissional, claro e objetivo EM INGLÊS, pronto pra ser enviado a um cliente corporativo — descreve o que foi identificado e o que é necessário pra concluir o serviço (material, trabalho). Tom formal e direto, sem gírias, sem inventar informação que não está na anotação. 2-5 frases.",
  "quote_pt": "tradução fiel do texto acima (quote_en) para português do Brasil — não é um resumo, é a mesma cotação traduzida, pra quem está no escritório conferir exatamente o que vai ser enviado."
}

Nunca invente material, valores ou prazos que não estão na anotação do técnico. Se a anotação não tiver informação suficiente pra uma cotação coerente, ainda assim estruture o que houver da forma mais profissional possível. Responda só o JSON, nada mais.`

export type ComposedQuote = { en: string; pt: string }

type RawQuote = { quote_en?: unknown; quote_pt?: unknown }

export async function composeClientQuoteDescription(technicianNotes: string): Promise<ComposedQuote | null> {
  const trimmedNotes = technicianNotes.trim()
  if (!trimmedNotes) return null

  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReply<RawQuote>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      history: [{ role: 'user', content: `Anotação do técnico (português, original):\n${trimmedNotes}` }],
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
