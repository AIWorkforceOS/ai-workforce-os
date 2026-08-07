'use client'

import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { CalendarDays, Camera, ChevronLeft, ChevronRight, ClipboardCheck, FileText, List, MapPin } from 'lucide-react'
import { Badge, EmptyState, Input, Label, Select, type BadgeVariant } from '@/components/ui/dashboard-ui'
import { currentMonthInTimezone, monthLabel, shiftMonth } from '@/lib/service-operations-month'
import type { PortalAppointment, PortalServiceOrderPhoto } from '@/lib/portal-funcionario/data'

// Agenda do Portal do Funcionário: agendamento clicável (abre o
// detalhe com a descrição/observações completas, hoje só visível como
// nome do serviço) + visão de calendário mensal navegável, alternável
// com a lista — pedido direto do dono do produto. Client component
// porque as duas interações (expandir detalhe, navegar mês no
// calendário) não precisam de ida ao servidor: já temos todos os
// agendamentos do funcionário (desde PORTAL_DATA_SINCE) em memória.

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  completed: 'Concluído',
  cancelled: 'Cancelado',
  no_show: 'Faltou',
}

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  scheduled: 'blue',
  confirmed: 'cyan',
  completed: 'green',
  cancelled: 'slate',
  no_show: 'red',
}

const SERVICE_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  completed: 'Finalizado',
  quote: 'Cotação',
}

const SERVICE_ORDER_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'amber',
  completed: 'green',
  quote: 'purple',
}

function dayKeyInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(iso))
}

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

