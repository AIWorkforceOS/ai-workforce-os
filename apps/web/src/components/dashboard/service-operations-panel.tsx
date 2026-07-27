'use client'

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeSuggestedPay } from '@/lib/service-pay'
import { normalizeServiceRecurrence, projectedMonthlyRevenue } from '@/lib/scheduling/service-recurrence'
import {
  brandGradient,
  cardShadow,
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
import type { Customer, Employee, Invoice, Service, ServiceRecord, Unit } from '@/lib/types'

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
  customer: Pick<Customer, 'id' | 'name' | 'email' | 'phone'> | null
}

type CustomerOption = Pick<Customer, 'id' | 'name' | 'email' | 'phone' | 'address' | 'custom_fields'>

type RecordFormState = {
  service_date: string
  employee_id: string
  customer_id: string
  service_id: string
  description: string
  amount_charged: string
  amount_due: string
}

type RecordEditFormState = RecordFormState

type InvoiceFormState = {
  customer_id: string
  description: string
  amount: string
  due_date: string
  notes: string
}

type InvoiceEditFormState = {
  description: string
  amount: string
  due_date: string
}

const INVOICE_STATUS_LABEL: Record<Invoice['status'], string> = {
  draft: 'Rascunho',
  sent: 'Enviada',
  paid: 'Paga',
  cancelled: 'Cancelada',
  consolidated: 'Consolidada',
}

const INVOICE_STATUS_VARIANT: Record<Invoice['status'], 'slate' | 'cyan' | 'green' | 'red' | 'purple'> = {
  draft: 'slate',
  sent: 'cyan',
  paid: 'green',
  cancelled: 'red',
  consolidated: 'purple',
}

/**
 * Uma vez paga ou substituída por uma consolidada, a fatura não pode mais
 * ser editada (histórico financeiro travado). Cancelada também não edita
 * direto — primeiro precisa "Reativar" (volta pra draft), pra não deixar
 * uma fatura cancelada com valor alterado sem nenhum caminho de reenvio.
 */
function isInvoiceEditable(status: Invoice['status']): boolean {
  return status !== 'paid' && status !== 'consolidated' && status !== 'cancelled'
}

