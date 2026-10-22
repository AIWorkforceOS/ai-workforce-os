export const LEAD_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024

/** Tipos aceitos (os mesmos do bucket privado lead-attachments, migration 106). */
export const LEAD_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

export const LEAD_ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx'

export function safeAttachmentName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, '_').replace(/^[._]+|_+$/g, '').slice(0, 100)
  return cleaned || 'arquivo'
}

/** Caminho no bucket: {unidade}/{lead}/{id}-{nome} — o primeiro nível é a unidade (a regra de acesso do banco usa isso). */
export function leadAttachmentPath(unitId: string, leadId: string, id: string, fileName: string): string {
  return `${unitId}/${leadId}/${id}-${safeAttachmentName(fileName)}`
}

export function validateAttachmentFile(file: { name: string; size: number; type: string }): string | null {
  if (file.size <= 0) return `${file.name}: arquivo vazio.`
  if (file.size > LEAD_ATTACHMENT_MAX_BYTES) return `${file.name}: passa de 15MB.`
  if (!(LEAD_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return `${file.name}: tipo não aceito (use PDF, imagem, Word, Excel, CSV ou TXT).`
  return null
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
