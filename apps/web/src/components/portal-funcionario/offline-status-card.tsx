'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CloudOff, Download, HardDrive, Smartphone, TriangleAlert, Wifi, WifiOff } from 'lucide-react'
import { countDrafts, getActiveOwner, getMeta, isSnapshotUsable, listPendingSaves, loadActiveSnapshot, type OfflineSnapshot } from '@/lib/portal-funcionario/offline-store'
import { getStorageStatus, isStorageLow, type StorageStatus } from '@/lib/portal-funcionario/storage-quota'
import { installReadiness, isStandaloneDisplay } from '@/lib/portal-funcionario/offline-routes'
import { prepareForOffline } from '@/lib/portal-funcionario/offline-prepare'

type Status = {
  online: boolean
  snapshot: OfflineSnapshot | null
  pendingItems: number
  pendingFiles: number
  pendingMb: number
  failedItems: number
  otherOwnerItems: number
  drafts: number
  lastSyncAt: number | null
  storage: StorageStatus
  standalone: boolean
}

const fmt = (ms: number) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10

async function gather(): Promise<Status> {
  const [snapshot, items, drafts, lastSyncAt, storage] = await Promise.all([loadActiveSnapshot(), listPendingSaves(), countDrafts(), getMeta<number>('last_sync_at'), getStorageStatus()])
  const owner = getActiveOwner()
  const mine = items.filter((i) => !owner || !i.ownerId || i.ownerId === owner)
  const files = mine.flatMap((i) => Object.values(i.files).flat())
  return {
    online: navigator.onLine,
    snapshot,
    pendingItems: mine.length,
    pendingFiles: files.length,
    pendingMb: mb(files.reduce((n, f) => n + f.blob.size, 0)),
    failedItems: mine.filter((i) => i.status === 'failed').length,
    otherOwnerItems: items.length - mine.length,
    drafts,
    lastSyncAt: lastSyncAt ?? null,
    storage,
    standalone: isStandaloneDisplay(),
  }
}

