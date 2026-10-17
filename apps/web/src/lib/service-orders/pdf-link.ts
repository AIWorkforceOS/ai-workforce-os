import { PDFName, PDFString, type PDFPage } from 'pdf-lib'

/**
 * Link clicável de verdade (anotação PDF, não só texto colorido) — pdf-lib
 * não tem um helper de alto nível pra isso, é o jeito documentado de
 * anexar uma ação de URI numa área da página. context.obj() converte
 * string crua em PDFName, por isso a URI vai como PDFString.
 */
export function addLinkAnnotation(page: PDFPage, url: string, rect: { x: number; y: number; width: number; height: number }) {
  const context = page.doc.context
  const linkDict = context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  })
  const linkRef = context.register(linkDict)
  const existingAnnots = page.node.Annots()
  if (existingAnnots) {
    existingAnnots.push(linkRef)
  } else {
    page.node.set(PDFName.of('Annots'), context.obj([linkRef]))
  }
}
