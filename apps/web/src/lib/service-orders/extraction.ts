import { generateStructuredReplyFromImage, generateStructuredReplyFromPdf, getOpenAIApiKey } from '@/lib/openai'

/**
 * Extração por IA (visão) da ordem de serviço anexada pelo admin —
 * Fase A do fluxo Mawi/360 (general_maintenance). Bônus, não requisito
 * bloqueante: qualquer falha (sem API key, documento ilegível, erro da
 * OpenAI) devolve null e o admin preenche os campos manualmente, o
 * arquivo original continua anexado e abrível de qualquer forma.
 */

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
const PDF_EXTENSIONS = new Set(['pdf'])

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function isExtractableImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(fileName))
}

export function isExtractablePdfFile(fileName: string): boolean {
  return PDF_EXTENSIONS.has(extensionOf(fileName))
}

/** Qualquer anexo aceito pelo upload (imagem ou PDF) passa por extração — ver service-order-attach-modal.tsx. */
export function isExtractableAttachment(fileName: string): boolean {
  return isExtractableImageFile(fileName) || isExtractablePdfFile(fileName)
}

export type ServiceOrderExtraction = {
  summaryPt: string | null
  address: string | null
  orderNumber: string | null
}

const SYSTEM_PROMPT = `Você recebe o documento (foto, print ou PDF) de uma ordem de serviço de manutenção geral enviada por uma empresa contratante (ex.: Mawi/360) para um técnico de campo.

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

function toExtraction(raw: RawExtraction): ServiceOrderExtraction {
  return {
    summaryPt: cleanString(raw.summary_pt),
    address: cleanString(raw.address),
    orderNumber: cleanString(raw.order_number),
  }
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
    return toExtraction(raw)
  } catch (error) {
    console.error(
      `[service_order_extraction] falha ao extrair dados da ordem de serviço: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * Extração por IA de um PDF de ordem de serviço: baixa o arquivo (URL
 * pública do bucket service-orders), converte para base64 e manda pra
 * OpenAI via content part nativo de arquivo (ver
 * generateStructuredReplyFromPdf em lib/openai.ts) — sem OCR/conversão
 * em imagem à parte. Mesma garantia da extração por imagem: qualquer
 * falha (download do arquivo, API, JSON inválido) devolve null.
 */
export async function extractServiceOrderFromPdf(fileUrl: string, fileName: string): Promise<ServiceOrderExtraction | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const fileResponse = await fetch(fileUrl)
    if (!fileResponse.ok) {
      throw new Error(`não foi possível baixar o PDF para extração (status ${fileResponse.status})`)
    }
    const arrayBuffer = await fileResponse.arrayBuffer()
    const base64Pdf = Buffer.from(arrayBuffer).toString('base64')

    const raw = await generateStructuredReplyFromPdf<RawExtraction>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      fileName,
      base64Pdf,
      userText: 'Extraia os dados desta ordem de serviço conforme o schema pedido.',
    })
    return toExtraction(raw)
  } catch (error) {
    console.error(
      `[service_order_extraction] falha ao extrair dados da ordem de serviço (PDF): ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/** Roteia pro caminho de extração certo (imagem ou PDF) conforme a extensão do arquivo; null se o tipo não é suportado. */
export async function extractServiceOrderFromAttachment(fileUrl: string, fileName: string): Promise<ServiceOrderExtraction | null> {
  if (isExtractableImageFile(fileName)) return extractServiceOrderFromImage(fileUrl)
  if (isExtractablePdfFile(fileName)) return extractServiceOrderFromPdf(fileUrl, fileName)
  return null
}
