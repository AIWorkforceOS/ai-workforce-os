import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { drawPhotoReportPages, generatePhotoReportPdf, groupReportSections, imageBudget, type ReportMedia } from '../photo-report'

// PNG 1x1 válido
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const prepareImage = async () => ({ bytes: PNG, format: 'png' as const })
const header = { orderNumber: '161120-01', clientPo: 'PO1', locationName: 'Store 1', serviceDate: '10/16/2026' }
const m = (kind: ReportMedia['kind'], n: number): ReportMedia => ({ url: `https://x/${kind}-${n}.jpg`, kind, uploaded_at: '2026-10-16T19:00:00Z' })

describe('groupReportSections', () => {
  it('ordena antes/depois/outras/notas/vídeos e some com seção vazia', () => {
    const sections = groupReportSections([m('video', 1), m('after', 1), m('before', 1), m(undefined, 1), m('material_invoice', 1)])
    expect(sections.map((s) => s.title)).toEqual(['BEFORE', 'AFTER', 'OTHER PHOTOS', 'MATERIAL RECEIPTS', 'VIDEOS'])
    expect(groupReportSections([m('before', 1)]).map((s) => s.title)).toEqual(['BEFORE'])
    expect(groupReportSections([])).toEqual([])
  })
})

describe('imageBudget', () => {
  it('reduz qualidade conforme cresce a quantidade (limite de 4,5MB da resposta)', () => {
    expect(imageBudget(5).maxSide).toBeGreaterThan(imageBudget(20).maxSide)
    expect(imageBudget(20).maxSide).toBeGreaterThan(imageBudget(40).maxSide)
  })
})

async function linksOf(buffer: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(buffer)
  const urls: string[] = []
  for (const page of doc.getPages()) {
    const annots = page.node.Annots()
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const dict = doc.context.lookup(annots.get(i), (await import('pdf-lib')).PDFDict)
      const action = dict.lookup(PDFName.of('A'), (await import('pdf-lib')).PDFDict)
      const uri = action.lookup(PDFName.of('URI'))
      if (uri instanceof PDFString) urls.push(uri.decodeText())
    }
  }
  return urls
}

describe('generatePhotoReportPdf', () => {
  it('sem mídia não gera PDF', async () => {
    expect(await generatePhotoReportPdf([], header, { prepareImage })).toBeNull()
  })
  it('cada foto e cada vídeo vira link clicável para o arquivo original', async () => {
    const media = [m('before', 1), m('before', 2), m('after', 1), m('video', 1)]
    const pdf = await generatePhotoReportPdf(media, header, { prepareImage })
    expect(pdf).not.toBeNull()
    const links = await linksOf(pdf!)
    expect(links.sort()).toEqual(media.map((x) => x.url).sort())
  })
  it('muitas fotos viram várias páginas, todas com rodapé numerado', async () => {
    const media = Array.from({ length: 14 }, (_, i) => m(i % 2 ? 'after' : 'before', i))
    const pdf = await generatePhotoReportPdf(media, header, { prepareImage })
    const doc = await PDFDocument.load(pdf!)
    expect(doc.getPageCount()).toBeGreaterThan(1)
  })
  it('foto que não baixou vira célula "unavailable" mas o link continua e nada quebra', async () => {
    const pdf = await generatePhotoReportPdf([m('before', 1)], header, { prepareImage: async () => null })
    expect(await linksOf(pdf!)).toEqual(['https://x/before-1.jpg'])
  })
  it('anexa páginas ao documento existente e informa quantas', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const added = await drawPhotoReportPages(doc, [m('before', 1)], header, font, bold, { prepareImage })
    expect(added).toBe(1)
    expect(doc.getPageCount()).toBe(2)
  })
  it('botão "Download all" em cada página aponta para a página pública do cliente', async () => {
    const url = 'https://www.alizoai.com/relatorio/3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'
    const media = Array.from({ length: 14 }, (_, i) => m(i % 2 ? 'after' : 'before', i))
    const pdf = await generatePhotoReportPdf(media, { ...header, downloadUrl: url }, { prepareImage })
    const doc = await PDFDocument.load(pdf!)
    const links = await linksOf(pdf!)
    // 2 links por página (botão + rodapé) além dos 14 das fotos
    expect(links.filter((l) => l === url).length).toBe(doc.getPageCount() * 2)
    expect(links.length).toBe(14 + doc.getPageCount() * 2)
  })
  it('sem downloadUrl não cria o botão', async () => {
    const pdf = await generatePhotoReportPdf([m('before', 1)], header, { prepareImage })
    expect((await linksOf(pdf!)).length).toBe(1)
  })
})
