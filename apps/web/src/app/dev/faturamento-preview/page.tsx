import { notFound } from 'next/navigation'
import { ClientBillingBoard } from '@/components/billing/client-billing-board'
import type { BillingRecord } from '@/lib/billing/by-client'

/** Pré-visualização SOMENTE DE DESENVOLVIMENTO do Faturamento por cliente (dados de exemplo, nenhum banco). Em produção responde 404. */
const rec = (over: Partial<BillingRecord>): BillingRecord => ({ id: Math.random().toString(36).slice(2), serviceDate: '2026-10-05', amount: 120, dueDate: null, invoiceId: null, invoiceNumber: null, invoiceStatus: null, paid: false, clientName: '360 Service Provider', customerName: 'Loja', orderNumber: '160936-01', locationName: 'Dollar Tree', description: null, ...over })

export default function FaturamentoPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const records = [
    rec({ serviceDate: '2026-10-03', amount: 180, dueDate: '2026-10-18', orderNumber: '159636-01', locationName: 'Walgreens Camelback' }),
    rec({ serviceDate: '2026-10-06', amount: 95.5, dueDate: '2026-10-21', orderNumber: '160783-01', locationName: 'Saatva Scottsdale' }),
    rec({ serviceDate: '2026-10-07', amount: 240, dueDate: '2026-10-22', orderNumber: '161508-01', locationName: 'Banana Republic' }),
    rec({ serviceDate: '2026-10-08', amount: 310, invoiceId: 'i1', invoiceNumber: 'INV-0009', invoiceStatus: 'sent', dueDate: '2026-10-23' }),
    rec({ serviceDate: '2026-10-09', amount: 75, invoiceId: 'i2', invoiceNumber: 'INV-0008', paid: true, dueDate: '2026-10-12' }),
    rec({ clientName: 'Acme Facility Group', serviceDate: '2026-10-10', amount: 500, dueDate: '2026-10-21', orderNumber: 'AF-77', locationName: 'Acme Austin' }),
    rec({ clientName: 'Acme Facility Group', serviceDate: '2026-10-12', amount: 260, orderNumber: 'AF-78', locationName: 'Acme Dallas' }),
  ]
  return (
    <div className="mx-auto max-w-6xl p-4">
      <ClientBillingBoard unitId="u1" currency="USD" today="2026-10-21" monthLabel="outubro de 2026" initialRecords={records} initialReminderRecords={records} terms={{ 'acme facility group': 45, '360 service provider': 15 }} operationHref="#" />
    </div>
  )
}
