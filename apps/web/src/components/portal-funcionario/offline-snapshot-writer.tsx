'use client'

import { useEffect } from 'react'
import type { PortalAppointment } from '@/lib/portal-funcionario/data'
import { loadActiveSnapshot, saveSnapshot, type OfflineSnapshot } from '@/lib/portal-funcionario/offline-store'

/**
 * Guarda no aparelho a agenda que o servidor acabou de entregar a ESTE funcionário (só dados de consulta),
 * para a casca offline conseguir abri-la sem internet. Cada visita online renova. Não renderiza nada.
 * - Na agenda: grava a lista inteira.
 * - Numa ordem: atualiza só essa ordem dentro do que já existe (nunca cria agenda "pela metade").
 */
export function OfflineSnapshotWriter(
  props:
    | { employeeId: string; appointments: PortalAppointment[]; timezone: string; locale: string; requiresCheckin: boolean }
    | { employeeId: string; appointment: PortalAppointment },
) {
  const key = 'appointments' in props ? JSON.stringify(props.appointments.map((a) => [a.id, a.service_order_status, a.service_order_photos.length, a.checked_in_at, a.work_ended_at])) : props.appointment.id + props.appointment.service_order_status

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if ('appointments' in props) {
        const snapshot: OfflineSnapshot = {
          employeeId: props.employeeId,
          savedAt: Date.now(),
          appointments: props.appointments,
          timezone: props.timezone,
          locale: props.locale,
          requiresCheckin: props.requiresCheckin,
        }
        if (!cancelled) await saveSnapshot(snapshot)
        return
      }
      const current = await loadActiveSnapshot()
      if (cancelled || !current || current.employeeId !== props.employeeId) return
      const others = current.appointments.filter((a) => a.id !== props.appointment.id)
      await saveSnapshot({ ...current, appointments: [...others, props.appointment] })
    })()
    return () => {
      cancelled = true
    }
    // regrava quando o conteúdo muda, não a cada render
  }, [key])

  return null
}