/** Hoje no fuso da unidade, como 'YYYY-MM-DD' (en-CA formata exatamente assim). */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${day}/${month}/${year}`
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024

export type BillingIdentity = Pick<
  Unit,
  | 'billing_company_name'
  | 'billing_address'
  | 'billing_email'
  | 'billing_phone'
  | 'billing_payment_instructions'
  | 'logo_url'
>

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
  initialBilling,
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
  initialBilling: BillingIdentity
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

  /** Desvincula a fatura do lançamento (invoice_id volta a null) sem alterar a fatura já gerada — o registro reaparece em "Faturar serviços pendentes" e pode ser faturado de novo. */
  async function handleUnlinkInvoice(record: ServiceRecordWithRelations) {
    setRecordRowError(null)
    setRecordRowBusyId(record.id)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('service_records')
      .update({ invoice_id: null })
      .eq('id', record.id)
      .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
      .single()
    setRecordRowBusyId(null)
    if (error || !data) {
      setRecordRowError('Não foi possível desvincular a fatura.')
      return
    }
    setRecords((prev) => prev.map((r) => (r.id === record.id ? (data as unknown as ServiceRecordWithRelations) : r)))
  }

  // Edição de um lançamento de serviço (data/profissional/cliente/serviço/
  // descrição/valores) — sempre disponível, independente de pago ou
  // faturado, mesmo padrão de edição inline usado nas faturas.
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [recordEditForm, setRecordEditForm] = useState<RecordEditFormState>(emptyRecordForm)
  const [recordEditBusy, setRecordEditBusy] = useState(false)
  const [recordEditError, setRecordEditError] = useState<string | null>(null)

  function handleStartEditRecord(record: ServiceRecordWithRelations) {
    setRecordEditError(null)
    setEditingRecordId(record.id)
    setRecordEditForm({
      service_date: record.service_date,
      employee_id: record.employee_id ?? '',
      customer_id: record.customer_id ?? '',
      service_id: record.service_id ?? '',
      description: record.description ?? '',
      amount_charged: record.amount_charged === null ? '' : String(record.amount_charged),
      amount_due: record.amount_due === null ? '' : String(record.amount_due),
    })
  }

  function handleCancelEditRecord() {
    setEditingRecordId(null)
    setRecordEditError(null)
  }

  async function handleSaveEditRecord(record: ServiceRecordWithRelations) {
    setRecordEditError(null)
    if (!recordEditForm.employee_id) {
      setRecordEditError('Escolha o profissional que executou o serviço.')
      return
    }
    setRecordEditBusy(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('service_records')
      .update({
        service_date: recordEditForm.service_date,
        employee_id: recordEditForm.employee_id,
        customer_id: recordEditForm.customer_id || null,
        service_id: recordEditForm.service_id || null,
        description: recordEditForm.description.trim() || null,
        amount_charged: recordEditForm.amount_charged.trim() === '' ? null : Number(recordEditForm.amount_charged),
        amount_due: recordEditForm.amount_due.trim() === '' ? null : Number(recordEditForm.amount_due),
      })
      .eq('id', record.id)
      .select('*, employee:employees(id,name), customer:customers(id,name,email), service:services(id,name)')
      .single()
    setRecordEditBusy(false)
    if (error || !data) {
      setRecordEditError('Não foi possível salvar as alterações.')
      return
    }
    setRecords((prev) => prev.map((r) => (r.id === record.id ? (data as unknown as ServiceRecordWithRelations) : r)))
    setEditingRecordId(null)
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
  // Dados de cobrança — quem está cobrando, para aparecer na fatura em
  // PDF (migration 048). Os dados do cliente cobrado já vêm do cadastro
  // dele; aqui é só o lado da empresa.
  // -------------------------------------------------------------------
  type BillingFormState = {
    billing_company_name: string
    billing_address: string
    billing_email: string
    billing_phone: string
    billing_payment_instructions: string
  }
  const [billingForm, setBillingForm] = useState<BillingFormState>({
    billing_company_name: initialBilling.billing_company_name ?? '',
    billing_address: initialBilling.billing_address ?? '',
    billing_email: initialBilling.billing_email ?? '',
    billing_phone: initialBilling.billing_phone ?? '',
    billing_payment_instructions: initialBilling.billing_payment_instructions ?? '',
  })
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)
  const [billingSaved, setBillingSaved] = useState(false)

  const [billingLogoUrl, setBillingLogoUrl] = useState(initialBilling.logo_url ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLogoError(null)

    if (!file.type.startsWith('image/')) {
      setLogoError('Envie um arquivo de imagem (PNG ou JPG — SVG não aparece na fatura em PDF).')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError('A imagem deve ter no máximo 2MB.')
      return
    }

    setLogoUploading(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${unitId}/logo-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('unit-logos')
      .upload(path, file, { upsert: true, contentType: file.type })

    setLogoUploading(false)

    if (uploadError) {
      setLogoError('Não foi possível enviar a imagem.')
      return
    }

    const { data } = supabase.storage.from('unit-logos').getPublicUrl(path)
    setBillingLogoUrl(data.publicUrl)
  }

  async function handleSaveBilling() {
    setBillingError(null)
    setBillingSaved(false)
    setBillingBusy(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('units')
      .update({
        billing_company_name: billingForm.billing_company_name.trim() || null,
        billing_address: billingForm.billing_address.trim() || null,
        billing_email: billingForm.billing_email.trim() || null,
        billing_phone: billingForm.billing_phone.trim() || null,
        billing_payment_instructions: billingForm.billing_payment_instructions.trim() || null,
        logo_url: billingLogoUrl || null,
      })
      .eq('id', unitId)
    setBillingBusy(false)
    if (error) {
      setBillingError('Não foi possível salvar os dados de cobrança.')
      return
    }
    setBillingSaved(true)
  }

  // -------------------------------------------------------------------
  // Faturas
  // -------------------------------------------------------------------
  const emptyInvoiceForm: InvoiceFormState = { customer_id: '', description: '', amount: '', due_date: '', notes: '' }
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(emptyInvoiceForm)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [invoiceRowBusyId, setInvoiceRowBusyId] = useState<string | null>(null)
  const [invoiceRowError, setInvoiceRowError] = useState<string | null>(null)

  // Edição de fatura (valor/descrição/vencimento) enquanto não estiver paga.
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<InvoiceEditFormState>({ description: '', amount: '', due_date: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  function handleStartEdit(invoice: InvoiceWithRelations) {
    setEditError(null)
    setEditingInvoiceId(invoice.id)
    setEditForm({
      description: invoice.description,
      amount: String(invoice.amount),
      due_date: invoice.due_date ?? '',
    })
  }

  function handleCancelEdit() {
    setEditingInvoiceId(null)
    setEditError(null)
  }

  async function handleSaveEdit(invoice: InvoiceWithRelations) {
    setEditError(null)
    if (editForm.description.trim() === '') {
      setEditError('Informe a descrição da fatura.')
      return
    }
    if (editForm.amount.trim() === '' || Number(editForm.amount) <= 0) {
      setEditError('Informe o valor da fatura.')
      return
    }
    setEditBusy(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('invoices')
      .update({
        description: editForm.description.trim(),
        amount: Number(editForm.amount),
        due_date: editForm.due_date || null,
      })
      .eq('id', invoice.id)
      .select('*, customer:customers(id,name,email,phone)')
      .single()
    setEditBusy(false)
    if (error || !data) {
      setEditError('Não foi possível salvar as alterações.')
      return
    }
    setInvoices((prev) => prev.map((i) => (i.id === invoice.id ? (data as unknown as InvoiceWithRelations) : i)))
    setEditingInvoiceId(null)
  }

  // -------------------------------------------------------------------
  // Consolidação: soma faturas em aberto (rascunho/enviada) do mesmo
  // cliente numa fatura única. Por padrão todas as faturas em aberto do
  // cliente entram — o usuário pode desmarcar as que não quer incluir.
  // -------------------------------------------------------------------
  const [consolidateExcluded, setConsolidateExcluded] = useState<Record<string, Set<string>>>({})
  const [consolidateBusyCustomerId, setConsolidateBusyCustomerId] = useState<string | null>(null)
  const [consolidateError, setConsolidateError] = useState<string | null>(null)

  const openInvoicesByCustomer = useMemo(() => {
    const byCustomer = new Map<string, InvoiceWithRelations[]>()
    for (const invoice of invoices) {
      if (invoice.status !== 'draft' && invoice.status !== 'sent') continue
      const list = byCustomer.get(invoice.customer_id) ?? []
      list.push(invoice)
      byCustomer.set(invoice.customer_id, list)
    }
    return [...byCustomer.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([customerId, list]) => ({
        customerId,
        customerName: list[0]?.customer?.name ?? customers.find((c) => c.id === customerId)?.name ?? '—',
        invoices: list,
        total: list.reduce((sum, i) => sum + Number(i.amount), 0),
      }))
  }, [invoices, customers])

  function toggleConsolidateItem(customerId: string, invoiceId: string) {
    setConsolidateExcluded((prev) => {
      const next = new Set(prev[customerId] ?? [])
      if (next.has(invoiceId)) next.delete(invoiceId)
      else next.add(invoiceId)
      return { ...prev, [customerId]: next }
    })
  }

  const invoiceNumberById = useMemo(() => {
    const map = new Map<string, string>()
    for (const invoice of invoices) map.set(invoice.id, invoice.invoice_number)
    return map
  }, [invoices])

  async function handleConsolidate(customerId: string, invoiceIds: string[]) {
    setConsolidateError(null)
    setConsolidateBusyCustomerId(customerId)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('consolidate_invoices', {
      p_unit_id: unitId,
      p_customer_id: customerId,
      p_invoice_ids: invoiceIds,
    })
    setConsolidateBusyCustomerId(null)
    const newRow = (Array.isArray(data) ? data[0] : data) as Invoice | undefined
    if (error || !newRow) {
      setConsolidateError(error?.message ?? 'Não foi possível consolidar as faturas.')
      return
    }
    const customer = customers.find((c) => c.id === customerId)
    const newInvoice: InvoiceWithRelations = {
      ...newRow,
      customer: customer ? { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone } : null,
    }
    setInvoices((prev) => [
      newInvoice,
      ...prev.map((i) =>
        invoiceIds.includes(i.id) ? { ...i, status: 'consolidated' as const, consolidated_into_id: newInvoice.id } : i,
      ),
    ])
    setConsolidateExcluded((prev) => {
      const next = { ...prev }
      delete next[customerId]
      return next
    })
  }

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
        .select('*, customer:customers(id,name,email,phone)')
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
    if (!result.invoice) {
      setRecordRowBusyId(null)
      setRecordRowError(result.error ?? 'Não foi possível gerar a fatura.')
      return
    }
    const supabase = createClient()
    await supabase.from('service_records').update({ invoice_id: result.invoice.id }).eq('id', record.id)
    setRecordRowBusyId(null)
    setInvoices((prev) => [result.invoice!, ...prev])
    setRecords((prev) => prev.map((r) => (r.id === record.id ? { ...r, invoice_id: result.invoice!.id } : r)))
  }

  // -------------------------------------------------------------------
  // Faturar serviços pendentes (avulso): service_records ainda sem
  // fatura, agrupados por cliente — mostra o total a cobrar/a pagar à
  // equipe/margem ANTES de gerar, e cria uma única fatura pro lote
  // selecionado (ex.: 10 serviços de $80 viram 1 fatura de $800), sem
  // precisar gerar N faturas individuais e consolidar depois.
  // -------------------------------------------------------------------
  const [pendingExcluded, setPendingExcluded] = useState<Record<string, Set<string>>>({})
  const [pendingBusyCustomerId, setPendingBusyCustomerId] = useState<string | null>(null)
  const [pendingError, setPendingError] = useState<string | null>(null)

  const pendingRecordsByCustomer = useMemo(() => {
    const byCustomer = new Map<string, ServiceRecordWithRelations[]>()
    for (const record of records) {
      if (record.invoice_id !== null) continue
      if (!record.customer?.id || record.amount_charged === null) continue
      const list = byCustomer.get(record.customer.id) ?? []
      list.push(record)
      byCustomer.set(record.customer.id, list)
    }
    return [...byCustomer.entries()].map(([customerId, list]) => ({
      customerId,
      customerName: list[0]?.customer?.name ?? '—',
      records: list,
    }))
  }, [records])

  function togglePendingItem(customerId: string, recordId: string) {
    setPendingExcluded((prev) => {
      const next = new Set(prev[customerId] ?? [])
      if (next.has(recordId)) next.delete(recordId)
      else next.add(recordId)
      return { ...prev, [customerId]: next }
    })
  }

  async function handleGenerateConsolidatedServiceInvoice(customerId: string, selected: ServiceRecordWithRelations[]) {
    setPendingError(null)
    setPendingBusyCustomerId(customerId)
    const supabase = createClient()
    const { data, error } = await supabase.rpc('generate_service_records_invoice', {
      p_unit_id: unitId,
      p_customer_id: customerId,
      p_service_record_ids: selected.map((r) => r.id),
      p_currency: currency,
    })
    setPendingBusyCustomerId(null)
    const newRow = (Array.isArray(data) ? data[0] : data) as Invoice | undefined
    if (error || !newRow) {
      setPendingError(error?.message ?? 'Não foi possível gerar a fatura consolidada.')
      return
    }
    const customer = customers.find((c) => c.id === customerId)
    const newInvoice: InvoiceWithRelations = {
      ...newRow,
      customer: customer ? { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone } : null,
    }
    const selectedIds = new Set(selected.map((r) => r.id))
    setInvoices((prev) => [newInvoice, ...prev])
    setRecords((prev) => prev.map((r) => (selectedIds.has(r.id) ? { ...r, invoice_id: newInvoice.id } : r)))
    setPendingExcluded((prev) => {
      const next = { ...prev }
      delete next[customerId]
      return next
    })
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
      .select('*, customer:customers(id,name,email,phone)')
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
                      {editingRecordId === record.id ? (
                        <>
                          <Td>
                            <Input
                              type="date"
                              value={recordEditForm.service_date}
                              onChange={(e) => setRecordEditForm((f) => ({ ...f, service_date: e.target.value }))}
                            />
                          </Td>
                          <Td>
                            <Select
                              value={recordEditForm.employee_id}
                              onChange={(e) => setRecordEditForm((f) => ({ ...f, employee_id: e.target.value }))}
                            >
                              <option value="">Selecionar…</option>
                              {employees.map((emp) => (
                                <option key={emp.id} value={emp.id}>
                                  {emp.name}
                                </option>
                              ))}
                            </Select>
                          </Td>
                          <Td>
                            <div className="flex flex-col gap-1.5">
                              <Select
                                value={recordEditForm.customer_id}
                                onChange={(e) => setRecordEditForm((f) => ({ ...f, customer_id: e.target.value }))}
                              >
                                <option value="">Sem cliente</option>
                                {customers.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                              </Select>
                              <Select
                                value={recordEditForm.service_id}
                                onChange={(e) => setRecordEditForm((f) => ({ ...f, service_id: e.target.value }))}
                              >
                                <option value="">Outro / avulso</option>
                                {services.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </Select>
                              <Input
                                value={recordEditForm.description}
                                onChange={(e) => setRecordEditForm((f) => ({ ...f, description: e.target.value }))}
                                placeholder="Descrição"
                              />
                            </div>
                          </Td>
                          <Td>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={recordEditForm.amount_charged}
                              onChange={(e) => setRecordEditForm((f) => ({ ...f, amount_charged: e.target.value }))}
                            />
                          </Td>
                          <Td>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={recordEditForm.amount_due}
                              onChange={(e) => setRecordEditForm((f) => ({ ...f, amount_due: e.target.value }))}
                            />
                          </Td>
                        </>
                      ) : (
                        <>
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
                        </>
                      )}
                      <Td>
                        <StatusPill variant={record.payment_status === 'paid' ? 'green' : 'amber'}>
                          {record.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                        </StatusPill>
                      </Td>
                      <Td>
                        {editingRecordId === record.id ? (
                          <div className="flex flex-col gap-1.5">
                            {recordEditError && <p className="text-xs text-red-400">{recordEditError}</p>}
                            <div className="flex flex-wrap gap-3 text-xs font-semibold">
                              <button
                                type="button"
                                disabled={recordEditBusy}
                                className="text-green-400 hover:text-green-300 disabled:opacity-40"
                                onClick={() => handleSaveEditRecord(record)}
                              >
                                {recordEditBusy ? 'Salvando…' : 'Salvar'}
                              </button>
                              <button
                                type="button"
                                disabled={recordEditBusy}
                                className="text-slate-400 hover:text-slate-300 disabled:opacity-40"
                                onClick={handleCancelEditRecord}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
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
                            {record.invoice_id === null ? (
                              <button
                                type="button"
                                disabled={recordRowBusyId === record.id}
                                className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                                onClick={() => handleGenerateInvoiceFromRecord(record)}
                              >
                                Gerar fatura
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={recordRowBusyId === record.id}
                                className="text-purple-400 hover:text-purple-300 disabled:opacity-40"
                                onClick={() => handleUnlinkInvoice(record)}
                              >
                                Faturar novamente
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={recordRowBusyId === record.id}
                              className="text-slate-300 hover:text-white disabled:opacity-40"
                              onClick={() => handleStartEditRecord(record)}
                            >
                              Editar
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
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Faturar serviços pendentes: service_records avulsos ainda sem
          fatura, agrupados por cliente, com o total a cobrar/a pagar à
          equipe/margem calculados antes de gerar a fatura consolidada. */}
      {pendingRecordsByCustomer.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Faturar serviços pendentes</SectionLabel>
          {pendingError && <p className="text-sm text-red-400">{pendingError}</p>}
          <div className="flex flex-col gap-3">
            {pendingRecordsByCustomer.map((group) => {
              const excluded = pendingExcluded[group.customerId] ?? new Set<string>()
              const selected = group.records.filter((r) => !excluded.has(r.id))
              const totalCharged = selected.reduce((sum, r) => sum + Number(r.amount_charged), 0)
              const totalDue = selected.reduce((sum, r) => sum + (r.amount_due === null ? 0 : Number(r.amount_due)), 0)
              const margin = totalCharged - totalDue
              return (
                <div key={group.customerId} className="rounded-2xl bg-[#141a2b] p-4" style={{ boxShadow: cardShadow }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-white">{group.customerName}</p>
                    <p className="text-xs text-slate-400">{group.records.length} serviços pendentes de fatura</p>
                  </div>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {group.records.map((record) => (
                      <li key={record.id} className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={!excluded.has(record.id)}
                          onChange={() => togglePendingItem(group.customerId, record.id)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent"
                        />
                        <span className="font-semibold text-white">{formatDate(record.service_date)}</span>
                        <span className="text-slate-400">{record.service?.name ?? record.description ?? 'Serviço avulso'}</span>
                        <span className="ml-auto font-semibold text-slate-200">{fmtMoney(Number(record.amount_charged))}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-white/5 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Total a cobrar do cliente</p>
                      <p className="mt-1 text-base font-black text-white">{fmtMoney(totalCharged)}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">A pagar à equipe</p>
                      <p className="mt-1 text-base font-black text-amber-300">{fmtMoney(totalDue)}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">Sobra no caixa</p>
                      <p className="mt-1 text-base font-black text-green-400">{fmtMoney(margin)}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {selected.length} selecionados · {fmtMoney(totalCharged)}
                    </p>
                    <button
                      type="button"
                      disabled={selected.length === 0 || pendingBusyCustomerId === group.customerId}
                      onClick={() => handleGenerateConsolidatedServiceInvoice(group.customerId, selected)}
                      className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
                      style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
                    >
                      {pendingBusyCustomerId === group.customerId
                        ? 'Gerando…'
                        : `Gerar fatura consolidada (${selected.length})`}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Consolidação de faturas em aberto por cliente */}
      {openInvoicesByCustomer.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionLabel>Consolidar faturas em aberto</SectionLabel>
          {consolidateError && <p className="text-sm text-red-400">{consolidateError}</p>}
          <div className="flex flex-col gap-3">
            {openInvoicesByCustomer.map((group) => {
              const excluded = consolidateExcluded[group.customerId] ?? new Set<string>()
              const selected = group.invoices.filter((i) => !excluded.has(i.id))
              const selectedTotal = selected.reduce((sum, i) => sum + Number(i.amount), 0)
              return (
                <div key={group.customerId} className="rounded-2xl bg-[#141a2b] p-4" style={{ boxShadow: cardShadow }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-white">{group.customerName}</p>
                    <p className="text-xs text-slate-400">
                      {group.invoices.length} faturas em aberto · total {fmtMoney(group.total)}
                    </p>
                  </div>
                  <ul className="mt-3 flex flex-col gap-1.5">
                    {group.invoices.map((invoice) => (
                      <li key={invoice.id} className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={!excluded.has(invoice.id)}
                          onChange={() => toggleConsolidateItem(group.customerId, invoice.id)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent"
                        />
                        <span className="font-semibold text-white">{invoice.invoice_number}</span>
                        <span className="text-slate-400">{invoice.description}</span>
                        <span className="ml-auto font-semibold text-slate-200">{fmtMoney(Number(invoice.amount))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {selected.length} selecionadas · {fmtMoney(selectedTotal)}
                    </p>
                    <button
                      type="button"
                      disabled={selected.length < 2 || consolidateBusyCustomerId === group.customerId}
                      onClick={() => handleConsolidate(group.customerId, selected.map((i) => i.id))}
                      className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
                      style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
                    >
                      {consolidateBusyCustomerId === group.customerId
                        ? 'Consolidando…'
                        : `Consolidar ${selected.length} em uma fatura`}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Dados de cobrança — quem cobra, para a fatura em PDF */}
      <details
        open
        className="group rounded-2xl bg-[#141a2b] p-4"
        style={{ boxShadow: cardShadow }}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-white">
          <span>Dados de cobrança (aparecem nas faturas)</span>
          <span className="text-xs font-semibold text-slate-500 group-open:hidden">Mostrar</span>
          <span className="hidden text-xs font-semibold text-slate-500 group-open:inline">Ocultar</span>
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billingCompanyName">Nome da empresa que está cobrando</Label>
              <Input
                id="billingCompanyName"
                value={billingForm.billing_company_name}
                onChange={(e) => setBillingForm((f) => ({ ...f, billing_company_name: e.target.value }))}
                placeholder="Ex.: Sua Empresa LLC"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billingEmail">E-mail</Label>
              <Input
                id="billingEmail"
                type="email"
                value={billingForm.billing_email}
                onChange={(e) => setBillingForm((f) => ({ ...f, billing_email: e.target.value }))}
                placeholder="billing@suaempresa.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billingPhone">Telefone</Label>
              <Input
                id="billingPhone"
                value={billingForm.billing_phone}
                onChange={(e) => setBillingForm((f) => ({ ...f, billing_phone: e.target.value }))}
                placeholder="(11) 90000-0000"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="billingAddress">Endereço</Label>
              <Input
                id="billingAddress"
                value={billingForm.billing_address}
                onChange={(e) => setBillingForm((f) => ({ ...f, billing_address: e.target.value }))}
                placeholder="Rua, número, cidade"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billingLogo">Logo (aparece no topo da fatura em PDF)</Label>
            <div className="flex items-center gap-3">
              {billingLogoUrl ? (
                <img
                  src={billingLogoUrl}
                  alt="Logo"
                  className="h-12 w-12 flex-shrink-0 rounded-lg object-contain"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                />
              ) : (
                <div
                  className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-[10px] text-slate-500"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  sem logo
                </div>
              )}
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoUploading}
                  className="self-start rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {logoUploading ? 'Enviando...' : billingLogoUrl ? 'Trocar imagem' : 'Enviar imagem'}
                </button>
                <input
                  ref={logoInputRef}
                  id="billingLogo"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoChange}
                />
                {logoError && <p className="text-xs text-red-400">{logoError}</p>}
              </div>
            </div>
            <p className="text-xs text-slate-500">PNG ou JPG, até 2MB. SVG é aceito mas não aparece na fatura em PDF.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="billingPayment">Instruções de pagamento (aparecem no rodapé da fatura)</Label>
            <Textarea
              id="billingPayment"
              rows={2}
              value={billingForm.billing_payment_instructions}
              onChange={(e) => setBillingForm((f) => ({ ...f, billing_payment_instructions: e.target.value }))}
              placeholder="Ex.: Zelle para pay@suaempresa.com · PIX chave 000.000.000-00"
            />
          </div>
          {billingError && <p className="text-sm text-red-400">{billingError}</p>}
          {billingSaved && !billingError && <p className="text-sm text-green-400">Dados de cobrança salvos.</p>}
          <button
            type="button"
            disabled={billingBusy}
            onClick={handleSaveBilling}
            className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {billingBusy ? 'Salvando…' : 'Salvar dados de cobrança'}
          </button>
        </div>
      </details>

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
                        <p className="text-[11px] text-slate-500">
                          {[invoice.sent_to_email ?? invoice.customer?.email, invoice.sent_to_phone ?? invoice.customer?.phone]
                            .filter(Boolean)
                            .join(' · ') || 'sem e-mail nem telefone'}
                        </p>
                      </Td>
                      {editingInvoiceId === invoice.id ? (
                        <>
                          <Td>
                            <Input
                              value={editForm.description}
                              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                            />
                          </Td>
                          <Td>
                            <Input
                              type="number"
                              min={0.01}
                              step="0.01"
                              value={editForm.amount}
                              onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                            />
                          </Td>
                          <Td>
                            <Input
                              type="date"
                              value={editForm.due_date}
                              onChange={(e) => setEditForm((f) => ({ ...f, due_date: e.target.value }))}
                            />
                          </Td>
                        </>
                      ) : (
                        <>
                          <Td className="text-slate-400">
                            {invoice.description}
                            {invoice.consolidated_items && invoice.consolidated_items.length > 0 && (
                              <ul className="mt-1 flex flex-col gap-0.5 text-[11px] text-slate-500">
                                {invoice.consolidated_items.map((item) => (
                                  <li key={item.invoice_id}>
                                    {item.invoice_number} · {item.description} — {fmtMoney(Number(item.amount))}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {invoice.status === 'consolidated' && invoice.consolidated_into_id && (
                              <p className="mt-1 text-[11px] text-purple-300">
                                Incluída em {invoiceNumberById.get(invoice.consolidated_into_id) ?? 'fatura consolidada'}
                              </p>
                            )}
                          </Td>
                          <Td className="font-black text-white">{fmtMoney(Number(invoice.amount))}</Td>
                          <Td className="text-slate-400">{invoice.due_date ? formatDate(invoice.due_date) : '—'}</Td>
                        </>
                      )}
                      <Td>
                        <StatusPill variant={INVOICE_STATUS_VARIANT[invoice.status]}>
                          {INVOICE_STATUS_LABEL[invoice.status]}
                        </StatusPill>
                      </Td>
                      <Td>
                        {editingInvoiceId === invoice.id ? (
                          <div className="flex flex-col gap-1.5">
                            {editError && <p className="text-xs text-red-400">{editError}</p>}
                            <div className="flex flex-wrap gap-3 text-xs font-semibold">
                              <button
                                type="button"
                                disabled={editBusy}
                                className="text-green-400 hover:text-green-300 disabled:opacity-40"
                                onClick={() => handleSaveEdit(invoice)}
                              >
                                {editBusy ? 'Salvando…' : 'Salvar'}
                              </button>
                              <button
                                type="button"
                                disabled={editBusy}
                                className="text-slate-400 hover:text-slate-300 disabled:opacity-40"
                                onClick={handleCancelEdit}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-3 text-xs font-semibold">
                            {isInvoiceEditable(invoice.status) && (
                              <button
                                type="button"
                                disabled={invoiceRowBusyId === invoice.id}
                                className="text-slate-300 hover:text-white disabled:opacity-40"
                                onClick={() => handleStartEdit(invoice)}
                              >
                                Editar
                              </button>
                            )}
                            {invoice.status !== 'cancelled' && invoice.status !== 'paid' && invoice.status !== 'consolidated' && (
                              <button
                                type="button"
                                disabled={invoiceRowBusyId === invoice.id}
                                className="text-cyan-400 hover:text-cyan-300 disabled:opacity-40"
                                onClick={() => handleSendInvoice(invoice)}
                              >
                                {invoiceRowBusyId === invoice.id
                                  ? 'Enviando…'
                                  : invoice.status === 'sent'
                                    ? 'Reenviar fatura'
                                    : 'Enviar fatura'}
                              </button>
                            )}
                            {invoice.status !== 'paid' && invoice.status !== 'cancelled' && invoice.status !== 'consolidated' && (
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
                            {invoice.status === 'cancelled' && (
                              <button
                                type="button"
                                disabled={invoiceRowBusyId === invoice.id}
                                className="text-amber-400 hover:text-amber-300 disabled:opacity-40"
                                onClick={() => handleInvoiceStatus(invoice, 'draft')}
                              >
                                Reativar
                              </button>
                            )}
                            {invoice.status !== 'cancelled' && invoice.status !== 'paid' && invoice.status !== 'consolidated' && (
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
                        )}
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
