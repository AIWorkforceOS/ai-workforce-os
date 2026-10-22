export type OrderPhoto = { url: string; kind?: string | null }

export type OrderFilesInput = {
  photos: OrderPhoto[] | null | undefined
  fileUrl: string | null
  fileName: string | null
  status: string | null
  signedAt: string | null
  reportToken: string | null
}

export type OrderFiles = {
  photoCounts: { before: number; after: number; other: number; receipts: number; videos: number }
  photoTotal: number
  /** Sign Off disponível: ordem assinada (concluída ou cotação). */
  hasSignOff: boolean
  hasPhotoReport: boolean
  original: { url: string; name: string } | null
  reportToken: string | null
}

/** Resume o que a ordem tem de relatório e anexos, para o painel do cliente mostrar sem abrir cada ordem. */
export function summarizeOrderFiles(input: OrderFilesInput): OrderFiles {
  const photoCounts = { before: 0, after: 0, other: 0, receipts: 0, videos: 0 }
  for (const p of input.photos ?? []) {
    if (p.kind === 'before') photoCounts.before += 1
    else if (p.kind === 'after') photoCounts.after += 1
    else if (p.kind === 'material_invoice') photoCounts.receipts += 1
    else if (p.kind === 'video') photoCounts.videos += 1
    else photoCounts.other += 1
  }
  const photoTotal = photoCounts.before + photoCounts.after + photoCounts.other + photoCounts.receipts + photoCounts.videos
  return {
    photoCounts,
    photoTotal,
    hasSignOff: Boolean(input.signedAt) && (input.status === 'completed' || input.status === 'quote'),
    hasPhotoReport: photoTotal > 0,
    original: input.fileUrl ? { url: input.fileUrl, name: input.fileName?.trim() || 'Ordem original' } : null,
    reportToken: input.reportToken,
  }
}

export function totalsOf(files: OrderFiles[]): { orders: number; withSignOff: number; withPhotos: number; photos: number } {
  return {
    orders: files.length,
    withSignOff: files.filter((f) => f.hasSignOff).length,
    withPhotos: files.filter((f) => f.hasPhotoReport).length,
    photos: files.reduce((n, f) => n + f.photoTotal, 0),
  }
}
