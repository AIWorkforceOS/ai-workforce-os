'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Phone, MessageSquare, StickyNote, CalendarClock, ListTodo, ArrowRightLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input, Label, Select, Textarea, brandGradient } from '@/components/ui/dashboard-ui'
import { ACTIVITY_LABEL, dueBucket, validateNewActivity, type ActivityKind, type LeadActivity } from '@/lib/crm/activities'

export type CrmUser = { id: string; name: string | null; email: string }

const ICON: Record<ActivityKind, typeof Phone> = { note: StickyNote, call: Phone, message: MessageSquare, followup: CalendarClock, task: ListTodo, status_change: ArrowRightLeft }

/** Responsável, retornos/tarefas e linha do tempo de um lead. Tudo opcional: se a tabela ainda não existe, mostra um aviso e o resto do CRM segue igual. */
export function LeadActivityPanel({
  leadId,
  unitId,
  ownerId,
  users,
  currentUserId,
  timeZone,
  onOwnerChange,
  onChanged,
}: {
  leadId: string
  unitId: string
  ownerId: string | null
  users: CrmUser[]
  currentUserId: string | null
  timeZone: string
  onOwnerChange: (userId: string | null) => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<LeadActivity[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [kind, setKind] = useState<ActivityKind>('note')
  const [body, setBody] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await createClient().from('lead_activities').select('id, lead_id, kind, body, due_at, done_at, assigned_to, created_by, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(100)
    if (err) return setUnavailable(true)
    setUnavailable(false)
    setItems((data ?? []) as LeadActivity[])
  }, [leadId])

  useEffect(() => {
    void load()
  }, [load])

  const needsDue = kind === 'followup' || kind === 'task'

  async function add() {
    if (busy) return
    const problem = validateNewActivity({ kind, body, dueAt })
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const { error: err } = await createClient().from('lead_activities').insert({
      unit_id: unitId,
      lead_id: leadId,
      kind,
      body: body.trim() || null,
      due_at: needsDue ? new Date(dueAt).toISOString() : null,
      assigned_to: needsDue ? (ownerId ?? currentUserId) : null,
      created_by: currentUserId,
    })
    setBusy(false)
    if (err) return setError('Não foi possível salvar. Tente de novo.')
    setBody('')
    setDueAt('')
    await load()
    onChanged()
  }

  async function toggleDone(item: LeadActivity) {
    const { error: err } = await createClient().from('lead_activities').update({ done_at: item.done_at ? null : new Date().toISOString() }).eq('id', item.id)
    if (err) return setError('Não foi possível atualizar.')
    await load()
    onChanged()
  }

  async function changeOwner(value: string) {
    const next = value || null
    const { error: err } = await createClient().from('leads').update({ owner_user_id: next, updated_at: new Date().toISOString() }).eq('id', leadId)
    if (err) return setError('Não foi possível trocar o responsável.')
    onOwnerChange(next)
  }

  const now = new Date()
  const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lead-owner">Responsável</Label>
        <Select id="lead-owner" value={ownerId ?? ''} onChange={(e) => void changeOwner(e.target.value)}>
          <option value="">Sem responsável</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email}
              {u.id === currentUserId ? ' (você)' : ''}
            </option>
          ))}
        </Select>
      </div>

      {unavailable ? (
        <p className="text-xs text-slate-500">Retornos e linha do tempo ficam disponíveis depois da atualização do banco.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <Label htmlFor="act-kind">Registrar</Label>
            <Select id="act-kind" value={kind} onChange={(e) => setKind(e.target.value as ActivityKind)}>
              <option value="note">Nota</option>
              <option value="call">Ligação feita</option>
              <option value="message">Mensagem enviada</option>
              <option value="followup">Agendar retorno</option>
              <option value="task">Criar tarefa</option>
            </Select>
            {needsDue && <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} aria-label="Data e hora do retorno" />}
            <Textarea rows={2} className="resize-none" placeholder={needsDue ? 'O que fazer nesse retorno (opcional)' : 'O que aconteceu'} value={body} onChange={(e) => setBody(e.target.value)} />
            <button type="button" disabled={busy} onClick={() => void add()} className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40" style={{ background: brandGradient }}>
              {busy ? 'Salvando…' : 'Adicionar'}
            </button>
            {error && (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Linha do tempo</p>
            {items.length === 0 && <p className="text-xs text-slate-500">Nada registrado ainda.</p>}
            {items.map((item) => {
              const Icon = ICON[item.kind]
              const isOpen = (item.kind === 'followup' || item.kind === 'task') && !item.done_at
              const bucket = isOpen && item.due_at ? dueBucket(item.due_at, now, timeZone) : null
              return (
                <div key={item.id} className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)', opacity: item.done_at ? 0.6 : 1 }}>
                  <Icon size={13} className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-200">
                      {ACTIVITY_LABEL[item.kind]}
                      {item.due_at ? ` · ${fmt(item.due_at)}` : ''}
                      {bucket === 'overdue' && <span className="ml-1.5 text-red-400">atrasado</span>}
                      {bucket === 'today' && <span className="ml-1.5 text-amber-400">hoje</span>}
                      {item.done_at && <span className="ml-1.5 text-emerald-400">feito</span>}
                    </p>
                    {item.body && <p className="whitespace-pre-wrap break-words text-xs text-slate-400">{item.body}</p>}
                    <p className="text-[10px] text-slate-600">{fmt(item.created_at)}</p>
                  </div>
                  {(item.kind === 'followup' || item.kind === 'task') && (
                    <button type="button" onClick={() => void toggleDone(item)} aria-label={item.done_at ? 'Reabrir' : 'Marcar como feito'} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-emerald-400">
                      <Check size={14} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
