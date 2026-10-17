'use client'

import { useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { FieldEvents } from '@/lib/portal-funcionario/field-time'
import { TripControls } from './trip-controls'

/**
 * Envolve a ordem: para quem o admin marcou "check-in com GPS", o formulário
 * da ordem só abre depois do check-in. Os demais técnicos veem a ordem normal.
 * `render` recebe o que a ordem precisa saber (se o GPS é obrigatório e como
 * avisar que a ordem foi concluída).
 */
export function FieldOrderShell({
  requiresCheckin,
  unitId,
  appointmentId,
  address,
  initial,
  render,
}: {
  requiresCheckin: boolean
  unitId: string
  appointmentId: string
  address: string | null
  initial: FieldEvents
  render: (api: { requireGps: boolean; onFinished: (endedAt: string) => void }) => ReactNode
}) {
  const [events, setEvents] = useState<FieldEvents>(initial)

  if (!requiresCheckin) return <>{render({ requireGps: false, onFinished: () => {} })}</>

  const unlocked = Boolean(events.checked_in_at)

  return (
    <>
      <TripControls unitId={unitId} appointmentId={appointmentId} address={address} initial={initial} events={events} onEvents={setEvents} />
      {unlocked ? (
        render({ requireGps: true, onFinished: (endedAt) => setEvents((prev) => ({ ...prev, work_ended_at: endedAt })) })
      ) : (
        <p className="flex items-center gap-2 rounded-2xl px-4 py-4 text-sm text-slate-300" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Lock size={15} /> Faça o check-in (com o GPS ligado) para liberar fotos, vídeos, assinatura e o fechamento da ordem.
        </p>
      )}
    </>
  )
}
