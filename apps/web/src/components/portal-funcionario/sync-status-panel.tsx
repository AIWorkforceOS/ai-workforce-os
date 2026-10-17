'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { listPendingSaves } from '@/lib/portal-funcionario/offline-store'
import { drainPendingSaves } from '@/lib/portal-funcionario/offline-sync'
import { directMediaOverrideOff, setDirectMediaOverride } from '@/lib/portal-funcionario/media-upload'
import { describeQueueItem, type QueueItemView } from '@/lib/portal-funcionario/queue-status'

/** Tela de status da sincronização: o que está salvo só no aparelho, o que falhou, e "tentar agora". */
export function SyncStatusPanel() {
  const [items, setItems] = useState<QueueItemView[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [testMode, setTestMode] = useState(false)

  // Modo de teste por aparelho: abrir esta tela com ?upload_direto=1 liga, =0 desliga. Só afeta este aparelho.
  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get('upload_direto')
    if (flag === '1') setDirectMediaOverride(true)
    if (flag === '0') setDirectMediaOverride(false)
    if (flag === 'padrao') setDirectMediaOverride(null)
    setTestMode(directMediaOverrideOff())
  }, [])

  const refresh = useCallback(async () => {
    setItems((await listPendingSaves()).map(describeQueueItem))
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  async function retryNow() {
    setBusy(true)
    setMessage(null)
    const result = await drainPendingSaves({ force: true }).catch(() => null)
    await refresh()
    setBusy(false)
    setMessage(
      result
        ? result.remaining === 0
          ? 'Tudo sincronizado com o servidor.'
          : `${result.synced} enviado(s). Ainda restam ${result.remaining} — veja o motivo em cada item.`
        : 'Não foi possível tentar agora. Seus dados continuam guardados no aparelho.',
    )
  }

  if (items === null) return <p className="text-sm text-slate-400">Carregando…</p>

  return (
    <div className="flex flex-col gap-4">
      {testMode && (
        <p className="rounded-xl px-3 py-2 text-xs font-bold text-amber-200" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          Este aparelho está no fluxo ANTIGO de envio (upload direto desligado só aqui). Para voltar ao padrão, abra esta tela com ?upload_direto=padrao.
        </p>
      )}
      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl px-4 py-4 text-sm text-emerald-300" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <CheckCircle2 size={16} />
          Nada pendente: tudo que você salvou já está no servidor.
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={retryNow}
            disabled={busy}
            className="flex w-fit items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)' }}
          >
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            {busy ? 'Enviando…' : 'Tentar sincronizar agora'}
          </button>
          {message && <p className="text-xs text-slate-300">{message}</p>}
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-2xl px-4 py-3 text-sm"
                style={{
                  background: item.state === 'failed' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                  border: `1px solid ${item.state === 'failed' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                }}
              >
                <p className="flex items-center gap-2 font-bold text-white">
                  {item.state === 'failed' ? <TriangleAlert size={14} className="text-red-300" /> : <CloudOff size={14} className="text-amber-300" />}
                  {item.label}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Salvo em {new Date(item.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} · {item.fileCount} arquivo(s) ({item.megabytes} MB) · {item.attempts} tentativa(s)
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
