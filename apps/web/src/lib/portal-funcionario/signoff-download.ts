import { filenameFromContentDisposition, looksLikePdf, signOffFileName } from '@/lib/service-orders/signoff-file'

/**
 * Baixar/compartilhar o Sign Off no celular. Reutiliza o endpoint de PDF de sempre (autenticado pela sessão, RLS da ordem):
 * nada de URL temporária, pop-up ou documento novo — só busca o PDF pronto e entrega pelo caminho que o aparelho suporta.
 *
 * iPhone/Android com compartilhamento de arquivos: folha nativa (Salvar em Arquivos, WhatsApp…). Sem isso: download com nome certo.
 * Último recurso: abre o PDF com instrução clara para salvar.
 */
export type SignOffFile = { file: File; name: string }

export type FetchSignOffResult = { ok: true; value: SignOffFile } | { ok: false; message: string }

type Deps = {
  fetchFn?: typeof fetch
}

export function pdfUrl(unitId: string, appointmentId: string): string {
  return `/api/units/${unitId}/appointments/${appointmentId}/service-order/pdf`
}

/** Busca qualquer PDF do próprio app (Sign Off, relatório fotográfico) pela sessão atual, confere que é PDF de verdade e devolve como arquivo. */
export async function fetchPdf(input: { url: string; fallbackName: string }, deps: Deps = {}): Promise<FetchSignOffResult> {
  const fetchFn = deps.fetchFn ?? fetch
  let response: Response
  try {
    response = await fetchFn(input.url, { credentials: 'same-origin', cache: 'no-store' })
  } catch {
    return { ok: false, message: 'Sem conexão para baixar o PDF. Verifique a internet e tente de novo.' }
  }
  if (response.status === 401) return { ok: false, message: 'Sua sessão expirou. Entre de novo no app e tente baixar.' }
  if (response.status === 404 || response.status === 403) return { ok: false, message: 'Não encontramos este PDF para o seu acesso (ou a ordem ainda não tem o conteúdo).' }
  if (!response.ok) return { ok: false, message: 'Não foi possível gerar o PDF agora. Tente de novo em instantes.' }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await response.arrayBuffer())
  } catch {
    return { ok: false, message: 'O download foi interrompido. Tente de novo.' }
  }
  if (!looksLikePdf(bytes)) return { ok: false, message: 'O arquivo recebido não é um PDF válido. Tente de novo.' }
  const name = filenameFromContentDisposition(response.headers.get('content-disposition')) ?? input.fallbackName
  return { ok: true, value: { file: new File([bytes as BlobPart], name, { type: 'application/pdf' }), name } }
}

export async function fetchSignOffPdf(
  input: { unitId: string; appointmentId: string; orderNumber?: string | null; startsAt: string },
  deps: Deps = {},
): Promise<FetchSignOffResult> {
  return fetchPdf({ url: pdfUrl(input.unitId, input.appointmentId), fallbackName: signOffFileName({ orderNumber: input.orderNumber, fallbackId: input.appointmentId, dateIso: input.startsAt }) }, deps)
}

/** O aparelho consegue compartilhar ARQUIVOS PDF pela folha nativa (iPhone/Android modernos)? */
export function canShareFiles(nav: Pick<Navigator, 'canShare' | 'share'> | undefined = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [new File([new Uint8Array(8)], 'SignOff.pdf', { type: 'application/pdf' })] })
  } catch {
    return false
  }
}

export type ShareOutcome = 'shared' | 'cancelled' | 'needs_tap' | 'unsupported'

/**
 * Abre a folha nativa de compartilhar com o PDF. `needs_tap`: o Safari recusou por a permissão do toque ter expirado (o PDF demorou a gerar)
 * — a tela mostra o PDF pronto e o próximo toque compartilha na hora.
 */
export async function sharePdf(file: File, nav: Pick<Navigator, 'canShare' | 'share'> | undefined = typeof navigator !== 'undefined' ? navigator : undefined): Promise<ShareOutcome> {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || !nav.canShare({ files: [file] })) return 'unsupported'
  try {
    await nav.share({ files: [file], title: file.name })
    return 'shared'
  } catch (error) {
    const name = (error as { name?: string } | null)?.name
    if (name === 'AbortError') return 'cancelled'
    if (name === 'NotAllowedError') return 'needs_tap'
    return 'unsupported'
  }
}

/** Download comum (Chrome/Android → pasta Downloads; Safari → pergunta e salva em Arquivos). Devolve false se o navegador não permitir. */
export function downloadPdf(file: File, doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): boolean {
  if (!doc) return false
  try {
    const url = URL.createObjectURL(file)
    const link = doc.createElement('a')
    link.href = url
    link.download = file.name
    link.rel = 'noopener'
    doc.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return true
  } catch {
    return false
  }
}
