'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, LocateFixed, MapPin, Navigation } from 'lucide-react'
import { getCurrentFix, queryGeoPermission, rememberGeoGranted, geoGrantedBefore, watchFix, type GeoFix, type GeoPermission } from '@/lib/portal-funcionario/geolocation'
import { computeDurations, fieldState, formatDuration, type FieldEvents } from '@/lib/portal-funcionario/field-time'
import { loadPendingFieldEvents, recordFieldEvent } from '@/lib/portal-funcionario/field-events'

/** Posição de até 2 min atrás ainda vale para carimbar o toque (assim o toque nunca espera pelo GPS). */
const FIX_MAX_AGE_MS = 120_000

function mapsRouteUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
}

/**
 * Viagem → check-in → serviço.
 *  - "Iniciar viagem": começa a contar NA HORA e já abre a rota no Google Maps.
 *  - "Cheguei — Check-in": para a viagem e começa a contar o serviço na loja.
 *  - O serviço para quando o técnico assina e salva a ordem (gravado pelo salvamento da ordem).
 * O GPS é pedido e usado sempre que possível, mas NUNCA trava nem gera aviso de erro para o técnico:
 * se a localização não vier, o marco é registrado igual (o admin vê que foi sem GPS).
 */
export function TripControls({
  unitId,
  appointmentId,
  address,
  initial,
  events: controlled,
  onEvents,
}: {
  unitId: string
  appointmentId: string
  address?: string | null
  initial: FieldEvents
  /** Estado compartilhado com quem controla a tela (a ordem). Sem isso, o componente guarda o próprio. */
  events?: FieldEvents
  onEvents?: (events: FieldEvents) => void
}) {
  const [own, setOwn] = useState<FieldEvents>(initial)
  const events = controlled ?? own
  const eventsRef = useRef(events)
  eventsRef.current = events
  const [now, setNow] = useState(() => Date.now())
  const [error, setError] = useState<string | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [permission, setPermission] = useState<GeoPermission>('granted')
  const [asking, setAsking] = useState(false)
  const lastFix = useRef<GeoFix | null>(null)
  const state = fieldState(events)

  const update = useCallback(
    (next: FieldEvents) => {
      setOwn(next)
      onEvents?.(next)
    },
    [onEvents],
  )

  // Marcos já feitos neste aparelho mas ainda não enviados (recarregou a página sem sinal).
  useEffect(() => {
    let cancelled = false
    loadPendingFieldEvents(appointmentId).then((pending) => {
      if (cancelled) return
      const cur = eventsRef.current
      const merged: FieldEvents = {
        trip_started_at: cur.trip_started_at ?? pending.trip_started_at ?? null,
        checked_in_at: cur.checked_in_at ?? pending.checked_in_at ?? null,
        work_ended_at: cur.work_ended_at ?? pending.work_ended_at ?? null,
      }
      if (merged.trip_started_at !== cur.trip_started_at || merged.checked_in_at !== cur.checked_in_at || merged.work_ended_at !== cur.work_ended_at) update(merged)
    })
    return () => {
      cancelled = true
    }
    // só na montagem
  }, [appointmentId])

  // Estado da permissão de localização (o aviso só aparece quando o celular ainda pode perguntar).
  useEffect(() => {
    let cancelled = false
    queryGeoPermission().then((p) => {
      if (cancelled) return
      if (p === 'granted') rememberGeoGranted(true)
      setPermission(p === 'unknown' ? (geoGrantedBefore() ? 'granted' : 'prompt') : p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Com a localização liberada, mantém a posição mais recente "quente" enquanto a tela está aberta.
  useEffect(() => {
    if (permission !== 'granted') return
    return watchFix((fix) => {
      lastFix.current = fix
      setAccuracy(Math.round(fix.accuracy))
    })
  }, [permission])

  // Relógio (1s) enquanto algum tempo corre.
  useEffect(() => {
    if (state !== 'on_trip' && state !== 'on_site') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state])

  async function allowLocation() {
    setAsking(true)
    const result = await getCurrentFix({ timeoutMs: 20_000 })
    setAsking(false)
    if (result.ok) {
      lastFix.current = result.fix
      rememberGeoGranted(true)
      setPermission('granted')
    } else {
      // sem aviso de erro para o técnico: segue sem GPS
      setPermission(result.reason === 'denied' ? 'denied' : 'prompt')
    }
  }

  function freshFix(): GeoFix | null {
    const fix = lastFix.current
    return fix && Date.now() - new Date(fix.at).getTime() < FIX_MAX_AGE_MS ? fix : null
  }

  /** O toque conta na hora (horário do toque), a rota abre na hora e o GPS entra quando chegar — nada espera pelo GPS. */
  function mark(type: 'trip_start' | 'check_in') {
    setError(null)
    const at = new Date().toISOString()
    const before = eventsRef.current
    const fix = freshFix()

    setNow(Date.now())
    update(type === 'trip_start' ? { ...before, trip_started_at: at } : { ...before, checked_in_at: at })
    // Abre o Maps dentro do toque (senão o navegador bloqueia). O horário já está guardado abaixo.
    if (type === 'trip_start' && address) window.open(mapsRouteUrl(address), '_blank', 'noopener,noreferrer')

    void (async () => {
      const recorded = await recordFieldEvent({ unitId, appointmentId, type, fix, at })
      if (!recorded.stored) {
        update(before)
        setError('Não foi possível guardar. Toque de novo.')
        return
      }
      if (!fix) {
        // Sem posição fresca: tenta pegar agora; se vier, completa o marco (o horário não muda).
        const late = await getCurrentFix({ timeoutMs: 20_000 })
        if (late.ok) {
          lastFix.current = late.fix
          rememberGeoGranted(true)
          await recordFieldEvent({ unitId, appointmentId, type, fix: late.fix, at })
        }
      }
    })()
  }

  const d = computeDurations(events, now)
  const btn = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black text-black disabled:opacity-60'
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex flex-col gap-2 rounded-2xl p-4" style={{ background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.25)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-cyan-300">
          <Navigation size={13} /> Viagem e check-in
        </p>
        {(state === 'on_trip' || state === 'on_site') && accuracy != null && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300">
            <LocateFixed size={12} /> GPS ativo ±{accuracy}m
          </span>
        )}
      </div>

      {permission === 'prompt' && (state === 'not_started' || state === 'on_trip') && (
        <button type="button" onClick={allowLocation} disabled={asking} className={btn} style={{ background: '#22d3ee' }}>
          <LocateFixed size={16} /> {asking ? 'Aguardando…' : 'Permitir localização (toque e escolha Permitir)'}
        </button>
      )}

      {state === 'not_started' && (
        <>
          <button type="button" onClick={() => mark('trip_start')} className={btn} style={{ background: '#22d3ee' }}>
            <Navigation size={16} /> Iniciar viagem{address ? ' (abre o Google Maps)' : ''}
          </button>
          <button type="button" onClick={() => mark('check_in')} className="text-xs font-bold text-slate-300 underline">
            Já estou no local — fazer check-in direto
          </button>
        </>
      )}

      {state === 'on_trip' && (
        <>
          <p className="flex items-center gap-2 text-2xl font-black text-white">
            <Clock size={20} className="text-cyan-300" /> {formatDuration(d.tripMs)}
          </p>
          <p className="text-[11px] text-slate-400">Em viagem desde {time(events.trip_started_at!)}</p>
          {address && (
            <a href={mapsRouteUrl(address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-cyan-200 underline">
              <MapPin size={12} /> Abrir rota no Google Maps de novo
            </a>
          )}
          <button type="button" onClick={() => mark('check_in')} className={btn} style={{ background: '#34d399' }}>
            <MapPin size={16} /> Cheguei — Check-in
          </button>
        </>
      )}

      {state === 'on_site' && (
        <>
          <p className="flex items-center gap-2 text-2xl font-black text-white">
            <Clock size={20} className="text-emerald-300" /> {formatDuration(d.serviceMs)}
          </p>
          <p className="text-[11px] text-slate-400">
            Na loja desde {time(events.checked_in_at!)}
            {d.tripMs != null ? ` · viagem: ${formatDuration(d.tripMs)}` : ''}. O tempo para quando você assinar e salvar a ordem.
          </p>
        </>
      )}

      {state === 'done' && (
        <div className="flex flex-col gap-1.5 text-sm text-slate-200">
          <div className="flex justify-between"><span>Tempo de viagem</span><b>{formatDuration(d.tripMs)}</b></div>
          <div className="flex justify-between"><span>Tempo na loja</span><b>{formatDuration(d.serviceMs)}</b></div>
          <div className="flex justify-between border-t border-white/10 pt-1.5 text-base text-white"><span>Total</span><b>{formatDuration(d.totalMs)}</b></div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
