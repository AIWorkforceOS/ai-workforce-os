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
  clientPo: string | null
  priority: string | null
  orderType: string | null
  ivrPin: string | null
  locationName: string | null
  locationPhone: string | null
  issuerName: string | null
  issuerEmail: string | null
}

const SYSTEM_PROMPT = `Você recebe o documento (foto, print ou PDF) de uma ordem de serviço de manutenção geral enviada por uma empresa contratante (ex.: Mawi/360) para um técnico de campo — normalmente um "Sign Off Sheet" com cabeçalho fixo da contratante e campos específicos da ordem (PO, prioridade, tipo, local, IVR, contato do emissor).

Leia o documento e responda em JSON com exatamente estas chaves:
{
  "summary_pt": "o texto COMPLETO do escopo do trabalho (\\"Scope Of Work\\"), em PORTUGUÊS, fiel ao que está escrito no documento — NÃO é um resumo de 2-4 frases, é o texto integral que o técnico vai ler como a descrição oficial da tarefa, preservando parágrafos quando existirem. Se o documento já estiver em português, ainda assim organize o texto de forma legível, sem cortar conteúdo. null se não conseguir identificar.",
  "address": "endereço completo do local do atendimento, como aparece no documento (rua, número, cidade, estado). null se não conseguir identificar com confiança.",
  "order_number": "número ou código da ordem de serviço (Vendor PO #), como aparece no documento. null se não conseguir identificar com confiança.",
  "client_po": "número do Client PO #, quando existir e for distinto do Vendor PO #. null se não conseguir identificar.",
  "priority": "prioridade da ordem (ex.: Low, Medium, High), como impressa no documento. null se não conseguir identificar.",
  "order_type": "tipo da ordem (ex.: Interior, Exterior), como impresso no documento. null se não conseguir identificar.",
  "ivr_pin": "PIN do IVR do local do atendimento, se houver impresso. null se não conseguir identificar.",
  "location_name": "nome ou código do local do atendimento (ex.: \\"PB - Tanger - Loc # 6800\\"), distinto do endereço completo. null se não conseguir identificar.",
  "location_phone": "telefone do local do atendimento, se houver impresso. null se não conseguir identificar.",
  "issuer_name": "nome da pessoa de contato da contratante que emitiu a ordem, se houver. null se não conseguir identificar.",
  "issuer_email": "e-mail dessa pessoa de contato, se houver. null se não conseguir identificar."
}

Nunca invente informação que não está no documento — prefira null a um palpite. Responda só o JSON, nada mais.`

type RawExtraction = {
  summary_pt?: unknown
  address?: unknown
  order_number?: unknown
  client_po?: unknown
  priority?: unknown
  order_type?: unknown
  ivr_pin?: unknown
  location_name?: unknown
  location_phone?: unknown
  issuer_name?: unknown
  issuer_email?: unknown
}

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
    clientPo: cleanString(raw.client_po),
    priority: cleanString(raw.priority),
    orderType: cleanString(raw.order_type),
    ivrPin: cleanString(raw.ivr_pin),
    locationName: cleanString(raw.location_name),
    locationPhone: cleanString(raw.location_phone),
    issuerName: cleanString(raw.issuer_name),
    issuerEmail: cleanString(raw.issuer_email),
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
