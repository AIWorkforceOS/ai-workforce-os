import { generateStructuredReplyFromImage, getOpenAIApiKey } from '@/lib/openai'

/**
 * Extração por IA (visão) da ordem de serviço anexada pelo admin —
 * Fase A do fluxo Mawi/360 (general_maintenance). Bônus, não requisito
 * bloqueante: qualquer falha (sem API key, imagem ilegível, erro da
 * OpenAI) devolve null e o admin preenche os campos manualmente, o
 * arquivo original continua anexado e abrível de qualquer forma.
 */

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])

/** Só PDF/imagem chegam como anexo de ordem; só imagem passa por extração (sem OCR de PDF nesta fase — ver comentário no chamador). */
export function isExtractableImageFile(fileName: string): boolean {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.has(extension)
}

export type ServiceOrderExtraction = {
  summaryPt: string | null
  address: string | null
  orderNumber: string | null
}

const SYSTEM_PROMPT = `Você recebe a foto (ou print) de uma ordem de serviço de manutenção geral enviada por uma empresa contratante (ex.: Mawi/360) para um técnico de campo.

Leia o documento e responda em JSON com exatamente estas chaves:
{
  "summary_pt": "resumo curto e direto EM PORTUGUÊS do que precisa ser feito, para o técnico bater o olho e já saber a tarefa sem ler o documento inteiro (2-4 frases, sem enrolação). Se o documento já estiver em português, ainda assim escreva um resumo objetivo, não copie o texto inteiro.",
  "address": "endereço completo do local do atendimento, como aparece no documento (rua, número, cidade, estado). null se não conseguir identificar com confiança.",
  "order_number": "número ou código da ordem de serviço, como aparece no documento. null se não conseguir identificar com confiança."
}

Nunca invente informação que não está no documento — prefira null a um palpite. Responda só o JSON, nada mais.`

type RawExtraction = { summary_pt?: unknown; address?: unknown; order_number?: unknown }

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'null') return null
  return trimmed
}

export async function extractServiceOrderFromImage(imageUrl: string): Promise<ServiceOrderExtraction | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReplyFromImage<RawExtraction>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      imageUrl,
      userText: 'Extraia os dados desta ordem de serviço conforme o schema pedido.',
    })
    return {
      summaryPt: cleanString(raw.summary_pt),
      address: cleanString(raw.address),
      orderNumber: cleanString(raw.order_number),
    }
  } catch (error) {
    console.error(
      `[service_order_extraction] falha ao extrair dados da ordem de serviço: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
