'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { Card } from '@/components/ui/dashboard-ui'

export type FacilitCredentialStatus = {
  client_code: string
  username: string
  is_active: boolean
  last_synced_at: string | null
  last_sync_error: string | null
} | null

function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'ainda não'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

type FacilitSyncSkip = { orderNumber: string | null; company: string | null; reason: string; detail?: string }

const SKIP_REASON_LABEL: Record<string, string> = {
  sem_numero_ordem: 'sem número de ordem identificável',
  fora_de_hoje_amanha: 'não é de hoje nem de amanhã',
  falha_ao_salvar: 'falha ao salvar',
}

function formatSkip(skip: FacilitSyncSkip): string {
  const label = SKIP_REASON_LABEL[skip.reason] ?? skip.reason
  const who = skip.orderNumber ? `Ordem ${skip.orderNumber}` : 'Uma ordem'
  const company = skip.company ? ` (${skip.company})` : ''
  return `${who}${company}: ${label}${skip.detail ? ` — ${skip.detail}` : ''}`
}

/**
 * Credenciais + sync da Facil-IT (integração Mawi Pro, 2026-09-10;
 * revisada 2026-09-15 — as ordens agora vão direto pra Agenda real em
 * vez de uma lista própria aqui, ver facilit-sync.ts). Client Code/
 * Login/Senha ficam sempre nesta tela, nunca no chat: é o próprio
 * usuário que digita aqui, e a senha nunca volta pro navegador depois
 * de salva (GET só devolve client_code/username).
 */
export function FacilitOrdersPanel({
  unitId,
  initialCredential,
  agendaHref,
}: {
  unitId: string
  initialCredential: FacilitCredentialStatus
  agendaHref: string
}) {
  const [credential, setCredential] = useState(initialCredential)
  const [showCredentialForm, setShowCredentialForm] = useState(!initialCredential)
  const [clientCode, setClientCode] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [savingCredential, setSavingCredential] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [syncSkipped, setSyncSkipped] = useState<FacilitSyncSkip[]>([])
  const [error, setError] = useState<string | null>(null)

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
    setSyncMessage(null)
    setSyncSkipped([])
    try {
      const res = await fetch(`/api/units/${unitId}/facilit/sync`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Erro ao buscar ordens.')
        return
      }
      setSyncMessage(
        data.imported > 0
          ? `${data.imported} ${data.imported === 1 ? 'ordem importada' : 'ordens importadas'} pra Agenda.`
          : 'Nenhuma ordem nova de hoje/amanhã encontrada.',
      )
      setSyncSkipped((data.skipped ?? []) as FacilitSyncSkip[])
      setCredential((prev) => (prev ? { ...prev, last_synced_at: new Date().toISOString(), last_sync_error: null } : prev))
    } catch {
      setError('Não foi possível buscar as ordens agora.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card className="flex w-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-white">Facil-IT (360)</h2>
          <p className="mt-1 text-sm text-slate-400">
            Todos os dias, as ordens de hoje e amanhã são importadas automaticamente pra Agenda — é lá que você escolhe o
            técnico e confirma o horário de cada uma.
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
      {syncMessage && <p className="text-sm text-emerald-400">{syncMessage}</p>}
      {syncSkipped.length > 0 && (
        <div
          className="flex flex-col gap-1 rounded-xl px-3.5 py-3 text-xs text-amber-300"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}
        >
          <p className="font-bold">
            {syncSkipped.length === 1 ? '1 ordem não entrou na Agenda:' : `${syncSkipped.length} ordens não entraram na Agenda:`}
          </p>
          {syncSkipped.map((skip, i) => (
            <p key={i}>{formatSkip(skip)}</p>
          ))}
        </div>
      )}

      {credential?.last_sync_error && (
        <p className="text-xs text-amber-400">Última tentativa automática falhou: {credential.last_sync_error}</p>
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

      {credential && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-xs text-slate-400">Última busca: {formatSyncedAt(credential.last_synced_at)}</p>
          <Link
            href={agendaHref}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            <CalendarDays size={13} />
            Ver na Agenda
          </Link>
        </div>
      )}
    </Card>
  )
}
