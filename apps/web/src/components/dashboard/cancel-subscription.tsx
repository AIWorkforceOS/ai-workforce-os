'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Card, Label, Select, Textarea } from '@/components/ui/dashboard-ui'

// Cancelamento self-service (pedido do Vinicius, 2026-08-25): motivo
// obrigatório (feedback de churn) antes de confirmar. Duas etapas — pedir
// o motivo, depois um passo de confirmação explícito — porque é uma ação
// que para a cobrança recorrente de verdade e não tem volta fácil (ver
// api/billing/cancel, que também bloqueia o uso do sistema na hora).

const REASONS = [
  'Muito caro pro que eu preciso hoje',
  'Não usei o suficiente',
  'Vou usar outra ferramenta',
  'Faltou uma funcionalidade que eu precisava',
  'Tive um problema técnico não resolvido',
  'Outro motivo',
] as const

export function CancelSubscriptionCard({ billingStatus }: { billingStatus: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [reasonOption, setReasonOption] = useState<string>(REASONS[0])
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [refunded, setRefunded] = useState(false)

  if (billingStatus === 'canceled') {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-600">
            <AlertTriangle size={16} className="text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Assinatura cancelada</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              Sua assinatura já está cancelada e a cobrança recorrente foi interrompida. Fale com o suporte se
              quiser reativar.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    const reason = details.trim() ? `${reasonOption} — ${details.trim()}` : reasonOption
    const res = await fetch('/api/billing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(data.error ?? 'Não foi possível cancelar agora. Tente de novo.')
      return
    }
    setRefunded(Boolean(data.refunded))
    setDone(true)
    router.refresh()
  }

  if (done) {
    return (
      <Card className="p-5">
        <p className="text-sm font-bold text-emerald-400">Assinatura cancelada.</p>
        <p className="mt-1 text-xs text-slate-400">
          {refunded
            ? 'Você está dentro dos 7 dias de garantia — o valor já foi estornado automaticamente pro seu cartão (pode levar até 10 dias úteis pra aparecer na fatura). A cobrança recorrente foi interrompida.'
            : 'A cobrança recorrente foi interrompida. Sentiremos sua falta.'}
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-400 to-rose-500" style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
          <AlertTriangle size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Cancelar assinatura</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            Interrompe a cobrança recorrente e bloqueia o uso do sistema imediatamente após a confirmação.
          </p>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl border border-red-500/30 px-4 py-2 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/10"
        >
          Cancelar assinatura
        </button>
      ) : (
        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancelReason">Por que você está cancelando?</Label>
            <Select id="cancelReason" value={reasonOption} onChange={(e) => setReasonOption(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cancelDetails">Quer contar mais alguma coisa? (opcional)</Label>
            <Textarea
              id="cancelDetails"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Ajuda a gente a melhorar — sua resposta é lida de verdade."
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {!confirming ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-slate-400 hover:bg-white/5"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-xl border border-red-500/30 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
              >
                Continuar cancelamento
              </button>
            </div>
          ) : (
            <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <p className="mb-3 text-xs font-bold text-red-300">
                Tem certeza? Isso para a cobrança e bloqueia o acesso ao sistema imediatamente.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-slate-400 hover:bg-white/5"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  {busy ? 'Cancelando...' : 'Sim, cancelar assinatura'}
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </Card>
  )
}
