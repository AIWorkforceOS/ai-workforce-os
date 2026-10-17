'use client'

import { useCallback, useEffect, useState } from 'react'
import { Clock, LocateFixed, MapPin, Navigation, TriangleAlert } from 'lucide-react'
import { geoGrantedBefore, geoHelp, getCurrentFix, queryGeoPermission, rememberGeoGranted, watchFix, type GeoFailure, type GeoPermission } from '@/lib/portal-funcionario/geolocation'
import { computeDurations, fieldState, formatDuration, type FieldEvents } from '@/lib/portal-funcionario/field-time'
import { loadPendingFieldEvents, recordFieldEvent } from '@/lib/portal-funcionario/field-events'

/**
 * Viagem → check-in → serviço, tudo com GPS. O técnico NÃO avança sem a posição:
 * se a localização estiver bloqueada, nada é registrado e a tela explica como
 * liberar. O tempo de viagem corre do "Iniciar viagem" até o "Check-in"; o de
 * serviço, do check-in até assinar e salvar a ordem (esse último marco é gravado
 * pelo salvamento da ordem, ver service-order-workspace).
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
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<'trip_start' | 'check_in' | null>(null)
  const [geoFailure, setGeoFailure] = useState<GeoFailure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [accuracy, setAccuracy] = useState<number | null>(null)
  const [permission, setPermission] = useState<GeoPermission>('granted')
  const [asking, setAsking] = useState(false)
  const [skippedAction, setSkippedAction] = useState<'trip_start' | 'check_in' | null>(null)
  const state = fieldState(events)

  const update = useCallback(
    (next: FieldEvents) => {
      setOwn(next)
      onEvents?.(next)
    },
    [onEvents],
  )

  // Pede a localização de cara (um toque) em vez de só descobrir o bloqueio na hora de iniciar a viagem.
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

  async function allowLocation() {
    setAsking(true)
    setGeoFailure(null)
    const result = await getCurrentFix({ timeoutMs: 20_000 })
    setAsking(false)
    if (result.ok) {
      rememberGeoGranted(true)
      setPermission('granted')
    } else {
      setPermission(result.reason === 'denied' ? 'denied' : 'prompt')
      setGeoFailure(result.reason)
    }
  }

  // Marcos já feitos neste aparelho mas ainda não enviados (recarregou a página sem sinal).
  useEffect(() => {
    let cancelled = false
    loadPendingFieldEvents(appointmentId).then((pending) => {
      if (cancelled) return
      const merged: FieldEvents = {
        trip_started_at: events.trip_started_at ?? pending.trip_started_at ?? null,
        checked_in_at: events.checked_in_at ?? pending.checked_in_at ?? null,
        work_ended_at: events.work_ended_at ?? pending.work_ended_at ?? null,
      }
      if (merged.trip_started_at !== events.trip_started_at || merged.checked_in_at !== events.checked_in_at || merged.work_ended_at !== events.work_ended_at) update(merged)
    })
    return () => {
      cancelled = true
    }
    // só na montagem
  }, [appointmentId])

  // Relógio (1s) enquanto algum tempo corre.
  useEffect(() => {
    if (state !== 'on_trip' && state !== 'on_site') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state])

  // GPS "vivo" na tela enquanto o app está aberto (mostra a precisão; o app não rastreia em segundo plano).
  useEffect(() => {
    if (state !== 'on_trip' && state !== 'on_site') return
    return watchFix(
      (fix) => setAccuracy(Math.round(fix.accuracy)),
      (reason) => setGeoFailure(reason),
    )
  }, [state])

  async function mark(type: 'trip_start' | 'check_in', withoutGps = false) {
    setBusy(type)
    setError(null)
    setGeoFailure(null)
    setSkippedAction(null)
    let fix = null
    if (!withoutGps) {
      const result = await getCurrentFix()
      if (!result.ok) {
        setGeoFailure(result.reason)
        setSkippedAction(type)
        setBusy(null)
        return
      }
      rememberGeoGranted(true)
      fix = result.fix
    }
    const recorded = await recordFieldEvent({ unitId, appointmentId, type, fix })
    setBusy(null)
    if (!recorded.stored) {
      setError('Não foi possível guardar no aparelho. Tente de novo.')
      return
    }
    setNow(Date.now())
    update(type === 'trip_start' ? { ...events, trip_started_at: recorded.at } : { ...events, checked_in_at: recorded.at })
  }

  const d = computeDurations(events, now)
  const card = 'flex flex-col gap-2 rounded-2xl p-4'
  const btn = 'flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black text-black disabled:opacity-60'

  return (
    <div className={card} style={{ background: 'rgba(6,182,212,0.07)', border: '1px solid rgba(6,182,212,0.25)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-cyan-300">
          <Navigation size={13} /> Viagem e check-in
        </p>
        {(state === 'on_trip' || state === 'on_site') && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-300">
            <LocateFixed size={12} /> GPS ativo{accuracy != null ? ` ±${accuracy}m` : ''}
          </span>
        )}
      </div>

      {address && state !== 'done' && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-slate-300 underline"
        >
          <MapPin size={12} /> {address}
        </a>
      )}

      {(state === 'not_started' || state === 'on_trip') && permission !== 'granted' && (
        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.3)' }}>
          {permission === 'prompt' ? (
            <>
              <p className="text-xs text-slate-200">
                Para contar viagem e check-in, o app precisa da sua localização. Toque no botão e, quando o celular perguntar, escolha <b>Permitir</b>.
              </p>
              <button type="button" onClick={allowLocation} disabled={asking} className={btn} style={{ background: '#22d3ee' }}>
                <LocateFixed size={16} /> {asking ? 'Aguardando…' : 'Permitir localização'}
              </button>
            </>
          ) : (
            <p className="text-xs text-amber-100">{geoHelp('denied', navigator.userAgent)}</p>
          )}
        </div>
      )}

      {state === 'not_started' && (
        <>
          <button type="button" disabled={busy !== null} onClick={() => mark('trip_start')} className={btn} style={{ background: '#22d3ee' }}>
            <Navigation size={16} /> {busy === 'trip_start' ? 'Pegando sua localização…' : 'Iniciar viagem'}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => mark('check_in')} className="text-xs font-bold text-slate-300 underline disabled:opacity-60">
            {busy === 'check_in' ? 'Pegando sua localização…' : 'Já estou no local — fazer check-in direto'}
          </button>
          <p className="text-[11px] text-slate-400">Precisa do GPS do celular ligado e permitido. Sem a localização não dá para avançar.</p>
        </>
      )}

      {state === 'on_trip' && (
        <>
          <p className="flex items-center gap-2 text-2xl font-black text-white">
            <Clock size={20} className="text-cyan-300" /> {formatDuration(d.tripMs)}
          </p>
          <p className="text-[11px] text-slate-400">Em viagem desde {new Date(events.trip_started_at!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
          <button type="button" disabled={busy !== null} onClick={() => mark('check_in')} className={btn} style={{ background: '#34d399' }}>
            <MapPin size={16} /> {busy === 'check_in' ? 'Pegando sua localização…' : 'Cheguei — Check-in'}
          </button>
        </>
      )}

      {state === 'on_site' && (
        <>
          <p className="flex items-center gap-2 text-2xl font-black text-white">
            <Clock size={20} className="text-emerald-300" /> {formatDuration(d.serviceMs)}
          </p>
          <p className="text-[11px] text-slate-400">
            No local desde {new Date(events.checked_in_at!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            {d.tripMs != null ? ` · viagem: ${formatDuration(d.tripMs)}` : ''}. O tempo para quando você assinar e salvar a ordem.
          </p>
        </>
      )}

      {state === 'done' && (
        <p className="text-sm text-slate-200">
          Viagem: <b>{formatDuration(d.tripMs)}</b> · Serviço: <b>{formatDuration(d.serviceMs)}</b> · Total: <b>{formatDuration(d.totalMs)}</b>
        </p>
      )}

      {geoFailure && (
        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <p className="flex items-start gap-1.5 text-xs text-amber-100">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" /> {geoHelp(geoFailure, navigator.userAgent)}
          </p>
          {state !== 'done' && (state === 'not_started' || state === 'on_trip') && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => mark(state === 'not_started' ? 'trip_start' : 'check_in')} className="w-fit rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-black">
                Tentar de novo
              </button>
              {skippedAction && (
                <button type="button" onClick={() => mark(skippedAction, true)} className="w-fit rounded-lg px-3 py-2 text-xs font-bold text-amber-100 underline">
                  Registrar sem GPS (fica marcado para o admin)
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
