import type { Invoice } from '@/lib/types'

/**
 * Fatura em aberto (rascunho ou enviada) cujo vencimento já passou —
 * mostrada como "Atrasado" na tela de Operação em vez do status normal.
 * Deriva sempre de due_date/status, sem precisar de um status extra
 * armazenado (nem cron pra mantê-lo em dia).
 */
export function isInvoiceOverdue(invoice: Pick<Invoice, 'status' | 'due_date'>, todayStr: string): boolean {
  return (invoice.status === 'draft' || invoice.status === 'sent') && invoice.due_date !== null && invoice.due_date < todayStr
}
