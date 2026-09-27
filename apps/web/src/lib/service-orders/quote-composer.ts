import type { SupabaseClient } from '@supabase/supabase-js'
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
 *
 * Ajuste de tom (pedido do Vinicius, 2026-09-17, depois de ver o
 * resultado real): (1) menos formal/robótico, mais natural; (2) NUNCA
 * se dirigir ao cliente ou à loja pelo nome — nada de "Dear [Nome]" nem
 * o nome do local/cliente em nenhum lugar do texto, só a análise em si;
 * por isso locationName nem é passado no contexto abaixo — se o modelo
 * não vê o nome, não tem como usá-lo. (3) sempre as duas versões
 * completas (inglês e português) — reforçado explicitamente no prompt.
 */

const SYSTEM_PROMPT = `Você ajuda o escritório de uma rede de prestação de serviços de manutenção (360) a transformar a anotação em português que um técnico de campo deixou (o que ele encontrou e o que é necessário pra concluir o serviço) numa cotação clara e completa pra mandar pro gerente de uma loja cliente corporativa.

Tom: natural e direto, como um técnico experiente explicando o que precisa ser feito — não um contrato jurídico nem um e-mail corporativo cheio de formalidade. Evite jargão burocrático, floreios e frases de efeito. Pode ser conversacional, mas sempre claro e objetivo.

Regra inegociável: NUNCA se dirija a ninguém. Não comece com saudação nenhuma ("Dear", "Hello", "Attention", "Prezado", etc.), não use o nome do cliente, da loja, do local ou de qualquer pessoa em NENHUM lugar do texto — nem pra identificar onde é o serviço. O documento é só a análise técnica e a cotação em si, direto ao ponto, sem se dirigir a ninguém em nenhuma das duas versões.

Estruture como uma cotação real, sem abertura/saudação:
1. O que foi encontrado/diagnosticado (baseado só na anotação do técnico).
2. O que é necessário pra concluir o serviço — material, peças, mão de obra.
3. Estimativa de custo e de tempo, SE fornecidas (nunca invente números).
4. Referência do material/peça (link), SE fornecida.
5. Fechamento curto e natural, convidando a aprovar a cotação — sem se dirigir a ninguém pelo nome.

Responda em JSON com exatamente estas duas chaves, AS DUAS SEMPRE PREENCHIDAS POR COMPLETO — nunca deixe uma de fora, nunca resuma uma e escreva a outra por extenso, são o mesmo conteúdo em dois idiomas:
{
  "quote_en": "documento completo EM INGLÊS, com quebras de linha entre as seções, tom natural e direto (ver regras de tom acima), pronto pra ser enviado a um cliente corporativo sem edição, sem saudação e sem nome nenhum.",
  "quote_pt": "o MESMO documento, mesma estrutura e mesmo conteúdo, em português do Brasil — não é um resumo, é o documento espelho, pra quem está no escritório conferir exatamente o que vai ser enviado. Mesmo tom natural, mesma regra de nunca se dirigir a ninguém."
}

Regra mais importante: nunca invente material, valores, prazos ou informação que não está nos dados fornecidos. Se um dado (custo, prazo, link) não foi fornecido, simplesmente omita essa seção do documento em vez de inventar um número. Tudo que aparece no quote_en tem que aparecer no quote_pt, e vice-versa. Responda só o JSON, nada mais.`

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

/**
 * locationName e orderNumber propositalmente NÃO entram aqui — o
 * modelo não pode se dirigir ao cliente/loja pelo nome, e a forma mais
 * segura de garantir isso é nem deixar esse nome visível pra ele (ver
 * comentário do SYSTEM_PROMPT acima).
 */
function buildContext(input: QuoteComposerInput): string {
  const lines = [
    `Anotação do técnico (português, original): ${input.technicianNotes.trim()}`,
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
      // Default da lib (0.2) saía formal/robótico demais — pedido do Vinicius (2026-09-17) de tom mais natural.
      temperature: 0.6,
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

/**
 * Gera a cotação estruturada por IA (inglês + português) automaticamente
 * assim que o técnico salva a ordem como "Cotação" no Portal do
 * Funcionário — pedido direto do Vinicius (2026-09-27): "assim que
 * escrever a cotação a AI já entra em ação... e assim que salvar já
 * salva a versão final". Antes disso só rodava com um clique manual
 * (botão "Gerar cotação com IA" no painel do admin/Portal 360) — se
 * ninguém clicasse, a página em inglês do PDF saía em branco e só a
 * nota crua em português aparecia (ver drawQuotePage em
 * lib/service-orders/pdf.ts), exatamente o "só está saindo a versão
 * português" relatado.
 *
 * Recebe o client já pronto (em vez de construir um) pra ficar testável
 * com createFakeSupabase, mesmo padrão de syncFacilitOrdersForUnit — a
 * rota decide qual client passar. Precisa ser o SERVICE ROLE quando
 * chamada a partir da rota do técnico: service_order_quote_description_en/pt
 * não estão na allowlist do trigger appointments_guard_employee_write,
 * então uma escrita como role='employee' seria rejeitada pelo banco
 * (mesma razão pela qual as rotas do Portal 360 já usavam service role —
 * ver migration 084, bug real do NULL <> 'employee' que bloqueava
 * exatamente esta coluna).
 *
 * Nunca lança nem bloqueia o salvamento principal do técnico: erro na
 * IA (ou ausência de chave da OpenAI) só deixa a cotação estruturada
 * pendente até a próxima tentativa — o botão manual continua disponível
 * pra gerar/regenerar a qualquer momento.
 */
export async function autoGenerateQuoteOnSave(
  supabase: SupabaseClient,
  appointmentId: string,
  saved: {
    service_order_status?: string | null
    service_order_material_description?: string | null
    service_order_material_value?: number | null
    service_order_hours_needed?: number | null
    service_order_part_purchase_link?: string | null
  },
): Promise<void> {
  if (saved.service_order_status !== 'quote') return
  const technicianNotes = saved.service_order_material_description?.trim()
  if (!technicianNotes) return

  const quote = await composeClientQuoteDescription({
    technicianNotes,
    materialValue: saved.service_order_material_value ?? null,
    hoursNeeded: saved.service_order_hours_needed ?? null,
    partPurchaseLink: saved.service_order_part_purchase_link ?? null,
  })
  if (!quote) return

  await supabase
    .from('appointments')
    .update({ service_order_quote_description_en: quote.en, service_order_quote_description_pt: quote.pt })
    .eq('id', appointmentId)
}
