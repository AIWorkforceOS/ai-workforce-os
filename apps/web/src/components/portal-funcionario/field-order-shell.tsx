'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { FieldEvents } from '@/lib/portal-funcionario/field-time'
import { FieldOrderContext } from './field-order-context'
import { TripControls } from './trip-controls'

/**
 * Envolve a ordem: para quem o admin marcou "check-in com GPS", o formulário
 * da ordem (children) só abre depois do check-in. Os demais técnicos veem a
 * ordem normal. A ordem descobre se o GPS é obrigatório e como avisar que
 * terminou pelo contexto (não por função como prop: o Next não deixa passar
 * função de componente de servidor para cliente).
 */
export function FieldOrderShell({
  requiresCheckin,
  unitId,
  appointmentId,
  address,
  initial,
  children,
}: {
  requiresCheckin: boolean
  unitId: string
  appointmentId: string
  address: string | null
  initial: FieldEvents
  children: ReactNode
}) {
  const [events, setEvents] = useState<FieldEvents>(initial)
  const api = useMemo(
    () => ({
      requireGps: requiresCheckin,
      onFinished: (endedAt: string) => setEvents((prev) => ({ ...prev, work_ended_at: endedAt })),
    }),
    [requiresCheckin],
  )

  if (!requiresCheckin) return <>{children}</>

  const unlocked = Boolean(events.checked_in_at)

  return (
    <FieldOrderContext.Provider value={api}>
      <TripControls unitId={unitId} appointmentId={appointmentId} address={address} initial={initial} events={events} onEvents={setEvents} />
      {unlocked ? (
        children
      ) : (
        <p className="flex items-center gap-2 rounded-2xl px-4 py-4 text-sm text-slate-300" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <Lock size={15} /> Faça o check-in (com o GPS ligado) para liberar fotos, vídeos, assinatura e o fechamento da ordem.
        </p>
      )}
    </FieldOrderContext.Provider>
  )
}