/** Painel de estado do app de campo: conexão, ordens disponíveis offline, pendências, última sincronização, espaço e o passo seguro para instalar como app. */
export function OfflineStatusCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => setStatus(await gather()), [])
  useEffect(() => {
    void refresh()
    const interval = setInterval(refresh, 5000)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [refresh])

  async function prepare() {
    setBusy(true)
    setMessage(null)
    const result = await prepareForOffline()
    setBusy(false)
    await refresh()
    setMessage(
      result.ok
        ? `Pronto: ${result.orders} ordem(ns) guardada(s) neste aparelho (${fmt(result.savedAt)}). Só essas abrem sem internet.`
        : result.reason === 'offline'
          ? 'Sem internet agora. Conecte-se para preparar o uso offline.'
          : result.reason === 'session'
            ? 'Sua sessão expirou. Entre de novo (nada do que está guardado foi perdido).'
            : 'Não foi possível preparar agora. Tente de novo em instantes.',
    )
  }

  if (!status) return null
  const usable = status.snapshot ? isSnapshotUsable(status.snapshot) : false
  const low = isStorageLow(status.storage)
  const readiness = installReadiness({ pendingItems: status.pendingItems + status.otherOwnerItems, failedItems: status.failedItems, drafts: status.drafts, online: status.online })
  const row = 'flex items-center justify-between gap-3 text-sm'
  const box = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-2xl p-4" style={box}>
        <div className={row}>
          <span className="flex items-center gap-2 text-slate-300">{status.online ? <Wifi size={14} className="text-emerald-300" /> : <WifiOff size={14} className="text-amber-300" />} Conexão</span>
          <b className={status.online ? 'text-emerald-300' : 'text-amber-300'}>{status.online ? 'Online' : 'Sem internet'}</b>
        </div>
        <div className={row}>
          <span className="text-slate-300">Ordens disponíveis offline</span>
          <b className="text-white">{status.snapshot && usable ? status.snapshot.appointments.length : 0}</b>
        </div>
        <div className={row}>
          <span className="text-slate-300">Última atualização da agenda</span>
          <b className="text-white">{status.snapshot ? fmt(status.snapshot.savedAt) : 'nunca'}</b>
        </div>
        <div className={row}>
          <span className="text-slate-300">Arquivos aguardando envio</span>
          <b className="text-white">{status.pendingFiles} ({status.pendingMb} MB)</b>
        </div>
        <div className={row}>
          <span className="text-slate-300">Última sincronização confirmada</span>
          <b className="text-white">{status.lastSyncAt ? fmt(status.lastSyncAt) : '—'}</b>
        </div>
        {status.failedItems > 0 && (
          <p className="flex items-center gap-2 text-xs font-bold text-red-300"><TriangleAlert size={13} /> {status.failedItems} item(ns) com erro precisam de atenção (veja abaixo).</p>
        )}
        {status.otherOwnerItems > 0 && (
          <p className="flex items-center gap-2 text-xs text-amber-200"><CloudOff size={13} /> {status.otherOwnerItems} item(ns) guardados são de OUTRA conta e só serão enviados quando ela entrar de novo neste aparelho. Nada foi apagado.</p>
        )}
        {status.snapshot && !usable && (
          <p className="text-xs text-amber-200">A agenda guardada tem mais de 14 dias e não aparece offline até atualizar (o que você já salvou continua guardado).</p>
        )}
        {status.storage.supported && (
          <p className={`flex items-center gap-2 text-xs ${low ? 'font-bold text-amber-300' : 'text-slate-400'}`}>
            <HardDrive size={13} /> Espaço livre estimado: {mb(status.storage.free)} MB{low ? ' — pouco! Apague vídeos/fotos antigas do celular antes de continuar.' : ''}
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Os dados ficam só neste aparelho e o navegador pode apagá-los se faltar espaço ou se você limpar os dados do site — por isso o que estiver pendente deve ser enviado assim que houver internet.
        </p>
        <button type="button" onClick={prepare} disabled={busy || !status.online} className="flex w-fit items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-black disabled:opacity-60" style={{ background: '#22d3ee' }}>
          <Download size={13} /> {busy ? 'Preparando…' : 'Preparar para uso offline'}
        </button>
        {message && <p className="text-xs text-slate-200">{message}</p>}
      </div>

      {!status.standalone && (
        <div className="flex flex-col gap-2 rounded-2xl p-4" style={box}>
          <p className="flex items-center gap-2 text-sm font-bold text-white"><Smartphone size={14} /> Instalar a Alizo como app (iPhone e Android)</p>
          {readiness.ready ? (
            <p className="flex items-center gap-2 text-xs font-bold text-emerald-300"><CheckCircle2 size={14} /> Tudo enviado neste navegador: fila vazia, sem erros e sem rascunhos. Pode instalar.</p>
          ) : (
            <div className="flex flex-col gap-1 text-xs text-amber-200">
              <p className="flex items-center gap-2 font-bold"><TriangleAlert size={14} /> NÃO troque o ícone ainda — o app instalado tem armazenamento separado deste navegador e não enxerga o que está pendente aqui:</p>
              {readiness.reasons.map((reason) => <p key={reason}>• {reason}</p>)}
            </div>
          )}
          <ol className="list-decimal pl-5 text-xs text-slate-300">
            <li>Aqui deve aparecer &quot;Pode instalar&quot; (verde).</li>
            <li>iPhone: segure o ícone antigo → Remover da Tela de Início. Isso não apaga seus dados do Safari.</li>
            <li>No Safari, abra alizoai.com → Compartilhar → Adicionar à Tela de Início (deixe &quot;Abrir como app&quot; ligado).</li>
            <li>Abra o ícone novo, entre, abra a agenda online e toque em &quot;Preparar para uso offline&quot;.</li>
          </ol>
        </div>
      )}
      {status.standalone && <p className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 size={13} /> Você está usando o app instalado.</p>}
    </div>
  )
}
