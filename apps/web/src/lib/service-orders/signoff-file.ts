/** Nome do arquivo do Sign Off baixado/compartilhado: `SignOff_PO-<número>-<AAAA-MM-DD>.pdf` (sem caracteres que quebram em Arquivos/WhatsApp). */
export function signOffFileName(input: { clientPo?: string | null; orderNumber?: string | null; fallbackId?: string | null; dateIso: string }): string {
  const clean = (value: string | null | undefined) => (value ?? '').trim().replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '')
  const number = clean(input.clientPo) || clean(input.orderNumber) || clean(input.fallbackId).slice(0, 8) || 'ordem'
  const parsed = new Date(input.dateIso)
  // data de serviço no fuso da operação (Costa Leste dos EUA), igual ao restante do documento
  const date = Number.isNaN(parsed.getTime())
    ? 'sem-data'
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed)
  return `SignOff_PO-${number}-${date}.pdf`
}

/** Extrai o nome do arquivo de um cabeçalho Content-Disposition (aceita `filename="x.pdf"`). Devolve null se não houver ou se for suspeito. */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  const match = /filename="?([^";]+)"?/i.exec(header ?? '')
  const name = match?.[1]?.trim()
  if (!name || /[\\/]/.test(name) || name.includes('..')) return null
  return name
}

/** Um PDF de verdade começa com `%PDF-`. Qualquer outra coisa (página de erro, JSON) NÃO pode ser oferecida como Sign Off. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 1024 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'
}

/**
 * A ordem já tem Sign Off assinado e salvo no servidor, e portanto PDF para baixar/compartilhar? Vale para "Finalizado" E para "Cotação"
 * (o PDF é o mesmo Sign Off Sheet): só fica de fora a ordem ainda pendente ou sem assinatura/nome de quem assinou.
 */
export function hasSignedSignOff(order: { service_order_status: string | null; service_order_signature_url: string | null; service_order_signed_by: string | null }): boolean {
  return order.service_order_status !== 'pending' && Boolean(order.service_order_signature_url) && Boolean(order.service_order_signed_by?.trim())
}
