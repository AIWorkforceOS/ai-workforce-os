'use client'

import { useState } from 'react'
import { MessageCircle, Loader2, Check } from 'lucide-react'
import { Card, Input, Label } from '@/components/ui/dashboard-ui'

export type ManagerWhatsappUnit = { id: string; name: string; manager_whatsapp_phone: string | null }

// Pedido do Vinicius (2026-08-25): "o humano cadastra um numero de whats
// como o humano responsavel e ela sempre envia msg para ele no whats para
// confirmações, informaçoes etc." — cadastra o número que recebe o
// resumo diário da agenda (cron/manager-agenda-digest) e que a
// Recepcionista reconhece como comando administrativo, não cliente comum.

function UnitRow({ unit }: { unit: ManagerWhatsappUnit }) {
  const [phone, setPhone] = useState(unit.manager_whatsapp_phone ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setBusy(true)
    setError(null)
    setSaved(false)
    const res = await fetch(`/api/units/${unit.id}/manager-whatsapp`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone.trim() || null }),
    })
    setBusy(false)
    if (!res.ok) {
      setError('Não foi possível salvar. Tente de novo.')
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <p className="mb-3 text-xs font-bold text-white">{unit.name}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor={`manager-whatsapp-${unit.id}`}>WhatsApp do responsável</Label>
          <Input
            id={`manager-whatsapp-${unit.id}`}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 99999-0000"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          {!busy && saved && <Check size={12} />}
          {busy ? 'Salvando...' : saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}

export function ManagerWhatsappSettingsCard({ units }: { units: ManagerWhatsappUnit[] }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500"
          style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
        >
          <MessageCircle size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">WhatsApp do responsável pela agenda</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            A Recepcionista manda o resumo da agenda do dia todo dia pra esse número, e reconhece mensagens
            dele como pedido do gestor (ex.: marcar ou cancelar um horário), não de um cliente comum.
          </p>
        </div>
      </div>

      {units.length === 0 ? (
        <p className="text-xs text-slate-500">Nenhuma unidade ativa.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {units.map((unit) => (
            <UnitRow key={unit.id} unit={unit} />
          ))}
        </div>
      )}
    </Card>
  )
}
