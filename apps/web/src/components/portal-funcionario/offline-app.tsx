'use client'

import { useEffect, useState } from 'react'
import { CloudOff, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react'
import { AgendaSection } from './agenda-section'
import { FieldOrderShell } from './field-order-shell'
import { OfflineSyncManager } from './offline-sync-manager'
import { OrderHeader } from './order-header'
import { ServiceOrderWorkspace } from './service-order-workspace'
import { SyncStatusPanel } from './sync-status-panel'
import { parseOfflineTarget, type OfflineTarget } from '@/lib/portal-funcionario/offline-routes'
import { isSnapshotUsable, loadActiveSnapshot, setActiveOwner, type OfflineSnapshot } from '@/lib/portal-funcionario/offline-store'

function formatSavedAt(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * App do técnico SEM internet: monta a agenda e as ordens a partir do que ficou guardado neste aparelho
 * (só o que o servidor já deixou esse técnico ver). Reaproveita os mesmos componentes do portal online.
 * Deixa sempre claro que está mostrando dados locais e quando foi a última sincronização.
 */
export function OfflineApp() {
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null | undefined>(undefined)
  const [target, setTarget] = useState<OfflineTarget>({ view: 'agenda' })
  const [toPath, setToPath] = useState('/portal-funcionario')
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const to = new URLSearchParams(window.location.search).get('to')
    setTarget(parseOfflineTarget(to))
    setToPath(to && to.startsWith('/portal-funcionario') ? to : '/portal-funcionario')
    setOnline(navigator.onLine)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    loadActiveSnapshot().then((s) => {
      if (s) setActiveOwner(s.employeeId)
      setSnapshot(s)
    })
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  const usable = snapshot ? isSnapshotUsable(snapshot) : false
  const locale = snapshot?.locale === 'en' ? 'en-US' : 'pt-BR'

  return (
    <div className="flex min-h-dvh flex-col" style={{ background: '#0a0f1e' }}>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between px-4" style={{ background: 'rgba(10,15,30,0.95)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <img src="/branding/alizo-icon.png" alt="Alizo" className="h-6 w-auto" />
          <p className="text-[14px] font-black tracking-tight text-white">alizo</p>
          <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
            {online ? 'Dados locais' : 'Offline'}
          </span>
        </div>
        {online && (
          <a href={toPath} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-black" style={{ background: '#22d3ee' }}>
            <RefreshCw size={12} /> Voltar ao online
          </a>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-5">
        {snapshot !== undefined && snapshot && usable && (
          <p className="flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs text-amber-100" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
            <WifiOff size={14} className="mt-0.5 shrink-0" />
            <span>
              {online ? 'O servidor não respondeu. Você está vendo ' : 'Sem internet. Você está vendo '}
              <b>dados guardados neste aparelho</b> — última sincronização: <b>{formatSavedAt(snapshot.savedAt)}</b>. O que você salvar fica no aparelho e é enviado sozinho quando a internet voltar.
            </span>
          </p>
        )}

        {snapshot === undefined && <p className="text-sm text-slate-400">Carregando…</p>}

        {target.view === 'sync' && (
          <>
            <h1 className="text-xl font-black text-white">Sincronização</h1>
            <SyncStatusPanel />
          </>
        )}

        {target.view !== 'sync' && snapshot === null && (
          <Notice title="Nenhuma agenda foi guardada neste aparelho">
            Conecte-se à internet e abra a Alizo uma vez (toque em &quot;Preparar para uso offline&quot; na tela de Sincronização). Só ordens que já foram abertas online podem ser vistas sem internet.
          </Notice>
        )}

        {target.view !== 'sync' && snapshot && !usable && (
          <Notice title="Os dados guardados estão antigos">
            A agenda guardada neste aparelho tem mais de 14 dias (última sincronização: {formatSavedAt(snapshot.savedAt)}). Conecte-se à internet para atualizar. O que você já salvou localmente continua guardado e será enviado.
          </Notice>
        )}

        {target.view === 'agenda' && snapshot && usable && (
          <AgendaSection appointments={snapshot.appointments} timezone={snapshot.timezone} locale={locale} requiresCheckin={snapshot.requiresCheckin} />
        )}

        {target.view === 'order' && snapshot && usable && (() => {
          const appointment = snapshot.appointments.find((a) => a.id === target.appointmentId)
          if (!appointment) {
            return (
              <Notice title="Esta ordem não está disponível offline">
                Ela não foi sincronizada neste aparelho. Conecte-se à internet e abra a ordem uma vez para poder usá-la sem internet.
                <a href="/offline-app?to=/portal-funcionario" className="mt-2 block font-bold underline">← Voltar para a agenda guardada</a>
              </Notice>
            )
          }
          return (
            <>
              <a href="/offline-app?to=/portal-funcionario" className="flex w-fit items-center gap-1 text-xs font-bold text-slate-400">← Voltar para a agenda guardada</a>
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
                <CloudOff size={12} /> Ordem exibida a partir de dados locais (sincronizada em {formatSavedAt(snapshot.savedAt)})
              </p>
              <OrderHeader appointment={appointment} locale={locale} />
              <FieldOrderShell
                requiresCheckin={snapshot.requiresCheckin}
                unitId={appointment.unit_id}
                appointmentId={appointment.id}
                address={appointment.address}
                initial={{ trip_started_at: appointment.trip_started_at ?? null, checked_in_at: appointment.checked_in_at ?? null, work_ended_at: appointment.work_ended_at ?? null }}
              >
                <ServiceOrderWorkspace appointment={appointment} />
              </FieldOrderShell>
            </>
          )
        })()}

        {target.view !== 'sync' && (
          <a href="/offline-app?to=/portal-funcionario/sincronizacao" className="mt-2 w-fit text-xs font-bold text-slate-400 underline">
            Ver sincronização e itens pendentes
          </a>
        )}
      </main>

      <OfflineSyncManager />
    </div>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <p className="flex items-center gap-2 text-sm font-bold text-white"><TriangleAlert size={15} className="text-amber-300" /> {title}</p>
      <div className="mt-1 text-xs text-slate-300">{children}</div>
    </div>
  )
}
