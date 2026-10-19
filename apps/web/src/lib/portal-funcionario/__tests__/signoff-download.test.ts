import { describe, expect, it, vi } from 'vitest'
import { canShareFiles, downloadPdf, fetchSignOffPdf, sharePdf } from '../signoff-download'

const pdfBytes = () => {
  const b = new Uint8Array(4000)
  b.set([0x25, 0x50, 0x44, 0x46, 0x2d])
  return b
}
const res = (status: number, body: BodyInit | null, headers: Record<string, string> = {}) => new Response(body, { status, headers })
const input = { unitId: 'u1', appointmentId: 'a1', orderNumber: '123', startsAt: '2026-10-13T13:00:00.000Z' }

describe('buscar o PDF do Sign Off', () => {
  it('PDF válido: devolve arquivo com o nome do cabeçalho e tipo application/pdf, pelo endpoint existente com a sessão', async () => {
    const fetchFn = vi.fn(async () => res(200, pdfBytes(), { 'content-disposition': 'attachment; filename="SignOff_PO-161088-02-2026-10-13.pdf"' }))
    const out = await fetchSignOffPdf(input, { fetchFn: fetchFn as unknown as typeof fetch })
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.value.name).toBe('SignOff_PO-161088-02-2026-10-13.pdf')
      expect(out.value.file.type).toBe('application/pdf')
      expect(out.value.file.size).toBe(4000)
    }
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/units/u1/appointments/a1/service-order/pdf')
    expect(init.credentials).toBe('same-origin')
  })
  it('sem cabeçalho de nome: monta o nome padrão', async () => {
    const out = await fetchSignOffPdf(input, { fetchFn: (async () => res(200, pdfBytes())) as unknown as typeof fetch })
    expect(out.ok && out.value.name).toBe('SignOff_PO-123-2026-10-13.pdf')
  })
  it('erros viram mensagem clara: sessão, sem acesso, servidor, rede, arquivo que não é PDF', async () => {
    const run = (r: () => Promise<Response>) => fetchSignOffPdf(input, { fetchFn: r as unknown as typeof fetch })
    expect((await run(async () => res(401, '{}'))).ok).toBe(false)
    const forbidden = await run(async () => res(404, '{}'))
    expect(!forbidden.ok && forbidden.message).toMatch(/Não encontramos/)
    const server = await run(async () => res(500, 'x'))
    expect(!server.ok && server.message).toMatch(/Tente de novo/)
    const network = await run(async () => { throw new TypeError('offline') })
    expect(!network.ok && network.message).toMatch(/conexão/)
    const notPdf = await run(async () => res(200, new TextEncoder().encode('<html>erro</html>'.repeat(200))))
    expect(!notPdf.ok && notPdf.message).toMatch(/PDF válido/)
  })
  it('tentar de novo depois de falhar funciona', async () => {
    let n = 0
    const fetchFn = (async () => (n++ === 0 ? res(500, 'x') : res(200, pdfBytes()))) as unknown as typeof fetch
    expect((await fetchSignOffPdf(input, { fetchFn })).ok).toBe(false)
    expect((await fetchSignOffPdf(input, { fetchFn })).ok).toBe(true)
  })
})

describe('compartilhar (iPhone/Android)', () => {
  const file = new File([pdfBytes()], 'SignOff_PO-1-2026-10-13.pdf', { type: 'application/pdf' })
  const nav = (share: () => Promise<void>, can = true) => ({ canShare: () => can, share }) as unknown as Pick<Navigator, 'canShare' | 'share'>
  it('detecta suporte a compartilhar arquivos PDF', () => {
    expect(canShareFiles(nav(async () => undefined))).toBe(true)
    expect(canShareFiles(nav(async () => undefined, false))).toBe(false)
    expect(canShareFiles(undefined)).toBe(false)
  })
  it('compartilhou / usuário cancelou / Safari pede novo toque / sem suporte', async () => {
    expect(await sharePdf(file, nav(async () => undefined))).toBe('shared')
    expect(await sharePdf(file, nav(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) }))).toBe('cancelled')
    expect(await sharePdf(file, nav(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) }))).toBe('needs_tap')
    expect(await sharePdf(file, nav(async () => undefined, false))).toBe('unsupported')
  })
  it('entrega com os arquivos e o nome certos para a folha nativa (Salvar em Arquivos / WhatsApp)', async () => {
    const share = vi.fn(async () => undefined)
    await sharePdf(file, { canShare: () => true, share } as unknown as Pick<Navigator, 'canShare' | 'share'>)
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0]
    expect(arg.files[0]!.name).toBe('SignOff_PO-1-2026-10-13.pdf')
    expect(arg.files[0]!.type).toBe('application/pdf')
  })
})

describe('download comum', () => {
  it('cria o link de download com o nome do arquivo e limpa depois', () => {
    const created = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() }
    const doc = { createElement: () => created, body: { appendChild: vi.fn() } } as unknown as Document
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    expect(downloadPdf(new File([pdfBytes()], 'SignOff_PO-1-2026-10-13.pdf', { type: 'application/pdf' }), doc)).toBe(true)
    expect(created.download).toBe('SignOff_PO-1-2026-10-13.pdf')
    expect(created.click).toHaveBeenCalled()
    urlSpy.mockRestore()
  })
  it('sem documento (ambiente sem navegador): devolve false', () => {
    expect(downloadPdf(new File([pdfBytes()], 'x.pdf'), undefined)).toBe(false)
  })
})