function formatTimeRange(startsAt: string, endsAt: string, locale: string): string {
  const start = new Date(startsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const end = new Date(endsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return `${start} – ${end}`
}

type ServiceOrderUpdate = Pick<
  PortalAppointment,
  'service_order_status' | 'service_order_signed_by' | 'service_order_signed_at' | 'service_order_part_purchase_link' | 'service_order_photos'
>

/**
 * Ordem de serviço anexada pelo admin (Fase A Mawi/360): resumo em PT +
 * endereço (já mostrado acima, na linha do agendamento) + número, link
 * pra abrir o arquivo original (mostrar ao gerente da loja) e o fluxo
 * de finalizar — nome de quem assinou, fotos, "Finalizado" ou
 * "Cotação" (com link de compra da peça). Some da tela quando o admin
 * não anexou nada para este agendamento.
 */
function ServiceOrderPanel({
  appt,
  onUpdated,
}: {
  appt: PortalAppointment
  onUpdated: (patch: ServiceOrderUpdate) => void
}) {
  const hasOrder = Boolean(appt.service_order_number || appt.service_order_file_url || appt.service_order_summary_pt)
  const [showForm, setShowForm] = useState(false)
  const [signedBy, setSignedBy] = useState('')
  const [status, setStatus] = useState<'completed' | 'quote'>(appt.service_order_status === 'quote' ? 'quote' : 'completed')
  const [partPurchaseLink, setPartPurchaseLink] = useState(appt.service_order_part_purchase_link ?? '')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!hasOrder) return null

  function handlePhotosChange(event: ChangeEvent<HTMLInputElement>) {
    setPhotos(Array.from(event.target.files ?? []))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(false)

    if (status === 'completed' && !signedBy.trim()) {
      setError('Informe o nome de quem assinou para finalizar.')
      return
    }

    const formData = new FormData()
    formData.set('status', status)
    formData.set('signedBy', signedBy.trim())
    formData.set('partPurchaseLink', status === 'quote' ? partPurchaseLink.trim() : '')
    for (const photo of photos) formData.append('photos', photo)

    setSubmitting(true)
    try {
      const response = await fetch(`/api/units/${appt.unit_id}/appointments/${appt.id}/service-order`, {
        method: 'PATCH',
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.appointment) {
        setError(data?.error ?? 'Não foi possível salvar. Tente novamente.')
        return
      }
      onUpdated(data.appointment as ServiceOrderUpdate)
      setSuccess(true)
      setShowForm(false)
      setPhotos([])
      setSignedBy('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      setError('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="mt-1 flex flex-col gap-2.5 rounded-xl px-4 py-3"
      style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.18)' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">
          Ordem de serviço {appt.service_order_number ? `Nº ${appt.service_order_number}` : ''}
        </span>
        <Badge variant={SERVICE_ORDER_STATUS_VARIANT[appt.service_order_status] ?? 'slate'}>
          {SERVICE_ORDER_STATUS_LABEL[appt.service_order_status] ?? appt.service_order_status}
        </Badge>
      </div>

      {appt.service_order_summary_pt && <p className="text-slate-300">{appt.service_order_summary_pt}</p>}

      {appt.service_order_file_url && (
        <a
          href={appt.service_order_file_url}
          target="_blank"
          rel="noreferrer"
          className="flex w-fit items-center gap-1.5 text-xs font-bold text-indigo-300 hover:text-indigo-200"
        >
          <FileText size={13} />
          Abrir ordem de serviço
        </a>
      )}

      {appt.service_order_status !== 'pending' && appt.service_order_signed_by && (
        <p className="text-[12px] text-slate-400">
          Assinado por <span className="font-semibold text-slate-200">{appt.service_order_signed_by}</span>
          {appt.service_order_signed_at ? ` em ${new Date(appt.service_order_signed_at).toLocaleDateString('pt-BR')}` : ''}
        </p>
      )}

      {appt.service_order_photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {appt.service_order_photos.map((photo: PortalServiceOrderPhoto, i: number) => (
            <a key={i} href={photo.url} target="_blank" rel="noreferrer">
              <img src={photo.url} alt="Foto do atendimento" className="h-14 w-14 rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
        >
          <ClipboardCheck size={13} />
          {appt.service_order_status === 'pending' ? 'Finalizar atendimento' : 'Atualizar finalização'}
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-1">
            <Label>O que aconteceu?</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value as 'completed' | 'quote')}>
              <option value="completed">Finalizado</option>
              <option value="quote">Cotação</option>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <Label>Nome de quem assinou {status === 'completed' ? '*' : '(opcional)'}</Label>
            <Input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Nome do gerente da loja" />
          </div>

          {status === 'quote' && (
            <div className="flex flex-col gap-1">
              <Label>Link de compra da peça</Label>
              <Input
                type="url"
                value={partPurchaseLink}
                onChange={(e) => setPartPurchaseLink(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label>Fotos</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={handlePhotosChange}
              className="text-xs text-slate-300 file:mr-2 file:rounded-lg file:border-0 file:bg-white/10 file:px-2.5 file:py-1 file:text-[11px] file:font-bold file:text-slate-200"
            />
            {photos.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-slate-400">
                <Camera size={11} />
                {photos.length} foto{photos.length === 1 ? '' : 's'} selecionada{photos.length === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
            >
              {submitting ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {success && <p className="text-[11px] font-semibold text-emerald-400">Salvo com sucesso.</p>}
    </div>
  )
}

function AppointmentRow({
  appt,
  locale,
  expanded,
  onToggle,
  onOrderUpdated,
}: {
  appt: PortalAppointment
  locale: string
  expanded: boolean
  onToggle: () => void
  onOrderUpdated: (patch: ServiceOrderUpdate) => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-1 px-5 py-4 text-left transition-colors hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
        aria-expanded={expanded}
      >
        <div>
          <p className="text-sm font-semibold text-white">
            {appt.customers?.name ?? 'Cliente'} {appt.services?.name ? `· ${appt.services.name}` : ''}
          </p>
          <p className="mt-0.5 text-[12px] text-slate-400">{formatDateTime(appt.starts_at, locale)}</p>
          {appt.address && <p className="text-[11px] text-slate-500">{appt.address}</p>}
        </div>
        <Badge variant={STATUS_VARIANT[appt.status] ?? 'slate'}>{STATUS_LABEL[appt.status] ?? appt.status}</Badge>
      </button>
      {expanded && (
        <div
          className="mx-5 mb-4 flex flex-col gap-2 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-white">{appt.services?.name ?? 'Serviço'}</span>
            <span className="text-slate-400">{formatTimeRange(appt.starts_at, appt.ends_at, locale)}</span>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Descrição do serviço</p>
            <p className="mt-0.5 text-slate-300">{appt.notes || 'Sem observações registradas para este agendamento.'}</p>
          </div>
          {appt.address && (
            <div className="flex items-center gap-1.5 text-slate-400">
              <MapPin size={12} />
              <span>{appt.address}</span>
            </div>
          )}
          <ServiceOrderPanel appt={appt} onUpdated={onOrderUpdated} />
        </div>
      )}
    </div>
  )
}

function AppointmentList({
  appointments,
  locale,
  expandedId,
  onToggle,
  onOrderUpdated,
}: {
  appointments: PortalAppointment[]
  locale: string
  expandedId: string | null
  onToggle: (id: string) => void
  onOrderUpdated: (appointmentId: string, patch: ServiceOrderUpdate) => void
}) {
  if (appointments.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={22} className="text-white" />}
        title="Nenhum agendamento ainda"
        subtitle="Quando a unidade agendar um trabalho no seu nome, ele aparece aqui."
      />
    )
  }
  return (
    <div className="flex flex-col divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      {appointments.map((appt) => (
        <AppointmentRow
          key={appt.id}
          appt={appt}
          locale={locale}
          expanded={expandedId === appt.id}
          onToggle={() => onToggle(appt.id)}
          onOrderUpdated={(patch) => onOrderUpdated(appt.id, patch)}
        />
      ))}
    </div>
  )
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

export function AgendaSection({
  appointments: initialAppointments,
  timezone,
  locale,
}: {
  appointments: PortalAppointment[]
  timezone: string
  locale: string
}) {
  const [appointments, setAppointments] = useState(initialAppointments)
  const [viewMode, setViewMode] = useState<'lista' | 'calendario'>('lista')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState(() => currentMonthInTimezone(timezone))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  function handleOrderUpdated(appointmentId: string, patch: ServiceOrderUpdate) {
    setAppointments((prev) => prev.map((a) => (a.id === appointmentId ? { ...a, ...patch } : a)))
  }

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, PortalAppointment[]>()
    for (const appt of appointments) {
      const key = dayKeyInTimezone(appt.starts_at, timezone)
      const list = map.get(key) ?? []
      list.push(appt)
      map.set(key, list)
    }
    return map
  }, [appointments, timezone])

  const todayKey = useMemo(() => currentMonthInTimezone(timezone) === calendarMonth ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()) : null, [timezone, calendarMonth])

  const toggleExpanded = (id: string) => setExpandedId((current) => (current === id ? null : id))

  const calendarGrid = useMemo(() => {
    const [year = 0, mon = 1] = calendarMonth.split('-').map(Number)
    const daysInMonth = new Date(year, mon, 0).getDate()
    const firstWeekday = new Date(year, mon - 1, 1).getDay()
    const cells: { date: string | null; day: number | null }[] = []
    for (let i = 0; i < firstWeekday; i++) cells.push({ date: null, day: null })
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: `${calendarMonth}-${String(day).padStart(2, '0')}`, day })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null })
    return cells
  }, [calendarMonth])

  const selectedDayAppointments = selectedDay ? (appointmentsByDay.get(selectedDay) ?? []) : []

  return (
    <div>
      <div className="flex items-center justify-between gap-3 p-5">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-cyan-300">agenda</p>
          <h2 className="mt-1 text-base font-bold text-white">Seus agendamentos</h2>
        </div>
        <div
          className="flex items-center gap-0.5 rounded-xl p-0.5"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button
            type="button"
            onClick={() => setViewMode('lista')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
            style={
              viewMode === 'lista'
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff' }
                : { color: '#94a3b8' }
            }
          >
            <List size={13} />
            Lista
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendario')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
            style={
              viewMode === 'calendario'
                ? { background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', color: '#fff' }
                : { color: '#94a3b8' }
            }
          >
            <CalendarDays size={13} />
            Calendário
          </button>
        </div>
      </div>

      {viewMode === 'lista' && (
        <AppointmentList
          appointments={appointments}
          locale={locale}
          expandedId={expandedId}
          onToggle={toggleExpanded}
          onOrderUpdated={handleOrderUpdated}
        />
      )}

      {viewMode === 'calendario' && (
        <div className="px-5 pb-5">
          <div className="flex items-center justify-between gap-2 pb-3">
            <button
              type="button"
              onClick={() => {
                setCalendarMonth((m) => shiftMonth(m, -1))
                setSelectedDay(null)
              }}
              aria-label="Mês anterior"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <ChevronLeft size={14} />
            </button>
            <p className="text-sm font-bold capitalize text-white">{monthLabel(calendarMonth, locale)}</p>
            <button
              type="button"
              onClick={() => {
                setCalendarMonth((m) => shiftMonth(m, 1))
                setSelectedDay(null)
              }}
              aria-label="Próximo mês"
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-all hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="py-1 text-[10px] font-bold uppercase text-slate-500">
                {label}
              </div>
            ))}
            {calendarGrid.map((cell, i) => {
              if (!cell.date) return <div key={i} />
              const dayAppointments = appointmentsByDay.get(cell.date) ?? []
              const hasAppointments = dayAppointments.length > 0
              const isToday = cell.date === todayKey
              const isSelected = cell.date === selectedDay
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!hasAppointments}
                  onClick={() => setSelectedDay((d) => (d === cell.date ? null : cell.date))}
                  className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs transition-all disabled:cursor-default"
                  style={{
                    background: isSelected
                      ? 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'
                      : hasAppointments
                        ? 'rgba(6,182,212,0.1)'
                        : 'transparent',
                    color: isSelected ? '#fff' : hasAppointments ? '#e2e8f0' : '#64748b',
                    border: isToday ? '1px solid rgba(6,182,212,0.6)' : '1px solid transparent',
                    fontWeight: hasAppointments ? 700 : 400,
                  }}
                >
                  <span>{cell.day}</span>
                  {hasAppointments && (
                    <span
                      className="h-1 w-1 rounded-full"
                      style={{ background: isSelected ? '#fff' : '#06b6d4' }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-4">
            {selectedDay ? (
              <div className="rounded-2xl" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <AppointmentList
                  appointments={selectedDayAppointments}
                  locale={locale}
                  expandedId={expandedId}
                  onToggle={toggleExpanded}
                  onOrderUpdated={handleOrderUpdated}
                />
              </div>
            ) : (
              <p className="px-1 text-[12px] text-slate-500">Toque em um dia com agendamento para ver os detalhes.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
