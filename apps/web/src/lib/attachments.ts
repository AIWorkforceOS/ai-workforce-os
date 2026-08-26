import type { SupabaseClient } from '@supabase/supabase-js'
import { generateStructuredReplyFromImage, generateStructuredReplyFromPdf, getOpenAIApiKey } from '@/lib/openai'
import type { EmployeeAttachment, Unit } from '@/lib/types'

/**
 * Materiais ativos da biblioteca da organização visíveis para um
 * funcionário nesta unidade (migration 036, generalizada na 062): inclui
 * tanto materiais cadastrados especificamente para `unit` quanto os
 * cadastrados para a organização inteira (unit_id null), filtrados pelos
 * que têm `agentType` em `applicable_employees` — um mesmo material pode
 * valer para vários funcionários ao mesmo tempo.
 */
export async function fetchActiveAttachments(
  supabase: SupabaseClient,
  unit: Pick<Unit, 'id' | 'org_id'>,
  agentType: string,
): Promise<EmployeeAttachment[]> {
  if (!unit.org_id) return []

  const { data } = await supabase
    .from('employee_attachments')
    .select('*')
    .eq('org_id', unit.org_id)
    .or(`unit_id.eq.${unit.id},unit_id.is.null`)
    .overlaps('applicable_employees', [agentType])
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  return (data as EmployeeAttachment[] | null) ?? []
}

/**
 * Limite de caracteres do texto extraído injetado no prompt por material
 * (item 5 do pedido de 2026-08-14): documentos reais (ex.: COF) costumam
 * ter 30-100 páginas, o que estouraria o orçamento de tokens do prompt se
 * injetado por inteiro — ainda mais com vários materiais ativos ao mesmo
 * tempo (buildAttachmentsContext soma todos). ~6000 caracteres (~1500
 * tokens) por material é uma escolha de produto sem pedido explícito de
 * tamanho: alto o bastante pra cobrir a maioria dos documentos de uso comum
 * (contrato modelo, tabela de preços, apresentação) por inteiro, baixo o
 * bastante pra não dominar o prompt sozinho quando há mais de um material
 * ativo. Resumir com IA em vez de truncar fica para uma iteração futura,
 * se necessário — não é o pedido de agora.
 */
const ATTACHMENT_TEXT_MAX_CHARS = 6000

