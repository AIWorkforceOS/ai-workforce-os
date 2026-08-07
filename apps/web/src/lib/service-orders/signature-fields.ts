import { generateStructuredReplyFromImage, generateStructuredReplyFromPdf, getOpenAIApiKey } from '@/lib/openai'

/**
 * Localização por IA (visão) dos campos "Signature" / "Print Name" /
 * "Date" impressos no documento original da ordem de serviço, pra
 * carimbar assinatura/nome/data exatamente em cima deles em vez de um
 * box fixo no canto — formulários variam entre contratantes (Mawi/360
 * e outras) e não têm posição fixa. Bônus, não requisito bloqueante:
 * qualquer falha (sem API key, campo não encontrado, resposta
 * inválida) devolve null e quem chama cai pro box fixo.
 */

export type SignatureFieldPoint = { xFrac: number; yFrac: number }

export type SignatureFieldLocations = {
  /** 1-indexado — página do documento onde os campos foram encontrados. */
  pageNumber: number
  signature: SignatureFieldPoint | null
  printName: SignatureFieldPoint | null
  date: SignatureFieldPoint | null
}

const SYSTEM_PROMPT = `Você recebe uma página (ou um documento com várias páginas) de uma ordem de serviço / formulário de manutenção. A página pode conter três campos impressos para preenchimento manual: um rótulo "Signature" (ou "Assinatura"), um rótulo "Print Name" (às vezes aparece como "Print" e "Name" separados, ou "Nome") e um rótulo "Date" (ou "Data"). Cada um normalmente tem uma linha ou espaço em branco ao lado ou logo abaixo do rótulo, onde a pessoa escreveria à mão.

Sua tarefa: localizar esses três campos e informar a coordenada aproximada (ponto central) do ESPAÇO EM BRANCO onde o texto/assinatura deve ser escrito — não a coordenada do texto do rótulo em si (a menos que não exista linha ou espaço separado, aí use a posição logo ao lado do rótulo).

Responda em JSON com coordenadas NORMALIZADAS de 0.0 a 1.0 como fração da largura/altura da página, com origem (0,0) no canto SUPERIOR ESQUERDO da página e (1,1) no canto INFERIOR DIREITO (ou seja, y cresce de cima para baixo, x cresce da esquerda pra direita):

{
  "page_number": <número da página, 1-indexado, onde esses campos aparecem — geralmente a última página do documento>,
  "signature": { "x": 0.0-1.0, "y": 0.0-1.0 } ou null,
  "print_name": { "x": 0.0-1.0, "y": 0.0-1.0 } ou null,
  "date": { "x": 0.0-1.0, "y": 0.0-1.0 } ou null
}

Use null para qualquer campo que não exista no documento ou que você não consiga localizar com confiança — nunca invente uma coordenada. Responda só o JSON, nada mais.`

type RawPoint = { x?: unknown; y?: unknown } | null | undefined
type RawFieldLocations = { page_number?: unknown; signature?: RawPoint; print_name?: RawPoint; date?: RawPoint }

function toPoint(raw: RawPoint): SignatureFieldPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const x = Number((raw as { x?: unknown }).x)
  const y = Number((raw as { y?: unknown }).y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { xFrac: x, yFrac: y }
}

function toLocations(raw: RawFieldLocations, pageCount: number): SignatureFieldLocations {
  const pageNumberRaw = Number(raw.page_number)
  const pageNumber = Number.isFinite(pageNumberRaw) && pageNumberRaw >= 1 && pageNumberRaw <= pageCount ? Math.round(pageNumberRaw) : pageCount

  return {
    pageNumber,
    signature: toPoint(raw.signature),
    printName: toPoint(raw.print_name),
    date: toPoint(raw.date),
  }
}

function hasAnyField(locations: SignatureFieldLocations): boolean {
  return locations.signature !== null || locations.printName !== null || locations.date !== null
}

/** Localiza os campos num PDF original — manda o arquivo inteiro (content part nativo, sem OCR), o modelo escolhe a página. */
export async function detectSignatureFieldsFromPdf(params: { fileName: string; base64Pdf: string; pageCount: number }): Promise<SignatureFieldLocations | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReplyFromPdf<RawFieldLocations>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      fileName: params.fileName,
      base64Pdf: params.base64Pdf,
      userText: `O documento tem ${params.pageCount} página(s). Localize os campos de assinatura/nome/data conforme o schema pedido.`,
    })
    const locations = toLocations(raw, params.pageCount)
    return hasAnyField(locations) ? locations : null
  } catch (error) {
    console.error(
      `[service_order_signature_fields] falha ao localizar campos de assinatura (PDF): ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/** Localiza os campos numa imagem original (foto/print) — documento de página única. */
export async function detectSignatureFieldsFromImage(params: { imageUrl: string }): Promise<SignatureFieldLocations | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReplyFromImage<RawFieldLocations>({
      apiKey,
      systemPrompt: SYSTEM_PROMPT,
      imageUrl: params.imageUrl,
      userText: 'Localize os campos de assinatura/nome/data conforme o schema pedido.',
    })
    const locations = toLocations(raw, 1)
    return hasAnyField(locations) ? locations : null
  } catch (error) {
    console.error(
      `[service_order_signature_fields] falha ao localizar campos de assinatura (imagem): ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}
