'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeSuggestedPay } from '@/lib/service-pay'
import { normalizeServiceRecurrence, projectedMonthlyRevenue } from '@/lib/scheduling/service-recurrence'
import {
  FormSection,
  Input,
  Label,
  SectionLabel,
  Select,
  StatusPill,
  TableShell,
  Td,
  Th,
  Tr,
  Textarea,
} from '@/components/ui/dashboard-ui'
import type { Customer, Employee, Invoice, Service, ServiceRecord } from '@/lib/types'

const SERVICE_RECURRENCE_LABEL: Record<string, string> = {
  once: 'Único',
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  custom: 'Personalizado',
}

// Painel da tela Operação (migration 030): duas seções irmãs no mesmo
// client component porque uma ação cruza as duas — "Gerar fatura" a
// partir de um serviço executado precisa aparecer na lista de faturas
// logo abaixo sem recarregar a página.

export type ServiceRecordWithRelations = ServiceRecord & {
  employee: Pick<Employee, 'id' | 'name'> | null
  customer: Pick<Customer, 'id' | 'name' | 'email'> | null
  service: Pick<Service, 'id' | 'name'> | null
}

export type InvoiceWithRelations = Invoice & {
  customer: Pick<Customer, 'id' | 'name' | 'email'> | null
}

type CustomerOption = Pick<Customer, 'id' | 'name' | 'email' | 'address' | 'custom_fields'>

type RecordFormState = {
  service_date: string
  employee_id: string
  customer_id: string
  service_id: string
  description: string
  amount_charged: string
  amount_due: string
}

type InvoiceFormState = {
  customer_id: string
  description: string
  amount: string
  due_date: string
  notes: string
}

const INVOICE_STATUS_LABEL: Record<Invoice['status'], string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  paid: 'Paga',
  cancelled: 'Cancelada',
}

const INVOICE_STATUS_VARIANT: Record<Invoice['status'], 'slate' | 'cyan' | 'green' | 'red'> = {
  draft: 'slate',
  sent: 'cyan',
  paid: 'green',
  cancelled: 'red',
}

/** Hoje no fuso da unidade, como 'YYYY-MM-DD' (en-CA formata exatamente assim). */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