export function truncateAttachmentText(text: string, maxChars: number = ATTACHMENT_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n[conteúdo truncado]`
}

/**
 * Extração de texto de PDF por IA (Opção A do diagnóstico: texto simples,
 * não RAG/embeddings) — reaproveita a MESMA abordagem já usada pela
 * extração de ordens de serviço (extractServiceOrderFromPdf em
 * lib/service-orders/extraction.ts): baixa o arquivo, converte para
 * base64 e manda pra OpenAI via content part nativo de arquivo
 * (generateStructuredReplyFromPdf em lib/openai.ts), sem OCR/lib de
 * parsing à parte. Bônus, não bloqueante: qualquer falha (sem API key,
 * download, documento ilegível, erro da OpenAI) devolve null — o upload
 * do material continua normalmente, só sem o texto extraído desta vez.
 */
export async function extractAttachmentPdfText(fileUrl: string, fileName: string): Promise<string | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const fileResponse = await fetch(fileUrl)
    if (!fileResponse.ok) {
      throw new Error(`não foi possível baixar o PDF para extração (status ${fileResponse.status})`)
    }
    const arrayBuffer = await fileResponse.arrayBuffer()
    const base64Pdf = Buffer.from(arrayBuffer).toString('base64')

    const raw = await generateStructuredReplyFromPdf<{ text?: unknown }>({
      apiKey,
      systemPrompt:
        'Você recebe um documento PDF. Extraia TODO o texto legível dele, fielmente, sem resumir, sem comentar e sem adicionar nada que não esteja no documento — preserve a ordem do conteúdo. Responda SOMENTE um JSON válido: {"text": string}.',
      fileName,
      base64Pdf,
      userText: 'Extraia o texto completo deste documento.',
      maxTokens: 4000,
    })

    const text = typeof raw.text === 'string' ? raw.text.trim() : ''
    return text || null
  } catch (error) {
    console.error(
      `[attachments] falha ao extrair texto do PDF "${fileName}": ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * Descrição por IA de uma imagem anexada (achado real da auditoria
 * pré-lançamento de 2026-08-26: imagens eram anexadas mas nunca "lidas"
 * pelo modelo — só o PDF tinha extração de conteúdo, ver
 * extractAttachmentPdfText acima). Mesmo padrão: melhor esforço, nunca
 * bloqueia o upload, devolve null em qualquer falha. Usa a mesma visão
 * nativa do gpt-4o-mini já usada por generateStructuredReplyFromImage
 * (extração da ordem de serviço) — sem serviço de visão à parte.
 *
 * Serve tanto pra materiais de marca (cardápio em foto, print de
 * embalagem) quanto pra referências de criativos que o cliente admira
 * (print de post de concorrente, por exemplo) — o Gestor de Conteúdo
 * passa a "ver" o que descreve, em vez de só saber que a imagem existe.
 */
export async function extractAttachmentImageDescription(fileUrl: string, fileName: string): Promise<string | null> {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return null

  try {
    const raw = await generateStructuredReplyFromImage<{ description?: unknown }>({
      apiKey,
      systemPrompt:
        'Você recebe uma imagem anexada por um cliente numa plataforma de funcionários digitais de IA. Descreva em detalhe, em português, tudo que for relevante pra um profissional de marketing/conteúdo entender e se inspirar: composição, cores predominantes, estilo visual, textos visíveis na imagem (transcreva-os), elementos de marca, e o assunto/produto/serviço retratado. Responda SOMENTE um JSON válido: {"description": string}.',
      imageUrl: fileUrl,
      userText: `Descreva esta imagem ("${fileName}") em detalhe.`,
      maxTokens: 700,
    })

    const description = typeof raw.description === 'string' ? raw.description.trim() : ''
    return description || null
  } catch (error) {
    console.error(
      `[attachments] falha ao descrever a imagem "${fileName}": ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * Texto injetado no system prompt (buildSystemPrompt em
 * lib/conversation-engine.ts) com a lista de materiais disponíveis e a
 * instrução de quando usar cada um — é essa instrução, escrita pelo
 * próprio cliente na UI, que funciona como "treinamento" da decisão.
 * Vazio quando não há nenhum anexo ativo (nenhum contexto extra, sem
 * mudar o comportamento de quem nunca configurou nada).
 *
 * Quando existe `extracted_text` (PDF já processado por
 * extractAttachmentPdfText no upload, ver migration 063), o conteúdo do
 * documento (truncado, ver ATTACHMENT_TEXT_MAX_CHARS) entra junto —
 * antes disso o funcionário só sabia QUANDO enviar um material, nunca o
 * que estava escrito dentro dele.
 */
export function buildAttachmentsContext(attachments: EmployeeAttachment[]): string {
  if (attachments.length === 0) return ''

  const kindLabel = (kind: EmployeeAttachment['kind']) =>
    kind === 'pdf' ? 'PDF' : kind === 'image' ? 'imagem' : 'link'

  const list = attachments
    .map((a) => {
      const base = `id "${a.id}": "${a.title}" (${kindLabel(a.kind)}) — quando usar: ${a.usage_instructions}`
      const content = a.extracted_text ? ` — conteúdo do documento: ${truncateAttachmentText(a.extracted_text)}` : ''
      return `${base}${content}`
    })
    .join('; ')

  return [
    `MATERIAIS DISPONÍVEIS PARA ENVIAR: você pode enviar os seguintes materiais durante a conversa, SOMENTE quando fizer sentido pelo contexto descrito em cada um — nunca envie por padrão, nem em toda mensagem, nem mais de uma vez para o mesmo assunto: ${list}.`,
    'Para enviar um deles nesta resposta, retorne o campo "attachment_id" com o id EXATO da lista acima. Para não enviar nada nesta mensagem, retorne "attachment_id": null. Nunca invente um id que não esteja na lista, e nunca invente a existência de um material que não está nela.',
  ].join(' ')
}
