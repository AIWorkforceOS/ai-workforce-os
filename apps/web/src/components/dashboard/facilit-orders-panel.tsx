'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/dashboard-ui'

export type FacilitCredentialStatus = {
  client_code: string
  username: string
  is_active: boolean
  last_synced_at: string | null
  last_sync_error: string | null
} | null

export type FacilitWorkOrderRow = {
  id: string
  facilit_order_number: string
  po_number: string | null
  company: string | null
  address1: string | null
  city: string | null
  state: string | null
  category: string | null
  order_type: string | null
  priority: string | null
  status: string | null
  visit_date: string | null
  assigned_employee_id: string | null
}

type Technician = { id: string; name: string }

function formatVisitDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Ordens do dia/dia seguinte importadas da Facil-IT (integração Mawi Pro,
 * 2026-09-10) — credencial (Client Code/Login/Senha) fica sempre nesta
 * tela, nunca no chat: é o próprio usuário que digita aqui, e a senha
 * nunca volta pro navegador depois de salva (GET só devolve client_code/
 * username, ver /api/units/[id]/facilit/credentials).
 */
export function FacilitOrdersPanel({
  unitId,
  initialCredential,
  initialOrders,
  technicians,
}: {
  unitId: string
  initialCredential: FacilitCredentialStatus
  initialOrders: FacilitWorkOrderRow[]
  technicians: Technician[]
}) {
  const [credential, setCredential] = useState(initialCredential)
  const [orders, setOrders] = useState(initialOrders)
  const [showCredentialForm, setShowCredentialForm] = useState(!initialCredential)
  const [clientCode, setClientCode] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [savingCredential, setSavingCredential] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<string | null>(null)

  async function handleSaveCredential(e: React.FormEvent) {
    e.preventDefault()
    setSavingCredential(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${unitId}/facilit/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientCode, username, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar credenciais.')
        return
      }
      setCredential({ client_code: clientCode, username, is_active: true, last_synced_at: null, last_sync_error: null })
      setShowCredentialForm(false)
      setPassword('')
    } catch {
      setError('Não foi possível salvar as credenciais.')
    } finally {
      setSavingCredential(false)
    }
  }

  async function handleSyncNow() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch(`/api/units/${unitId}/facilit/sync`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao buscar ordens.')
        return
      }
      const ordersRes = await fetch(`/api/units/${unitId}/facilit/orders`)
      if (ordersRes.ok) {
        const ordersData = await ordersRes.json()
        setOrders(ordersData.orders ?? [])
      }
    } catch {
      setError('Não foi possível buscar as ordens agora.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleAssign(orderId: string, employeeId: string) {
    setAssigning(orderId)
    setError(null)
    const previous = orders
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, assigned_employee_id: employeeId || null } : o)))
    try {
      const res = await fetch(`/api/units/${unitId}/facilit/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employeeId || null }),
      })
      if (!res.ok) {
        setOrders(previous)
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Erro ao atribuir técnico.')
      }
    } catch {
      setOrders(previous)
      setError('Não foi possível atribuir o técnico.')
    } finally {
      setAssigning(null)
    }
  }

  return (
    <Card className="flex w-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Facil-IT — Ordens de serviço (360)</h2>
          <p className="mt-1 text-sm text-slate-400">
            Ordens de hoje e amanhã importadas automaticamente todos os dias. Escolha o técnico responsável por cada uma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {credential && (
            <button
              onClick={() => setShowCredentialForm((v) => !v)}
              className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-white/5"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {showCredentialForm ? 'Cancelar' : 'Trocar credenciais'}
            </button>
          )}
          <button
            onClick={handleSyncNow}
            disabled={syncing || !credential}
            className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {syncing ? 'Buscando...' : 'Buscar agora'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {credential?.last_sync_error && (
        <p className="text-xs text-amber-400">Última tentativa falhou: {credential.last_sync_error}</p>
      )}

      {showCredentialForm && (
        <form
          onSubmit={handleSaveCredential}
          className="flex flex-col gap-3 rounded-xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-xs text-slate-400">
            Digite aqui o Client Code, o Login e a Senha usados no app da Facil-IT (tech.facilit.fm). Fica salvo com
            segurança e só é usado pelo sistema pra buscar as ordens — nunca é exibido de volta.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              required
              placeholder="Client Code"
              value={clientCode}
              onChange={(e) => setClientCode(e.target.value)}
              className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-sm text-white"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            />
            <input
              required
              placeholder="Login"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-sm text-white"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            />
            <input
              required
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl bg-[#0b0f1a] px-3 py-2 text-sm text-white"
              style={{ border: '1px solid rgba(255,255,255,0.08)' }}
            />
          </div>
          <button
            type="submit"
            disabled={savingCredential}
            className="w-fit rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
          >
            {savingCredential ? 'Salvando...' : 'Salvar credenciais'}
          </button>
        </form>
      )}

      {!credential && !showCredentialForm && (
        <p className="text-sm text-slate-500">Cadastre suas credenciais da Facil-IT pra começar a importar as ordens.</p>
      )}

      {credential && orders.length === 0 && (
        <p className="text-sm text-slate-500">Nenhuma ordem de hoje ou amanhã encontrada ainda. Use &quot;Buscar agora&quot; ou aguarde a busca automática diária.</p>
      )}

      {orders.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-3">PO#</th>
                <th className="pb-2 pr-3">Local</th>
                <th className="pb-2 pr-3">Categoria</th>
                <th className="pb-2 pr-3">Visita</th>
                <th className="pb-2 pr-3">Status</th>
                <th className="pb-2 pr-3">Técnico</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-300">{order.po_number ?? order.facilit_order_number}</td>
                  <td className="py-2 pr-3">
                    <p className="font-semibold text-white">{order.company ?? '—'}</p>
                    <p className="text-xs text-slate-500">{[order.address1, order.city, order.state].filter(Boolean).join(', ')}</p>
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{[order.category, order.order_type].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="py-2 pr-3 text-slate-300">{formatVisitDate(order.visit_date)}</td>
                  <td className="py-2 pr-3 text-slate-300">{order.status ?? '—'}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={order.assigned_employee_id ?? ''}
                      disabled={assigning === order.id}
                      onChange={(e) => handleAssign(order.id, e.target.value)}
                      className="rounded-lg bg-[#0b0f1a] px-2 py-1.5 text-xs text-white"
                      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                    >
                      <option value="">Sem técnico</option>
                      {technicians.map((tech) => (
                        <option key={tech.id} value={tech.id}>
                          {tech.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