export function ServiceOperationsPanel({
  unitId,
  orgId,
  timezone,
  currency,
  employees,
  services,
  customers,
  initialRecords,
  initialInvoices,
}: {
  unitId: string
  orgId: string
  timezone: string
  /** BRL | USD, derivada do idioma da unidade */
  currency: string
  employees: Employee[]
  services: Service[]
  customers: CustomerOption[]
  initialRecords: ServiceRecordWithRelations[]
  initialInvoices: InvoiceWithRelations[]
}) {
  const intlLocale = currency === 'USD' ? 'en-US' : 'pt-BR'
  const fmtMoney = (value: number | null) =>
    value === null ? '—' : value.toLocaleString(intlLocale, { style: 'currency', currency })

  const [records, setRecords] = useState<ServiceRecordWithRelations[]>(initialRecords)
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>(initialInvoices)

  // -------------------------------------------------------------------
  // Serviços executados
  // -------------------------------------------------------------------
  const emptyRecordForm: RecordFormState = {
    service_date: todayInTimezone(timezone),
    employee_id: employees[0]?.id ?? '',
    customer_id: '',
    service_id: '',
    description: '',
    amount_charged: '',
    amount_due: '',
  }
  const [recordForm, setRecordForm] = useState<RecordFormState>(emptyRecordForm)
  /** true depois que o usuário mexeu manualmente no valor a pagar — a sugestão automática para de sobrescrever */
  const [amountDueTouched, setAmountDueTouched] = useState(false)
  const [recordBusy, setRecordBusy] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [recordRowBusyId, setRecordRowBusyId] = useState<string | null>(null)
  const [recordRowError, setRecordRowError] = useState<string | null>(null)

  function applyRecordChange(next: Partial<RecordFormState>, touchedDue = amountDueTouched) {
    setRecordForm((prev) => {
      const merged = { ...prev, ...next }
      if (!touchedDue) {
        const employee = employees.find((e) => e.id === merged.employee_id) ?? null
        const service = services.find((s) => s.id === merged.service_id) ?? null
        const suggestion = computeSuggestedPay({
          employee,
          amountCharged: merged.amount_charged.trim() === '' ? null : Number(merged.amount_charged),
          durationMinutes: service?.duration_minutes ?? null,
        })
        merged.amount_due = suggestion === null ? '' : String(suggestion)
      }
      return merged
    })
  }

  function handleServiceChange(serviceId: string) {
    const service = services.find((s) => s.id === serviceId) ?? null
    // preço do serviço vira o valor cobrado sugerido (também editável)
    const nextCharged =
      recordForm.amount_charged.trim() === '' && service?.price != null
        ? String(service.price)
        : recordForm.amount_charged
    applyRecordChange({ service_id: serviceId, amount_charged: nextCharged })
  }

  async function handleRecordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRecordError(null)
    if (!recordForm.employee_id) {
      setRecordError('Escolha o profissional que executou o serviço.')
      return
    }
    setRecordBusy(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('service_records')
      .insert({
        org_id: orgId,
        unit_id: unitId,
        employee_id: recordForm.employee_id,
        customer_id: recordForm.customer_id || null,
        service_id: recordForm.service_id || null,
        service_date: recordForm.service_date,
        description: recordForm.description.trim() || null,
        amount_charged: recordForm.amount_charged.trim() === '' ? null : Number(recordForm.amount_charged),
        amount_due: recordForm.amount_due.trim() === '' ? null : Number(recordForm.amount_due),
      })
      .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
      .single()
    setRecordBusy(false)
    if (error || !data) {
      setRecordError('Não foi possível lançar o serviço.')
      return
    }
    setRecords((prev) => [data as unknown as ServiceRecordWithRelations, ...prev])
    setRecordForm(emptyRecordForm)
    setAmountDueTouched(false)
  }

  async function handleRecordPayment(record: ServiceRecordWithRelations, paid: boolean) {
    setRecordRowError(null)
    setRecordRowBusyId(record.id)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('service_records')
      .update({ payment_status: paid ? 'paid' : 'pending', paid_at: paid ? new Date().toISOString() : null })
      .eq('id', record.id)
      .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
      .single()
    setRecordRowBusyId(null)
    if (error || !data) {
      setRecordRowError('Não foi possível atualizar o pagamento.')
      return
    }
    setRecords((prev) => prev.map((r) => (r.id === record.id ? (data as unknown as ServiceRecordWithRelations) : r)))
  }

  async function handleRecordDelete(record: ServiceRecordWithRelations) {
    if (!window.confirm('Excluir este lançamento de serviço?')) return
    setRecordRowError(null)
    setRecordRowBusyId(record.id)
    const supabase = createClient()
    const { error } = await supabase.from('service_records').delete().eq('id', record.id)
    setRecordRowBusyId(null)
    if (error) {
      setRecordRowError('Não foi possível excluir o lançamento.')
      return
    }
    setRecords((prev) => prev.filter((r) => r.id !== record.id))
  }

  const totals = useMemo(() => {
    const pendingDue = records
      .filter((r) => r.payment_status === 'pending' && r.amount_due !== null)
      .reduce((sum, r) => sum + Number(r.amount_due), 0)
    const paidDue = records
      .filter((r) => r.payment_status === 'paid' && r.amount_due !== null)
      .reduce((sum, r) => sum + Number(r.amount_due), 0)
    const charged = records.filter((r) => r.amount_charged !== null).reduce((sum, r) => sum + Number(r.amount_charged), 0)

    const byEmployee = new Map<string, number>()
    for (const r of records) {
      if (r.payment_status !== 'pending' || r.amount_due === null) continue
      const name = r.employee?.name ?? 'Sem profissional'
      byEmployee.set(name, (byEmployee.get(name) ?? 0) + Number(r.amount_due))
    }
    return { pendingDue, paidDue, charged, byEmployee: [...byEmployee.entries()].sort((a, b) => b[1] - a[1]) }
  }, [records])

  // -------------------------------------------------------------------
  // A receber (projetado) — direto do cadastro do cliente, não depende de
  // agendamento nem de lançamento manual: valor da visita × frequência
  // mensal da recorrência (ver lib/scheduling/service-recurrence).
  // -------------------------------------------------------------------
  const recurringCustomers = useMemo(() => {
    return customers
      .map((c) => {
        const cf = (c.custom_fields ?? {}) as { service_value?: unknown; service_recurrence?: unknown; service_type?: unknown }
        const rawValue = Number(cf.service_value)
        const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : null
        const recurrence = normalizeServiceRecurrence(cf.service_recurrence)
        const monthly = projectedMonthlyRevenue(value, recurrence)
        return {
          id: c.id,
          name: c.name,
          serviceType: typeof cf.service_type === 'string' ? cf.service_type : null,
          value,
          recurrence,
          monthly,
        }
      })
      .filter((c) => c.monthly > 0)
      .sort((a, b) => b.monthly - a.monthly)
  }, [customers])

  const projectedReceivable = useMemo(
    () => recurringCustomers.reduce((sum, c) => sum + c.monthly, 0),
    [recurringCustomers]
  )

  const receivedThisMonth = useMemo(() => {
    const now = new Date()
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    return invoices
      .filter((i) => i.status === 'paid' && i.paid_at && i.paid_at.slice(0, 7) === monthKey)
      .reduce((sum, i) => sum + Number(i.amount), 0)
  }, [invoices])

  // -------------------------------------------------------------------
  // Faturas
  // -------------------------------------------------------------------
  const emptyInvoiceForm: InvoiceFormState = { customer_id: '', description: '', amount: '', due_date: '', notes: '' }
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(emptyInvoiceForm)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [invoiceRowBusyId, setInvoiceRowBusyId] = useState<string | null>(null)
  const [invoiceRowError, setInvoiceRowError] = useState<string | null>(null)

  /**
   * Número sequencial por unidade (INV-0001, INV-0002…). Lê os últimos
   * números direto do banco na hora de criar; corrida entre duas pessoas
   * é resolvida pelo índice único (unit_id, invoice_number) + retry.
   */
  async function insertInvoice(payload: {
    customer_id: string
    service_record_id: string | null
    description: string
    amount: number
    due_date: string | null
    notes: string | null
  }): Promise<{ invoice?: InvoiceWithRelations; error?: string }> {
    const supabase = createClient()
    const { data: existing } = await supabase
      .from('invoices')
      .select('invoice_number')
      .eq('unit_id', unitId)
      .order('created_at', { ascending: false })
      .limit(100)
    let next =
      ((existing ?? []) as { invoice_number: string }[])
        .map((row) => Number(/^INV-(\d+)$/.exec(row.invoice_number)?.[1] ?? 0))
        .reduce((max, n) => Math.max(max, n), 0) + 1

    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase
        .from('invoices')
        .insert({
          org_id: orgId,
          unit_id: unitId,
          invoice_number: `INV-${String(next).padStart(4, '0')}`,
          currency,
          ...payload,
        })
        .select('*, customer:customers(id,name,email)')
        .single()
      if (!error && data) return { invoice: data as unknown as InvoiceWithRelations }
      if (error?.code !== '23505') return { error: 'Não foi possível criar a fatura.' }
      next += 1 // número já usado por outra sessão — tenta o seguinte
    }
    return { error: 'Não foi possível gerar um número de fatura. Tente de novo.' }
  }

  async function handleInvoiceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setInvoiceError(null)
    if (!invoiceForm.customer_id) {
      setInvoiceError('Escolha o cliente da fatura.')
      return
    }
    if (invoiceForm.amount.trim() === '' || Number(invoiceForm.amount) <= 0) {
      setInvoiceError('Informe o valor da fatura.')
      return
    }
    setInvoiceBusy(true)
    const result = await insertInvoice({
      customer_id: invoiceForm.customer_id,
      service_record_id: null,
      description: invoiceForm.description.trim() || 'Serviço prestado',
      amount: Number(invoiceForm.amount),
      due_date: invoiceForm.due_date || null,
      notes: invoiceForm.notes.trim() || null,
    })
    setInvoiceBusy(false)
    if (!result.invoice) {
      setInvoiceError(result.error ?? 'Não foi possível criar a fatura.')
      return
    }
    setInvoices((prev) => [result.invoice!, ...prev])
    setInvoiceForm(emptyInvoiceForm)
  }

  async function handleGenerateInvoiceFromRecord(record: ServiceRecordWithRelations) {
    setRecordRowError(null)
    if (!record.customer?.id) {
      setRecordRowError('Este lançamento não tem cliente — informe o cliente para gerar a fatura.')
      return
    }
    if (record.amount_charged === null) {
      setRecordRowError('Este lançamento não tem valor cobrado — informe o valor para gerar a fatura.')
      return
    }
    setRecordRowBusyId(record.id)
    const result = await insertInvoice({
      customer_id: record.customer.id,
      service_record_id: record.id,
      description: `${record.service?.name ?? record.description ?? 'Serviço prestado'} — ${formatDate(record.service_date)}`,
      amount: Number(record.amount_charged),
      due_date: null,
      notes: null,
    })
    setRecordRowBusyId(null)
    if (!result.invoice) {
      setRecordRowError(result.error ?? 'Não foi possível gerar a fatura.')
      return
    }
    setInvoices((prev) => [result.invoice!, ...prev])
  }

  async function handleSendInvoice(invoice: InvoiceWithRelations) {
    setInvoiceRowError(null)
    setInvoiceRowBusyId(invoice.id)
    try {
      const response = await fetch(`/api/units/${unitId}/invoices/${invoice.id}/send`, { method: 'POST' })
      const body = (await response.json().catch(() => null)) as { invoice?: Invoice; error?: string } | null
      if (!response.ok || !body?.invoice) {
        setInvoiceRowError(body?.error ?? 'Não foi possível enviar a fatura.')
        return
      }
      setInvoices((prev) =>
        prev.map((i) => (i.id === invoice.id ? { ...i, ...body.invoice } : i))
      )
    } catch {
      setInvoiceRowError('Não foi possível enviar a fatura.')
    } finally {
      setInvoiceRowBusyId(null)
    }
  }

  async function handleInvoiceStatus(invoice: InvoiceWithRelations, status: Invoice['status']) {
    if (status === 'cancelled' && !window.confirm(`Cancelar a fatura ${invoice.invoice_number}?`)) return
    setInvoiceRowError(null)
    setInvoiceRowBusyId(invoice.id)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('invoices')
      .update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null })
      .eq('id', invoice.id)
      .select('*, customer:customers(id,name,email)')
      .single()
    setInvoiceRowBusyId(null)
    if (error || !data) {
      setInvoiceRowError('Não foi possível atualizar a fatura.')
      return
    }
    setInvoices((prev) => prev.map((i) => (i.id === invoice.id ? (data as unknown as InvoiceWithRelations) : i)))
  }

  // -------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-8">
      {/* Resumo — as 4 categorias do financeiro: projetado (a receber) e
          realizado (recebido) de um lado, equipe (a pagar/pago) do outro.
          Alimentado automaticamente pelo cadastro do cliente e pela agenda,
          sem depender de lançamento manual. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'A receber (projetado este mês)', value: fmtMoney(projectedReceivable), sub: 'clientes recorrentes cadastrados' },
          { label: 'Recebido (este mês)', value: fmtMoney(receivedThisMonth), sub: 'faturas pagas' },
          { label: 'A pagar à equipe', value: fmtMoney(totals.pendingDue), sub: 'serviços pendentes' },
          { label: 'Pago à equipe', value: fmtMoney(totals.paidDue), sub: 'já quitado' },
        ].map(({ label, value, sub }) => (
          <div
            key={label}
            className="rounded-2xl bg-[#141a2b] p-4"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-black tracking-tight text-white">{value}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
          </div>
        ))}
      </div>

      {/* Clientes recorrentes — projeção automática, direto do cadastro */}
      {recurringCustomers.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Clientes recorrentes (a receber)</SectionLabel>
          <div
            className="overflow-hidden rounded-2xl bg-[#141a2b]"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <TableShell>
                  <Th>Cliente</Th>
                  <Th>Serviço</Th>
                  <Th>Valor da visita</Th>
                  <Th>Recorrência</Th>
                  <Th>Projeção mensal</Th>
                </TableShell>
                <tbody>
                  {recurringCustomers.map((c) => (
                    <Tr key={c.id}>
                      <Td className="font-semibold text-white">{c.name}</Td>
                      <Td className="text-slate-400">{c.serviceType ?? '—'}</Td>
                      <Td className="text-slate-300">{fmtMoney(c.value)}</Td>
                      <Td className="text-slate-400">
                        {SERVICE_RECURRENCE_LABEL[c.recurrence.type]}
                        {c.recurrence.type === 'custom' && c.recurrence.days
                          ? ` (${c.recurrence.days.length}x/semana)`
                          : ''}
                      </Td>
                      <Td className="font-black text-white">{fmtMoney(c.monthly)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Projeção automática a partir do valor e da recorrência cadastrados no cliente — some se o cliente
            for marcado como serviço único ou ficar sem valor.
          </p>
        </div>
      )}

      {/* Serviços executados */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Serviços executados</SectionLabel>

        {totals.byEmployee.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {totals.byEmployee.map(([name, amount]) => (
              <span
                key={name}
                className="rounded-lg px-2.5 py-1 text-[11px] font-bold text-amber-300"
                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                {name}: {fmtMoney(amount)} pendente
              </span>
            ))}
          </div>
        )}

        <form onSubmit={handleRecordSubmit}>
          <FormSection title="Lançar serviço executado">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recordDate">Data *</Label>
                <Input
                  id="recordDate"
                  type="date"
                  required
                  value={recordForm.service_date}
                  onChange={(e) => applyRecordChange({ service_date: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recordEmployee">Profissional *</Label>
                <Select
                  id="recordEmployee"
                  required
                  value={recordForm.employee_id}
                  onChange={(e) => applyRecordChange({ employee_id: e.target.value })}
                >
                  <option value="">Selecionar…</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                      {emp.specialty ? ` — ${emp.specialty}` : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recordCustomer">Cliente</Label>
                <Select
                  id="recordCustomer"
                  value={recordForm.customer_id}
                  onChange={(e) => applyRecordChange({ customer_id: e.target.value })}
                >
                  <option value="">Sem cliente</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recordService">Serviço</Label>
                <Select id="recordService" value={recordForm.service_id} onChange={(e) => handleServiceChange(e.target.value)}>
                  <option value="">Outro / avulso</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recordCharged">Valor cobrado do cliente</Label>
                <Input
                  id="recordCharged"
                  type="number"
                  min={0}
                  step="0.01"
                  value={recordForm.amount_charged}
                  onChange={(e) => applyRecordChange({ amount_charged: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="recordDue">Valor a pagar ao profissional</Label>
                <Input
                  id="recordDue"
                  type="number"
                  min={0}
                  step="0.01"
                  value={recordForm.amount_due}
                  onChange={(e) => {
                    setAmountDueTouched(true)
                    applyRecordChange({ amount_due: e.target.value }, true)
                  }}
                  placeholder="Sugerido pelo padrão do profissional"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recordDescription">Descrição</Label>
              <Input
                id="recordDescription"
                value={recordForm.description}
                onChange={(e) => applyRecordChange({ description: e.target.value })}
                placeholder="Ex.: Deep clean — casa de 3 quartos"
              />
            </div>

            {recordError && <p className="text-sm text-red-400">{recordError}</p>}

            <button
              type="submit"
              disabled={recordBusy}
              className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {recordBusy ? 'Lançando…' : 'Lançar serviço'}
            </button>
          </FormSection>
        </form>

        {recordRowError && <p className="text-sm text-red-400">{recordRowError}</p>}

        {records.length > 0 && (
          <div
            className="overflow-hidden rounded-2xl bg-[#141a2b]"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <TableShell>
                  <Th>Data</Th>
                  <Th>Profissional</Th>
                  <Th>Cliente / Serviço</Th>
                  <Th>Cobrado</Th>
                  <Th>A pagar</Th>
                  <Th>Pagamento</Th>
                  <Th>Ações</Th>
                </TableShell>
                <tbody>
                  {records.map((record) => (
                    <Tr key={record.id}>
                      <Td className="text-slate-400">{formatDate(record.service_date)}</Td>
                      <Td className="font-semibold text-white">{record.employee?.name ?? '—'}</Td>
                      <Td>
                        <p className="font-medium text-slate-300">{record.customer?.name ?? '—'}</p>
                        <p className="text-[11px] text-slate-500">
                          {record.service?.name ?? record.description ?? ''}
                        </p>
                      </Td>
                      <Td className="text-slate-300">{fmtMoney(record.amount_charged === null ? null : Number(record.amount_charged))}</Td>
                      <Td className="text-slate-300">{fmtMoney(record.amount_due === null ? null : Number(record.amount_due))}</Td>
                      <Td>
                        <StatusPill variant={record.payment_status === 'paid' ? 'green' : 'amber'}>
                          {record.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                        </StatusPill>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-3 text-xs font-semibold">
                          {record.payment_status === 'pending' ? (
                            <button
                              type="button"
                              disabled={recordRowBusyId === record.id}
                              className="text-green-400 hover:text-green-300 disabled:opacity-40"
                              onClick={() => handleRecordPayment(record, true)}
                            >
                              Marcar pago
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={recordRowBusyId === record.id}
                              className="text-amber-400 hover:text-amber-300 disabled:opacity-40"
                              onClick={() => handleRecordPayment(record, false)}
                            >
                              Reabrir
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={recordRowBusyId === record.id}
                            className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                            onClick={() => handleGenerateInvoiceFromRecord(record)}
                          >
                            Gerar fatura
                          </button>
                          <button
                            type="button"
                            disabled={recordRowBusyId === record.id}
                            className="text-red-400 hover:text-red-300 disabled:opacity-40"
                            onClick={() => handleRecordDelete(record)}
                          >
                            Excluir
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Faturas */}
      <div className="flex flex-col gap-3">
        <SectionLabel>Faturas para clientes</SectionLabel>

        <form onSubmit={handleInvoiceSubmit}>
          <FormSection title="Nova fatura">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invoiceCustomer">Cliente *</Label>
                <Select
                  id="invoiceCustomer"
                  required
                  value={invoiceForm.customer_id}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, customer_id: e.target.value }))}
                >
                  <option value="">Selecionar…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.email ? '' : ' (sem e-mail)'}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invoiceDescription">Descrição *</Label>
                <Input
                  id="invoiceDescription"
                  required
                  value={invoiceForm.description}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ex.: Limpeza residencial — julho"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invoiceAmount">Valor *</Label>
                <Input
                  id="invoiceAmount"
                  type="number"
                  required
                  min={0.01}
                  step="0.01"
                  value={invoiceForm.amount}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="invoiceDue">Vencimento</Label>
                <Input
                  id="invoiceDue"
                  type="date"
                  value={invoiceForm.due_date}
                  onChange={(e) => setInvoiceForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invoiceNotes">Instruções de pagamento (vão no e-mail)</Label>
              <Textarea
                id="invoiceNotes"
                rows={2}
                value={invoiceForm.notes}
                onChange={(e) => setInvoiceForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Ex.: Zelle para pay@suaempresa.com · PIX chave 000.000.000-00"
              />
            </div>

            {invoiceError && <p className="text-sm text-red-400">{invoiceError}</p>}

            <button
              type="submit"
              disabled={invoiceBusy}
              className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
            >
              {invoiceBusy ? 'Criando…' : 'Criar fatura'}
            </button>
          </FormSection>
        </form>

        {invoiceRowError && <p className="text-sm text-red-400">{invoiceRowError}</p>}

        {invoices.length > 0 && (
          <div
            className="overflow-hidden rounded-2xl bg-[#141a2b]"
            style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <TableShell>
                  <Th>Número</Th>
                  <Th>Cliente</Th>
                  <Th>Descrição</Th>
                  <Th>Valor</Th>
                  <Th>Vencimento</Th>
                  <Th>Status</Th>
                  <Th>Ações</Th>
                </TableShell>
                <tbody>
                  {invoices.map((invoice) => (
                    <Tr key={invoice.id}>
                      <Td className="font-semibold text-white">{invoice.invoice_number}</Td>
                      <Td>
                        <p className="font-medium text-slate-300">{invoice.customer?.name ?? '—'}</p>
                        <p className="text-[11px] text-slate-500">{invoice.sent_to_email ?? invoice.customer?.email ?? 'sem e-mail'}</p>
                      </Td>
                      <Td className="text-slate-400">{invoice.description}</Td>
                      <Td className="font-black text-white">{fmtMoney(Number(invoice.amount))}</Td>
                      <Td className="text-slate-400">{invoice.due_date ? formatDate(invoice.due_date) : '—'}</Td>
                      <Td>
                        <StatusPill variant={INVOICE_STATUS_VARIANT[invoice.status]}>
                          {INVOICE_STATUS_LABEL[invoice.status]}
                        </StatusPill>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-3 text-xs font-semibold">
                          {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
                            <button
                              type="button"
                              disabled={invoiceRowBusyId === invoice.id}
                              className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                              onClick={() => handleSendInvoice(invoice)}
                            >
                              {invoiceRowBusyId === invoice.id
                                ? 'Enviando…'
                                : invoice.status === 'sent'
                                  ? 'Reenviar e-mail'
                                  : 'Enviar por e-mail'}
                            </button>
                          )}
                          {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                            <button
                              type="button"
                              disabled={invoiceRowBusyId === invoice.id}
                              className="text-green-400 hover:text-green-300 disabled:opacity-40"
                              onClick={() => handleInvoiceStatus(invoice, 'paid')}
                            >
                              Marcar paga
                            </button>
                          )}
                          {invoice.status === 'paid' && (
                            <button
                              type="button"
                              disabled={invoiceRowBusyId === invoice.id}
                              className="text-amber-400 hover:text-amber-300 disabled:opacity-40"
                              onClick={() => handleInvoiceStatus(invoice, invoice.sent_at ? 'sent' : 'draft')}
                            >
                              Reabrir
                            </button>
                          )}
                          {invoice.status !== 'cancelled' && invoice.status !== 'paid' && (
                            <button
                              type="button"
                              disabled={invoiceRowBusyId === invoice.id}
                              className="text-red-400 hover:text-red-300 disabled:opacity-40"
                              onClick={() => handleInvoiceStatus(invoice, 'cancelled')}
                            >
                              Cancelar
                            </button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
