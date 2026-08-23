'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, Loader2, Sparkles } from 'lucide-react'
import { Card, CardHeader, brandGradient } from '@/components/ui/dashboard-ui'

// Botões de geração + escolha dos dias de publicação (pedido do Vinicius,
// 2026-08-23): "Criar conteúdo agora" gera 1 post pra hoje na hora;
// "Gerar planejamento semanal" gera a semana toda de uma vez (aprovado,
// posta sozinho nos dias escolhidos abaixo — ver api/cron/content/route.ts).

const WEEKDAYS: { day: number; label: string }[] = [
  { day: 1, label: 'Seg' },
  { day: 2, label: 'Ter' },
  { day: 3, label: 'Qua' },
  { day: 4, label: 'Qui' },
  { day: 5, label: 'Sex' },
  { day: 6, label: 'Sab' },
  { day: 7, label: 'Dom' },
]

export function ContentWeekActions({ unitId, initialPostingDays }: { unitId: string; initialPostingDays: number[] }) {
  const router = useRouter()
  const [postingDays, setPostingDays] = useState<number[]>(initialPostingDays)
  const [savingDays, setSavingDays] = useState(false)
  const [busyNow, setBusyNow] = useState(false)
  const [busyWeek, setBusyWeek] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleDay(day: number) {
    const next = postingDays.includes(day) ? postingDays.filter((d) => d !== day) : [...postingDays, day].sort((a, b) => a - b)
    if (next.length === 0) return // nunca deixa sem nenhum dia selecionado
    setPostingDays(next)
    setSavingDays(true)
    await fetch('/api/content/posting-days', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_id: unitId, dias_publicacao: next }),
    })
    setSavingDays(false)
    router.refresh()
  }

  async function generateNow() {
    setBusyNow(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/content/generate-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId }),
      })
      const data = (await response.json()) as { error?: string; published?: boolean }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível gerar o post.')
        return
      }
      setMessage(data.published ? 'Post gerado e publicado agora mesmo!' : 'Post gerado — está esperando na fila de aprovação.')
      router.refresh()
    } catch {
      setError('Erro de rede ao gerar o post.')
    } finally {
      setBusyNow(false)
    }
  }

  async function generateWeek() {
    setBusyWeek(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/content/generate-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId }),
      })
      const data = (await response.json()) as { error?: string; created?: number; skipped?: number; dates?: string[] }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível gerar o planejamento semanal.')
        return
      }
      const dayCount = data.dates?.length ?? 0
      setMessage(`${data.created ?? 0} post(s) gerado(s) para ${dayCount} dia(s)${data.skipped ? ` (${data.skipped} já existia(m))` : ''}.`)
      router.refresh()
    } catch {
      setError('Erro de rede ao gerar o planejamento semanal.')
    } finally {
      setBusyWeek(false)
    }
  }

  return (
    <Card className="p-6">
      <CardHeader eyebrow="ações" title="Gerar conteúdo" />
      <div className="flex flex-wrap gap-3">
        <button
          onClick={generateNow}
          disabled={busyNow || busyWeek}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-black text-white disabled:opacity-60"
          style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
        >
          {busyNow ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {busyNow ? 'Gerando...' : 'Criar conteúdo agora'}
        </button>
        <button
          onClick={generateWeek}
          disabled={busyNow || busyWeek}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-slate-200 disabled:opacity-60"
          style={{ border: '1px solid rgba(255,255,255,0.12)' }}
        >
          {busyWeek ? <Loader2 size={14} className="animate-spin" /> : <CalendarRange size={14} />}
          {busyWeek ? 'Gerando a semana...' : 'Gerar planejamento semanal'}
        </button>
      </div>

      <div className="mt-5">
        <p className="mb-1.5 text-xs font-bold text-slate-400">
          Dias em que ele publica{savingDays ? ' (salvando...)' : ''}
        </p>
        <div className="flex gap-1.5">
          {WEEKDAYS.map(({ day, label }) => {
            const active = postingDays.includes(day)
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className="flex h-9 w-11 items-center justify-center rounded-lg text-xs font-black transition-all"
                style={
                  active
                    ? { background: brandGradient, color: '#fff' }
                    : { background: 'rgba(255,255,255,0.04)', color: '#64748b', border: '1px solid rgba(255,255,255,0.08)' }
                }
              >
                {label}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          Toda sexta, ele já prepara sozinho os posts da semana seguinte nesses dias — ou clique em &quot;Gerar
          planejamento semanal&quot; a qualquer momento.
        </p>
      </div>

      {message && <p className="mt-3 text-xs text-emerald-400">{message}</p>}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </Card>
  )
}
